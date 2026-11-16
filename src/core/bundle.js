/**
 * 打包分组与 zip 命名 —— 纯逻辑，浏览器与 Node 测试共用。
 *
 * 媒体按图片 / 视频 / 其他拆成独立 zip，方便分别上传；
 * 主题文件单独一个包。
 */

/** zip 包类型的中文名，同时用作文件名后缀 */
export const BUNDLE_LABEL = {
  image: '图片',
  video: '视频',
  other: '媒体',
  theme: '主题文件',
};

/** 媒体 kind 归并成打包类型：image / video / 其余 */
export function mediaBundleKind(kind) {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  return 'other';
}

/**
 * 生成 zip 文件名。
 * 没填自定义名：`类型-入口-时间戳.zip`
 * 填了自定义名：图片包直接用这个名字（不加后缀）；其余包加类型后缀，
 * 避免和图片包同名互相覆盖
 */
export function buildZipName(kind, bundleCount, custom, entrySlug, stamp) {
  const label = BUNDLE_LABEL[kind] || kind;
  if (!custom) return `${label}-${entrySlug}-${stamp}.zip`;
  // 图片包用自定义名原名；主题包单独存在时也用原名
  if (kind === 'image' || bundleCount === 1) return `${custom}.zip`;
  return `${custom}-${label}.zip`;
}
