/**
 * Nylah OS — Image helpers for love-note photos
 * Goal: avoid LS/IDB quota blow by resizing before persist.
 * - resizeToDataUrl: max dimension preserve aspect, jpeg 0.7
 * - createThumbnail: 120x120 center-cover crop
 */

export type ResizeOpts = {
  mime?: string;
  quality?: number;
};

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Resize any dataUrl / blob url to max side (width or height) = maxDim.
 * Keeps aspect ratio, returns image/jpeg dataUrl with quality.
 * If image already smaller than maxDim, still recompresses to jpeg (saves 70%).
 */
export async function resizeToDataUrl(
  src: string,
  maxDim: number = 600,
  mime: string = "image/jpeg",
  quality: number = 0.7
): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") return src;
  if (!src || !src.startsWith("data:")) return src;
  try {
    const img = await loadImg(src);
    const w = (img as any).naturalWidth || (img as any).width || 0;
    const h = (img as any).naturalHeight || (img as any).height || 0;
    if (w === 0 || h === 0) return src;
    let outW = w;
    let outH = h;
    const maxSide = Math.max(w, h);
    if (maxSide > maxDim) {
      const scale = maxDim / maxSide;
      outW = Math.round(w * scale);
      outH = Math.round(h * scale);
    }
    // avoid upscaling tiny images to save CPU but still compress
    // clamp to at least 1px
    outW = Math.max(1, outW);
    outH = Math.max(1, outH);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    // white bg for jpeg (avoid transparent black)
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(img, 0, 0, outW, outH);
    const out = canvas.toDataURL(mime, quality);
    // sanity: if output not smaller but we shrank, keep output; if output larger than input and we didn't shrink, keep input
    if (out.length > src.length && outW === w && outH === h) return src;
    return out;
  } catch {
    return src;
  }
}

/**
 * 120x120 center-crop thumbnail, jpeg 0.7.
 * Used for list / stickyPick to avoid decoding full 2MP image for tiny UI.
 */
export async function createThumbnail(src: string, size: number = 120, mime: string = "image/jpeg", quality: number = 0.7): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") return src;
  if (!src) return src;
  try {
    const img = await loadImg(src);
    const w = (img as any).naturalWidth || (img as any).width || size;
    const h = (img as any).naturalHeight || (img as any).height || size;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    // cover: scale to fill size, center crop
    const scale = Math.max(size / w, size / h);
    const sw = w * scale;
    const sh = h * scale;
    const dx = (size - sw) / 2;
    const dy = (size - sh) / 2;
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, size, size);
    }
    ctx.drawImage(img, dx, dy, sw, sh);
    return canvas.toDataURL(mime, quality);
  } catch {
    return src;
  }
}

/**
 * Convenience: resize to max 600 then thumb 120 in parallel.
 */
export async function resizeAndThumb(src: string): Promise<{ full: string; thumb: string }> {
  const full = await resizeToDataUrl(src, 600, "image/jpeg", 0.7);
  const thumb = await createThumbnail(full, 120, "image/jpeg", 0.7);
  return { full, thumb };
}

export default resizeToDataUrl;
