/**
 * 功能开关。
 *
 * 自动识别出的视频暂时不下载：CDN 上的视频地址是哈希路径，靠文件名拼不出来，
 * 强行下载只会得到一堆 404。这类在表格里「仅展示」+ 一键复制名字，
 * 由人工在后台 Files 里处理；侧栏「视频地址补充」里手填的完整地址仍然可以下载。
 *
 * 等接入 Admin API（scripts/fetch-files.js）或需要恢复自动下载时，把这里改成 true。
 */
export const VIDEO_DOWNLOAD_ENABLED = false;

/**
 * 结果区右上角的「报告」导出按钮。
 * 暂时隐藏，导出逻辑（exportReport）保留着，改回 true 即可恢复。
 */
export const REPORT_ENABLED = false;

