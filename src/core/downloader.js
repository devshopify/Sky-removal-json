import { conversionTarget, mimeOfExt } from './media-format.js';
import { convertImageBytes } from './image-convert.js';

/**
 * 把 CDN 基地址和文件名拼成完整 URL
 *   base: https://es.dreametech.com/cdn/shop/files/
 *   name: a2-bg.jpg  ->  https://es.dreametech.com/cdn/shop/files/a2-bg.jpg
 */
export function buildMediaUrl(baseUrl, name) {
  const base = String(baseUrl || '').trim();
  if (!base) return null;
  const b = base.endsWith('/') ? base : `${base}/`;
  const clean = String(name || '').split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!clean) return null;
  // 只转义中文/空格等，保留 % 与常见安全字符，避免二次编码
  const encoded = clean
    .split('/')
    .map((seg) => seg.replace(/[^\w\-.:~!$&'()*+,;=@%]/g, (c) => encodeURIComponent(c)))
    .join('/');
  return b + encoded;
}

/**
 * Shopify 托管视频和 Files 不在同一个目录：
 *   Files  -> https://<shop>/cdn/shop/files/xxx
 *   视频   -> https://<shop>/cdn/shop/videos/c/vp/xxx/xxx.HD-1080p-....mp4
 * 用户填的基址总是 /cdn/shop/files/，所以视频要换一段路径再试。
 */
export function videoBaseUrl(baseUrl) {
  const b = String(baseUrl || '').trim();
  if (!b) return '';
  return /\/files\/?$/.test(b) ? b.replace(/\/files\/?$/, '/videos/') : b;
}

/**
 * 一个名字可能对应多个地址，按命中率排序。
 * 调用方依次尝试，第一个成功即停，所以多给的候选只在失败时才多花一次请求。
 */
export function buildMediaUrls(baseUrl, name) {
  const out = [];
  const add = (u) => { if (u && !out.includes(u)) out.push(u); };

  const clean = String(name || '').split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!clean) return out;

  // Shopify 托管视频的固定路径前缀 c/vp/<hash>/
  if (/^c\/vp\//i.test(clean)) {
    add(buildMediaUrl(videoBaseUrl(baseUrl), clean));
    add(buildMediaUrl(baseUrl, clean));
    return out;
  }

  add(buildMediaUrl(baseUrl, clean));

  const last = clean.split('/').pop();
  const hasDir = Boolean(last) && last !== clean;

  // 名字自带目录前缀（Files 里的文件夹），再去掉前缀试一次
  if (hasDir) add(buildMediaUrl(baseUrl, last));

  // 视频再试一次托管视频目录；带目录前缀时用去掉前缀的文件名，别拼成 /videos/videos/
  if (/\.(mp4|mov|webm|m4v|ogv)$/i.test(clean)) {
    add(buildMediaUrl(videoBaseUrl(baseUrl), hasDir ? last : clean));
  }

  return out;
}

/**
 * Shopify CDN 的尺寸 / 裁剪后缀，去掉后就是原图。
 * 形如 xxx_1600x.png、xxx_1600x900.png、xxx_x900.png、xxx_crop_center.png、xxx_grande.png、xxx@2x.png
 */
export function originalName(name) {
  return String(name)
    .replace(
      /_(?:\d+x\d+|\d+x|x\d+|crop_[a-z]+|grande|medium|small|compact|large|thumb|icon|pico)(?=\.[a-z0-9]+$)/i,
      ''
    )
    .replace(/@\d+x(?=\.[a-z0-9]+$)/i, '');
}

async function fetchOne(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // 不要声明 avif/webp：CDN 会据此转码，拿到的就不是原图了
        Accept: '*/*',
      },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, url };

    // 有些托管/CDN 对不存在的文件返回 200 + HTML 错误页，靠内容类型挡掉
    const ctype = res.headers.get('content-type') || '';
    if (/text\/html/i.test(ctype)) {
      return { ok: false, reason: '返回的是 HTML 页面（文件可能不存在）', url };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) return { ok: false, reason: '返回空文件', url };
    return { ok: true, bytes: buf, size: buf.length, contentType: res.headers.get('content-type') || '', url };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return { ok: false, reason: aborted ? '下载超时' : String(e && e.message ? e.message : e).slice(0, 200), url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 并发下载媒体，结果里带原始字节（由调用方决定写盘还是打包）
 */
export async function downloadMedia({ items, baseUrl, concurrency = 5, timeout = 60000, onProgress }) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  let finished = 0;

  async function worker() {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= list.length) return;

      const it = list[idx];
      // 原图优先：先去尺寸后缀，404 再退回带后缀的地址
      const candidates = [];
      const orig = originalName(it.name);
      if (orig && orig !== it.name) candidates.push(orig);
      candidates.push(it.name);

      // 每个候选名可能对应多个地址（Files / 托管视频 / 去掉目录前缀）
      const targets = [];
      if (it.url) {
        // 手工补充的地址已经是完整 URL，不再拼接
        targets.push({ candidate: it.name, url: it.url });
      } else {
        for (const candidate of candidates) {
          for (const url of buildMediaUrls(baseUrl, candidate)) {
            targets.push({ candidate, url });
          }
        }
      }

      let last = { ok: false, reason: targets.length ? '下载失败' : '未配置下载地址' };
      for (const t of targets) {
        // eslint-disable-next-line no-await-in-loop
        const r = await fetchOne(t.url, timeout);
        last = r;
        if (r.ok) {
          // JSON 写的扩展名才是准的：内容不符就当场转码（如 .webp 名 + PNG 内容）
          const wantExt = conversionTarget(it.name, r.bytes);
          let bytes = r.bytes;
          let converted = false;
          if (wantExt) {
            // eslint-disable-next-line no-await-in-loop
            const out = await convertImageBytes(bytes, mimeOfExt(wantExt));
            if (out) {
              bytes = out;
              converted = true;
            }
          }
          results[idx] = {
            name: it.name,
            converted,
            convertTarget: converted ? wantExt : null,
            resolvedName: t.candidate,
            ...r,
            bytes,
            size: bytes.length,
          };
          break;
        }
      }
      if (!results[idx]) {
        results[idx] = { name: it.name, ...last };
      }

      finished += 1;
      if (onProgress) onProgress({ done: finished, total: list.length, name: it.name });
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker);
  await Promise.all(workers);

  return {
    baseUrl: String(baseUrl || ''),
    total: list.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    totalSize: results.reduce((s, r) => s + (r.ok ? r.size : 0), 0),
    results,
  };
}
