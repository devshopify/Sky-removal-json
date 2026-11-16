import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanSite } from '../src/core/indexer.js';
import { createNodeReader } from '../server/node-reader.js';
import { resolveDependencies } from '../src/core/resolver.js';
import { compareSites, compareMedia } from '../src/core/compare.js';
import { buildMediaUrl, buildMediaUrls, videoBaseUrl } from '../src/core/downloader.js';
import { buildZipName, mediaBundleKind } from '../src/core/bundle.js';
import { parseExtraUrls, mergeManualMedia, kindOf } from '../src/core/extras.js';
import { countSections, SECTION_LIMIT, parseTemplateJson } from '../src/core/template.js';
import { sniffImageExt, conversionTarget, mimeOfExt } from '../src/core/media-format.js';
import { classifyString } from '../src/core/parsers/shared.js';
import { originalName } from '../src/core/downloader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const A_DIR = path.join(__dirname, 'fixtures/A-theme');
const B_DIR = path.join(__dirname, 'fixtures/B-theme');
const ENTRY = process.argv[2] || 'templates/product.a2-3000.json';

const A = await scanSite(createNodeReader(A_DIR));
const B = await scanSite(createNodeReader(B_DIR));

console.log(`A: ${A.label}  (${A.stats.total} files)`);
console.log(`B: ${B.label}  (${B.stats.total} files)`);
console.log(`entry: ${ENTRY}`);

const deps = await resolveDependencies(A, ENTRY);
console.log(`scope: ${JSON.stringify(deps.scope)}
`);
const cmp = await compareSites(A, B, deps);
const media = await compareMedia(A, B, deps.media);

const pad = (s, n) => String(s).padEnd(n);
console.log('== 主题文件 ==');
console.log(pad('STATUS', 11) + pad('CATEGORY', 12) + pad('PATH', 46) + 'VIA');
console.log('-'.repeat(118));
for (const it of cmp.items) {
  console.log(pad(it.status, 11) + pad(it.category, 12) + pad(it.rel, 46) + (it.via || '(entry)'));
}

console.log('\n== 媒体资源 ==');
console.log(pad('STATUS', 11) + pad('KIND', 8) + pad('NAME', 34) + 'REF');
for (const m of media) {
  console.log(pad(m.status, 11) + pad(m.kind, 8) + pad(m.name, 34) + `${m.refFrom} (${m.refKey || '-'})`);
}
if (!media.length) console.log('  (无)');

if (deps.externals.length) {
  console.log('\n== 其他外部引用 ==');
  for (const e of deps.externals) console.log(`  [${e.kind}] ${e.name}  <- ${e.refFrom}`);
}
if (deps.unresolved.length) {
  console.log('\n== 未解析 ==');
  for (const u of deps.unresolved) console.log(`  [${u.kind}] ${u.target}  <- ${u.refFrom}`);
}
if (deps.dynamics.length) {
  console.log('\n== 动态引用 ==');
  for (const d of deps.dynamics) console.log(`  ${d.target}  <- ${d.refFrom}`);
}

// CDN 拼接
console.log('\n== 下载地址拼接 ==');
const base = 'https://es.dreametech.com/cdn/shop/files/';
for (const m of media) console.log('  ' + buildMediaUrl(base, m.name));

if (ENTRY !== 'templates/product.a2-3000.json') {
  console.log('\n(自定义入口，跳过断言)');
  process.exit(0);
}

// 断言
let fail = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  期望 ${expected} / 实际 ${actual}`);
};

console.log('\n== 断言：只查 liquid + 媒体 ==');
const fileStatus = (rel) => cmp.items.find((i) => i.rel === rel)?.status || 'NOT FOUND';
const mediaStatus = (name) => media.find((m) => m.name === name)?.status || 'NOT FOUND';

check('sections/product-specs-comparison.liquid', fileStatus('sections/product-specs-comparison.liquid'), 'missing');
check('snippets/product-card.liquid', fileStatus('snippets/product-card.liquid'), 'missing');
check('snippets/icon-arrow.liquid', fileStatus('snippets/icon-arrow.liquid'), 'identical');
check('assets/hero-banner.jpg', fileStatus('assets/hero-banner.jpg'), 'identical');
check('assets/hero-banner-mobile.jpg', fileStatus('assets/hero-banner-mobile.jpg'), 'identical');
check('assets/icon-arrow.svg', fileStatus('assets/icon-arrow.svg'), 'identical');
check('assets/product-video.mp4', fileStatus('assets/product-video.mp4'), 'missing');

console.log('\n== 断言：css/js/子json 不应进入清单 ==');
check('assets/theme.css 未纳入', fileStatus('assets/theme.css'), 'NOT FOUND');
check('assets/theme.js 未纳入', fileStatus('assets/theme.js'), 'NOT FOUND');
check('assets/a2-3000-specs.json 未纳入', fileStatus('assets/a2-3000-specs.json'), 'NOT FOUND');
check('assets/font-inter.woff2 未纳入', fileStatus('assets/font-inter.woff2'), 'NOT FOUND');

console.log('\n== 断言：page_css 展开成 css 文件 ==');
check('product-s9-pro.css', fileStatus('assets/product-s9-pro.css'), 'missing');
check('product-s9-diff.css', fileStatus('assets/product-s9-diff.css'), 'missing');
check(
  'page_css 总数（含去重）',
  String(cmp.items.filter((i) => i.refKey === 'sections.main.settings.page_css' || i.refKey === 'sections.specs_bottom.settings.page_css').length),
  '2'
);

console.log('\n== 断言：shopify:// 协议引用都要下载 ==');
check('a2-bg_1600x.jpg (shop_images)', mediaStatus('a2-bg_1600x.jpg'), 'download');
check('a2-3000-promo.mp4 (videos)', mediaStatus('a2-3000-promo.mp4'), 'download');
check('媒体总数', String(media.length), '2');

console.log('\n== 断言：带完整地址的不下载 ==');
{
  const cdnCls = classifyString('https://cdn.shopify.com/s/files/1/0553/1320/3405/files/remote-only.png?v=1');
  check('CDN 完整链接 -> http 来源', cdnCls && cdnCls.scheme, 'http');
  const fileCls = classifyString('shopify://files/manual.pdf');
  check('shopify://files -> shopify 来源', fileCls && fileCls.scheme, 'shopify');
  const vidCls = classifyString('shopify://videos/a.mp4');
  check('shopify://videos -> shopify 来源', vidCls && vidCls.scheme, 'shopify');
}

console.log('\n== 断言：原图优先（去掉尺寸后缀） ==');
check('a_1600x.png', originalName('a_1600x.png'), 'a.png');
check('a_1600x900.png', originalName('a_1600x900.png'), 'a.png');
check('a_x900.png', originalName('a_x900.png'), 'a.png');
check('a@2x.png', originalName('a@2x.png'), 'a.png');
check('a_crop_center.jpg', originalName('a_crop_center.jpg'), 'a.jpg');
check('普通文件名不变', originalName('product-s9-pro.png'), 'product-s9-pro.png');
check('中间带下划线不误伤', originalName('size_100x_test.png'), 'size_100x_test.png');

console.log('\n== 断言：CDN 拼接 ==');
check('a2-bg.jpg URL', buildMediaUrl(base, 'a2-bg.jpg'), 'https://es.dreametech.com/cdn/shop/files/a2-bg.jpg');
check('base 无斜杠', buildMediaUrl('https://es.dreametech.com/cdn/shop/files', 'x.png'), 'https://es.dreametech.com/cdn/shop/files/x.png');

console.log('\n== 断言：托管视频走 /videos/ 目录 ==');
check('视频基址', videoBaseUrl(base), 'https://es.dreametech.com/cdn/shop/videos/');
check(
  'c/vp 路径优先走 videos',
  buildMediaUrls(base, 'c/vp/abc123/abc123.HD-1080p-7.2Mbps-1.mp4')[0],
  'https://es.dreametech.com/cdn/shop/videos/c/vp/abc123/abc123.HD-1080p-7.2Mbps-1.mp4'
);
check(
  '普通图片只有一个候选',
  buildMediaUrls(base, 'a2-bg.jpg').length,
  1
);
check(
  '带目录前缀的视频试三种',
  buildMediaUrls(base, 'videos/a.mov').join(' | '),
  [
    'https://es.dreametech.com/cdn/shop/files/videos/a.mov',
    'https://es.dreametech.com/cdn/shop/files/a.mov',
    'https://es.dreametech.com/cdn/shop/videos/a.mov',
  ].join(' | ')
);

console.log('\n== 断言：手工补充的视频地址 ==');
{
  const list = parseExtraUrls(`
    https://global.dreametech.com/cdn/shop/videos/c/vp/abc/abc.HD-1080p-7.2Mbps-1.mp4?v=0
    https://cdn.shopify.com/videos/c/o/v/xyz.mp4
    https://global.dreametech.com/cdn/shop/videos/c/vp/abc/abc.HD-1080p-7.2Mbps-1.mp4?v=0
    这不是地址
  `);
  check('去重后条数', String(list.length), '2');
  check('带 ?v= 时取文件名', list[0].name, 'abc.HD-1080p-7.2Mbps-1.mp4');
  check('保留原始 URL', String(list[0].url.endsWith('?v=0')), 'true');
  check('非 http 全部忽略', String(list.every((x) => /^https?:/.test(x.url))), 'true');

  const merged = mergeManualMedia(
    [{ name: 'a.mov' }],
    'https://x.com/videos/c/vp/1/1.mp4 https://x.com/videos/c/vp/2/2.mp4'
  );
  check('并入媒体条数', String(merged.length), '2');
  check('并入后状态', merged[0].status, 'download');
  check('并入后类型', merged[0].kind, 'video');
  check('与已有同名不重复', String(mergeManualMedia([{ name: '1.mp4' }], 'https://x.com/a/1.mp4').length), '0');

  // 整页源码也能直接粘
  const html = '<video src="https://cdn.shopify.com/videos/c/o/v/abc.mp4" poster="https://x.com/p.jpg"></video>'
    + '<script>var u = "https://global.x.com/videos/c/vp/1/1.mp4";</script>';
  const fromHtml = parseExtraUrls(html);
  check('源码抽取条数', String(fromHtml.length), '3');
  check('源码里的视频识别', kindOf('https://cdn.shopify.com/videos/c/o/v/abc.mp4'), 'video');
  check('源码里的图片识别', kindOf('https://x.com/p.jpg'), 'image');
  check('页面地址被忽略', String(parseExtraUrls('https://global.dreametech.com/products/t16-pro-heat').length), '0');
  check(
    '图片并入后归到图片',
    mergeManualMedia([], 'https://x.com/a.png')[0].kind,
    'image'
  );

  const named = parseExtraUrls('t16ph_v-mb-media3-video1.mov | https://x.com/videos/c/vp/1/abcd.mp4');
  check('显式文件名生效', named[0].name, 't16ph_v-mb-media3-video1.mov');
  check('显式命名不影响地址', named[0].url, 'https://x.com/videos/c/vp/1/abcd.mp4');
  check(
    '没写名字时用地址末段',
    parseExtraUrls('https://x.com/videos/c/vp/1/abcd.mp4')[0].name,
    'abcd.mp4'
  );
}

console.log('\n== 断言：模板 section 统计 ==');
{
  const entryJson = JSON.parse(
    fs.readFileSync(path.join(A_DIR, 'templates/product.a2-3000.json'), 'utf8')
  );
  check('示例入口的 section 数', String(countSections(entryJson)), '2');
  check('没有 sections 字段', String(countSections({})), '0');
  check('null 输入', String(countSections(null)), '0');
  check('空数组算 0', String(countSections({ sections: [] })), '0');
  check('旧版数组格式', String(countSections({ sections: [{}, {}, {}] })), '3');
  check('整个文件是数组', String(countSections([{}, {}])), '2');
  check('非 Plus 上限常量', String(SECTION_LIMIT), '25');

  // 带注释 / 尾逗号的模板（编辑器导出常见写法）
  const commented = `/*
 * auto generated, do not edit
 */
{
  // 主模块
  "sections": {
    "main": { "type": "hero", "settings": { "url": "https://x.com/a.png" } },
    "specs": { "type": "specs" },
  }
}`;
  const parsed = parseTemplateJson(commented);
  check('带注释的模板能解析', String(countSections(parsed)), '2');
  check('字符串里的 // 不受影响', parsed.sections.main.settings.url, 'https://x.com/a.png');
  check('尾随逗号被容忍', typeof parsed.sections.specs, 'object');
  check('严格 JSON 仍走原路径', String(countSections(parseTemplateJson('{"sections":{"a":{}}}'))), '1');
}

console.log('\n== 断言：按 JSON 扩展名转码的判断 ==');
{
  const pad = (arr) => new Uint8Array([...arr, ...new Array(Math.max(0, 12 - arr.length)).fill(0)]);
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpg = pad([0xff, 0xd8, 0xff, 0xe1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

  check('PNG 头', sniffImageExt(png), '.png');
  check('JPEG 头', sniffImageExt(jpg), '.jpg');
  check('WebP 头', sniffImageExt(webp), '.webp');
  check('视频头不是图片', String(sniffImageExt(mp4)), 'null');

  check('webp 名 + PNG 内容 → 转码', conversionTarget('a.webp', png), '.webp');
  check('webp 名 + JPEG 内容 → 转码', conversionTarget('a.webp', jpg), '.webp');
  check('webp 名 + WebP 内容 → 不转', String(conversionTarget('a.webp', webp)), 'null');
  check('png 名 + PNG 内容 → 不转', String(conversionTarget('a.png', png)), 'null');
  check('png 名 + JPEG 内容 → 转 png', conversionTarget('a.png', jpg), '.png');
  check('视频不参与转码', String(conversionTarget('a.mp4', mp4)), 'null');
  check('gif 不参与转码', String(conversionTarget('a.gif', png)), 'null');
  check('webp 的 MIME', mimeOfExt('.webp'), 'image/webp');
}

console.log('\n== 断言：图片 / 视频分开打包 ==');
check('图片 kind', mediaBundleKind('image'), 'image');
check('视频 kind', mediaBundleKind('video'), 'video');
check('音频归入其他', mediaBundleKind('audio'), 'other');
check('未知 kind 归入其他', mediaBundleKind(undefined), 'other');
check('自定义名 + 图片包（不加后缀）', buildZipName('image', 2, 'myzip', 'slug', 1), 'myzip.zip');
check('自定义名 + 视频包', buildZipName('video', 2, 'myzip', 'slug', 1), 'myzip-视频.zip');
check('自定义名 + 主题包', buildZipName('theme', 3, 'myzip', 'slug', 1), 'myzip-主题文件.zip');
check('只有图片包也用原名', buildZipName('image', 1, 'myzip', 'slug', 1), 'myzip.zip');
check('单独主题包用原名', buildZipName('theme', 1, 'myzip', 'slug', 1), 'myzip.zip');
check('无自定义名', buildZipName('video', 2, '', 'slug', 1), '视频-slug-1.zip');
check('媒体类型区分', media.map((m) => m.kind).sort().join(','), 'image,video');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
