/**
 * 图片格式判定与转码决策。
 *
 * 原则：**以主题 JSON 里的扩展名为准**。
 * JSON 写 `xxx.webp`，那下载下来就必须是真的 WebP；写 `.png` 就必须是 PNG。
 * 否则上传 Shopify 时平台按内容识别类型，会改名成 .png/.jpg，和引用对不上。
 *
 * 实测这批素材：106 个文件全叫 `.webp`，内容却是 84 个 PNG + 22 个 JPEG。
 */

/** 从文件头判断图片格式，返回小写扩展名；不是图片返回 null */
export function sniffImageExt(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return '.gif';
  // WebP: "RIFF" .... "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return '.webp';
  // AVIF: 第 4-7 字节是 "ftyp"，品牌在 8-11
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return '.avif';
  }
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return '.bmp';

  return null;
}

/** SVG 是文本，单独判断 */
export function looksLikeSvg(bytes) {
  if (!bytes || !bytes.length) return false;
  const head = String.fromCharCode(...bytes.subarray(0, 300)).trimStart().toLowerCase();
  return head.startsWith('<svg') || head.startsWith('<?xml');
}

/** 取名字里的扩展名（小写），没有返回 '' */
export function extOfName(name) {
  const m = String(name || '').match(/\.[a-z0-9]+$/i);
  return m ? m[0].toLowerCase() : '';
}

const normExt = (e) => (e === '.jpeg' ? '.jpg' : e);

/** 能转码的目标格式（gif / avif / svg 不处理） */
const CONVERTIBLE = new Set(['.webp', '.png', '.jpg']);

/**
 * 判断下载到的内容要不要转码才能符合 JSON 里的扩展名。
 * 返回目标扩展名（如 '.webp'），不需要转返回 null。
 */
export function conversionTarget(name, bytes) {
  const target = extOfName(name);
  if (!target || !CONVERTIBLE.has(normExt(target))) return null;

  const content = sniffImageExt(bytes) || (looksLikeSvg(bytes) ? '.svg' : null);
  if (!content) return null;
  if (normExt(content) === normExt(target)) return null;

  return target;
}

/** 目标扩展名 → canvas 编码用的 MIME */
export function mimeOfExt(ext) {
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return '';
}
