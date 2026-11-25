/**
 * pdf.js 封装：打开文档、按页渲染、邻页 LRU 缓存。
 * 页码对外一律 0-based；内部转 pdf.js 的 1-based。
 */

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cappedDpr, thumbCssSize } from './fit';

GlobalWorkerOptions.workerSrc = pdfWorker;

const CACHE_LIMIT = 5;
/** 缩略图 blob 缓存上限（单张很小，可多留） */
const THUMB_CACHE_LIMIT = 48;
/** 单边 canvas 像素上限，避开 Safari/Chrome 硬限制 */
const MAX_CANVAS_EDGE = 4096;

export interface PageSize {
  width: number;
  height: number;
}

export interface RenderedPage {
  pageIndex: number;
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
}

interface CacheEntry {
  key: string;
  page: RenderedPage;
}

function cacheKey(pageIndex: number, cssW: number, cssH: number, dpr: number): string {
  return `${pageIndex}@${Math.round(cssW)}x${Math.round(cssH)}@${dpr.toFixed(2)}`;
}

export class PdfEngine {
  private doc: PDFDocumentProxy | null = null;
  private objectUrl: string | null = null;
  private cache: CacheEntry[] = [];
  private inflight = new Map<string, Promise<RenderedPage>>();
  private renders = new Map<string, RenderTask>();
  /** 缩略图与主画面分轨，翻页 cancel 不会打断侧栏 */
  private thumbBlobs = new Map<number, Blob>();
  private thumbInflight = new Map<number, Promise<Blob | null>>();
  private thumbRenders = new Map<number, RenderTask>();

  get pageCount(): number {
    return this.doc?.numPages ?? 0;
  }

  async open(source: Blob | ArrayBuffer | Uint8Array): Promise<number> {
    await this.close();
    let loading;
    if (source instanceof Blob) {
      this.objectUrl = URL.createObjectURL(source);
      loading = getDocument({ url: this.objectUrl, useSystemFonts: true });
    } else {
      const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
      loading = getDocument({ data, useSystemFonts: true });
    }
    this.doc = await loading.promise;
    return this.doc.numPages;
  }

  async close(): Promise<void> {
    this.cancelAllRenders();
    this.cancelThumbRenders();
    this.inflight.clear();
    this.thumbInflight.clear();
    this.cache = [];
    this.thumbBlobs.clear();
    if (this.doc) {
      try {
        await this.doc.destroy();
      } catch {
        /* ignore */
      }
      this.doc = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** 取消进行中的主画面渲染（翻页 / 缩放切换时调用） */
  cancelAllRenders(): void {
    for (const task of this.renders.values()) {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    }
    this.renders.clear();
  }

  /** 关闭文档时取消缩略图渲染 */
  cancelThumbRenders(): void {
    for (const task of this.thumbRenders.values()) {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
    }
    this.thumbRenders.clear();
  }

  async pageSize(pageIndex: number): Promise<PageSize> {
    const page = await this.getPage(pageIndex);
    const vp = page.getViewport({ scale: 1 });
    return { width: vp.width, height: vp.height };
  }

  /**
   * 按 CSS 像素尺寸渲染；内部乘以封顶后的 dpr，并限制 canvas 边长。
   */
  async renderPage(
    pageIndex: number,
    cssWidth: number,
    cssHeight: number,
    dpr = cappedDpr(),
  ): Promise<RenderedPage> {
    if (!this.doc) throw new Error('PDF 未打开');
    if (pageIndex < 0 || pageIndex >= this.doc.numPages) {
      throw new Error(`页码越界：${pageIndex + 1}/${this.doc.numPages}`);
    }
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    const key = cacheKey(pageIndex, w, h, dpr);
    const hit = this.cache.find((c) => c.key === key);
    if (hit) {
      this.touch(key);
      return hit.page;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const job = this.draw(pageIndex, w, h, dpr, key);
    this.inflight.set(key, job);
    try {
      const page = await job;
      this.cache.push({ key, page });
      while (this.cache.length > CACHE_LIMIT) this.cache.shift();
      return page;
    } finally {
      this.inflight.delete(key);
      this.renders.delete(key);
    }
  }

  /** 预热邻页，失败忽略 */
  prefetch(pageIndex: number, cssWidth: number, cssHeight: number, dpr = cappedDpr()): void {
    if (!this.doc) return;
    if (pageIndex < 0 || pageIndex >= this.doc.numPages) return;
    void this.renderPage(pageIndex, cssWidth, cssHeight, dpr).catch(() => undefined);
  }

  /** 渲第 1 页为 JPEG 封面（最长边 ≤ maxEdge） */
  async renderCoverBlob(maxEdge = 480, quality = 0.82): Promise<Blob | null> {
    if (!this.doc || this.doc.numPages < 1) return null;
    return this.renderThumbBlob(0, maxEdge, quality);
  }

  /**
   * 渲一页缩略图 JPEG。与主画面缓存/cancel 分轨，
   * 翻页时不会被 cancelAllRenders 打断。
   */
  async renderThumbBlob(
    pageIndex: number,
    maxEdge = 144,
    quality = 0.72,
  ): Promise<Blob | null> {
    if (!this.doc) return null;
    if (pageIndex < 0 || pageIndex >= this.doc.numPages) return null;
    const hit = this.thumbBlobs.get(pageIndex);
    if (hit) return hit;
    const pending = this.thumbInflight.get(pageIndex);
    if (pending) return pending;

    const job = this.drawThumb(pageIndex, maxEdge, quality);
    this.thumbInflight.set(pageIndex, job);
    try {
      const blob = await job;
      if (blob) {
        this.thumbBlobs.set(pageIndex, blob);
        while (this.thumbBlobs.size > THUMB_CACHE_LIMIT) {
          const oldest = this.thumbBlobs.keys().next().value;
          if (oldest === undefined) break;
          this.thumbBlobs.delete(oldest);
        }
      }
      return blob;
    } finally {
      this.thumbInflight.delete(pageIndex);
      this.thumbRenders.delete(pageIndex);
    }
  }

  private touch(key: string): void {
    const i = this.cache.findIndex((c) => c.key === key);
    if (i < 0) return;
    const [entry] = this.cache.splice(i, 1);
    this.cache.push(entry);
  }

  private async getPage(pageIndex: number): Promise<PDFPageProxy> {
    if (!this.doc) throw new Error('PDF 未打开');
    return this.doc.getPage(pageIndex + 1);
  }

  private async draw(
    pageIndex: number,
    cssW: number,
    cssH: number,
    dpr: number,
    key: string,
  ): Promise<RenderedPage> {
    const page = await this.getPage(pageIndex);
    const base = page.getViewport({ scale: 1 });
    let scaleX = (cssW * dpr) / base.width;
    let scaleY = (cssH * dpr) / base.height;
    let scale = Math.min(scaleX, scaleY);
    // 边长封顶
    const rawW = base.width * scale;
    const rawH = base.height * scale;
    const edge = Math.max(rawW, rawH);
    if (edge > MAX_CANVAS_EDGE) {
      scale *= MAX_CANVAS_EDGE / edge;
    }
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    const task = page.render({ canvasContext: ctx, viewport, canvas });
    this.renders.set(key, task);
    await task.promise;
    return {
      pageIndex,
      canvas,
      cssWidth: cssW,
      cssHeight: cssH,
    };
  }

  private async drawThumb(
    pageIndex: number,
    maxEdge: number,
    quality: number,
  ): Promise<Blob | null> {
    const size = await this.pageSize(pageIndex);
    const { width: cssW, height: cssH } = thumbCssSize(size.width, size.height, maxEdge);
    const page = await this.getPage(pageIndex);
    const base = page.getViewport({ scale: 1 });
    let scale = Math.min(cssW / base.width, cssH / base.height);
    const edge = Math.max(base.width * scale, base.height * scale);
    if (edge > MAX_CANVAS_EDGE) scale *= MAX_CANVAS_EDGE / edge;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const task = page.render({ canvasContext: ctx, viewport, canvas });
    this.thumbRenders.set(pageIndex, task);
    try {
      await task.promise;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(msg)) return null;
      throw e;
    }
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
  }
}

/** 导入：一次打开取页数 + 封面 */
export async function probePdfMeta(
  blob: Blob,
): Promise<{ pageCount: number; cover: Blob | null }> {
  const engine = new PdfEngine();
  try {
    const pageCount = await engine.open(blob);
    const cover = await engine.renderCoverBlob();
    return { pageCount, cover };
  } finally {
    await engine.close();
  }
}
