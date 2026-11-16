/**
 * 手工补充的媒体地址。
 *
 * 有些视频在主题里只留了文件名（`{{ 'videos/x.mov' | file_url }}`），
 * 而 CDN 上的真实地址是哈希路径，靠名字拼不出来。
 * 这种情况可以把地址粘进来，直接参与下载与打包。
 *
 * 除了「一行一条地址」，也支持直接粘整页源码 / 控制台输出：
 * 会把里面所有媒体地址抠出来，省得一条条复制。
 */

/** 从任意文本里抠出 URL，HTML、JSON、控制台输出都能吃 */
const URL_RE = /https?:\/\/[^\s"'<>\\)\]]+/gi;

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)$/i;

function stripQuery(url) {
  return String(url || '').split('?')[0].split('#')[0];
}

/** 是不是一个可以直接下载的媒体地址（页面地址会被忽略） */
export function looksLikeMedia(url) {
  const clean = stripQuery(url);
  if (VIDEO_EXT_RE.test(clean) || AUDIO_EXT_RE.test(clean) || IMAGE_EXT_RE.test(clean)) return true;
  // Shopify 托管视频：/videos/c/vp/<hash>/…，扩展名可能被省略
  return /\/videos\/c\/(vp|o)\//i.test(clean);
}

export function kindOf(url) {
  const clean = stripQuery(url);
  if (VIDEO_EXT_RE.test(clean) || /\/videos\//i.test(clean)) return 'video';
  if (AUDIO_EXT_RE.test(clean)) return 'audio';
  return 'image';
}

/** 取 URL 最后一段当文件名，带 ?v= 之类的参数先剥掉 */
export function nameFromUrl(url, index = 0) {
  const clean = stripQuery(url);
  const raw = clean.split('/').filter(Boolean).pop() || '';
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch (e) {
    // 编码坏了就保留原样
  }
  return name || `media-${index + 1}`;
}

/**
 * 解析粘贴进来的内容：一行一条、逗号分隔、整页源码、控制台输出都行。
 * 只保留媒体地址，自动去重。
 *
 * 想保住原文件名时，可以在地址前写「文件名 | 地址」，例如：
 *   t16ph_v-mb-media3-video1.mov | https://…/xxxx.mp4
 * 不写就用地址最后一段。
 */
export function parseExtraUrls(text) {
  const src = String(text || '');
  const out = [];
  const seen = new Set();

  // 先收集显式命名的行，再统一扫描地址
  const named = new Map();
  src.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([^\s|>]+)\s*(?:\||=>)\s*(https?:\/\/\S+)\s*$/);
    if (!m) return;
    if (/^https?:/i.test(m[1])) return;
    named.set(m[2].replace(/[.,;]+$/, ''), m[1]);
  });

  const matches = src.match(URL_RE) || [];
  matches.forEach((raw) => {
    // 句末标点、末尾逗号不属于地址
    const url = raw.replace(/[.,;]+$/, '');
    if (seen.has(url)) return;
    if (!looksLikeMedia(url)) return;
    seen.add(url);
    const custom = named.get(url);
    out.push({
      url,
      name: custom || nameFromUrl(url, out.length),
      kind: kindOf(url),
    });
  });

  return out;
}

/**
 * 把手工地址并进媒体清单，形态与 compareMedia 产出的条目一致，
 * 这样表格分组、勾选、打包都不用单独处理。
 */
export function mergeManualMedia(media, extraText) {
  const known = new Set((media || []).map((m) => m.name));
  return parseExtraUrls(extraText)
    .filter((m) => !known.has(m.name))
    .map((m) => ({
      name: m.name,
      url: m.url,
      kind: m.kind || 'video',
      bucket: 'manual',
      raw: m.url,
      refFrom: '手工补充的地址',
      refKey: '',
      themeAsset: null,
      rel: null,
      status: 'download',
      action: 'download',
      size: null,
      b: null,
    }));
}
