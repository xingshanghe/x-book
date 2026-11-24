import type { ComicFitMode } from '@/types/models';

/** 设备像素比封顶，避免超大扫描件撑爆 canvas */
export const MAX_DEVICE_PIXEL_RATIO = 2;

export function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.trunc(index)));
}

/** 进度：首页 0，末页 1；单页书打开即 1 */
export function pagePercent(pageIndex: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  if (pageCount === 1) return 1;
  return clampPageIndex(pageIndex, pageCount) / (pageCount - 1);
}

export function fitScale(
  pageW: number,
  pageH: number,
  viewW: number,
  viewH: number,
  mode: ComicFitMode,
): number {
  if (pageW <= 0 || pageH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  const sw = viewW / pageW;
  const sh = viewH / pageH;
  if (mode === 'fitWidth') return sw;
  if (mode === 'fitHeight') return sh;
  return Math.min(sw, sh);
}

export function cappedDpr(raw = typeof window !== 'undefined' ? window.devicePixelRatio : 1): number {
  return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, raw || 1));
}

export interface PanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 缩放后内容相对视口的可平移范围（居中为原点） */
export function panBounds(
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number,
): PanBounds {
  const slackX = Math.max(0, contentW - viewW);
  const slackY = Math.max(0, contentH - viewH);
  return {
    minX: slackX ? -slackX / 2 : 0,
    maxX: slackX ? slackX / 2 : 0,
    minY: slackY ? -slackY / 2 : 0,
    maxY: slackY ? slackY / 2 : 0,
  };
}

export function clampPan(x: number, y: number, bounds: PanBounds): { x: number; y: number } {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  };
}
