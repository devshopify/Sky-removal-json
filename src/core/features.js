/**
 * 功能开关。
 *
 * 视频下载暂时关闭：CDN 上的视频地址是哈希路径，靠文件名拼不出来，
 * 强行下载只会得到一堆 404。现在改为「只展示清单 + 一键复制名字」，
 * 由人工在 Shopify 后台 Files 里按名字找到后处理。
 *
 * 等接入 Admin API（scripts/fetch-files.js）后再打开。
 */
export const VIDEO_DOWNLOAD_ENABLED = false;

/**
 * 结果区右上角的「报告」导出按钮。
 * 暂时隐藏，导出逻辑（exportReport）保留着，改回 true 即可恢复。
 */
export const REPORT_ENABLED = false;

