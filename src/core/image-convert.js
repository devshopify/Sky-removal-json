/**
 * 图片转码（仅浏览器环境）。
 *
 * 用 canvas 重新编码：JSON 里写 `.webp` 而源文件是 PNG 时，
 * 把内容真正转成 WebP，这样上传后文件名和内容一致，不会被 Shopify 改名。
 *
 * 注意：转码会丢掉 EXIF、可能轻微影响画质；JPEG 目标会先铺白底（避免透明变黑）。
 */

export async function convertImageBytes(bytes, mime, quality = 0.92) {
  if (!mime || typeof document === 'undefined') return null;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(new Blob([bytes]));
    const { width, height } = bitmap;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    // 浏览器不支持该编码时会静默回退成 png，这里挡掉
    if (!blob || blob.type !== mime) return null;

    return new Uint8Array(await blob.arrayBuffer());
  } catch (e) {
    return null;
  } finally {
    if (bitmap && bitmap.close) bitmap.close();
  }
}
