/**
 * JSON 模板里的 section 统计。
 *
 * Shopify 对非 Plus 店铺有硬限制：**每个 JSON 模板最多 25 个 section**，
 * 超过后新增的 section 不会生效。搬迁前先看这个数字，能省掉一次返工。
 *
 * 两种写法都要能数：
 *   新版  { "sections": { "main": {...}, "specs": {...} } }
 *   旧版  { "sections": [ {...}, {...} ] }
 *
 * 另外，有的模板开头带 `/* ... *\/` 注释块（编辑器导出时留下的），
 * 标准 JSON.parse 会直接报错，所以解析前先把注释和多余逗号清掉。
 */

export const SECTION_LIMIT = 25;

/**
 * 把「看起来像 JSON 但不是严格 JSON」的文本清理成可解析的形式：
 *   - 去掉 /* *\/ 块注释和 // 行注释（字符串内部不动，避免破坏 https:// 这类值）
 *   - 去掉对象 / 数组末尾多余的逗号
 *   - 去掉 BOM
 */
export function stripJsonNoise(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  let out = '';
  let inString = false;

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    const next = s[i + 1];

    if (inString) {
      out += c;
      if (c === '\\') {
        out += next || '';
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    // 行注释：跳到行尾
    if (c === '/' && next === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    // 块注释：跳到 */
    if (c === '/' && next === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }

    // 尾随逗号：后面（跳过空白）紧跟 } 或 ] 就丢掉
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (s[j] === '}' || s[j] === ']') continue;
    }

    out += c;
  }

  return out;
}

/** 容错解析：先按原样试，失败再清理注释 / 尾逗号重试 */
export function parseTemplateJson(text) {
  const raw = String(text || '');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return JSON.parse(stripJsonNoise(raw));
  }
}

/** 数一数模板 JSON 里定义了多少个 section */
export function countSections(json) {
  if (!json || typeof json !== 'object') return 0;

  // 极端情况：整个文件就是一个 section 数组
  if (Array.isArray(json)) return json.length;

  const sections = json.sections;
  if (Array.isArray(sections)) return sections.length;
  if (sections && typeof sections === 'object') return Object.keys(sections).length;
  return 0;
}
