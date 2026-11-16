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
 * 填了自定义名：媒体包一律带 `-图片` / `-视频` 后缀，方便分辨该传哪一批；
 * 主题文件只有单独一个包时直接用原名，不额外加后缀
 */
export function buildZipName(kind, bundleCount, custom, entrySlug, stamp) {
  const label = BUNDLE_LABEL[kind] || kind;
  if (!custom) return `${label}-${entrySlug}-${stamp}.zip`;
  if (kind === 'theme' && bundleCount === 1) return `${custom}.zip`;
  return `${custom}-${label}.zip`;
}
