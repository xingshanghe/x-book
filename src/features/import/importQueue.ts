/**
 * 导入队列：串行处理，可取消，进度上报。
 * 串行的原因：让每本书尽快「完成」而不是全都卡在半路；
 * Worker 与主线程互不阻塞，队列状态驱动书架上的导入卡片。
 */

import { create } from 'zustand';
import { useSettings } from '@/app/store';
import { fingerprint } from '@/core/parser/indexer';
import { runIndex } from '@/core/worker/client';
import { probePdfMeta } from '@/features/comic/pdfEngine';
import { formatBytes } from '@/lib/format';
import { nanoid } from '@/lib/id';
import { deleteBookFile, getBookBlob, putBookFile } from '@/storage/blobStore';
import { putBookCover } from '@/storage/coverStore';
import {
  findByFingerprint,
  newBookRecord,
  putBook,
  saveIndex,
} from '@/storage/repositories/bookRepo';
import { loadUserRules } from '@/storage/repositories/defaults';
import type { Book } from '@/types/models';
import { toast } from '@/ui';

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'duplicate' | 'cancelled';

export interface ImportTask {
  id: string;
  fileName: string;
  size: number;
  ratio: number;
  status: TaskStatus;
  error?: string;
  bookId?: string;
}

interface ImportStore {
  tasks: ImportTask[];
  /** 是否有文件悬在窗口上（拖放遮罩用） */
  dragging: boolean;
  add: (files: File[]) => void;
  setDragging: (v: boolean) => void;
  clearFinished: () => void;
}

const TXT_RE = /\.(txt|text|log|md)$/i;
const PDF_RE = /\.pdf$/i;
const LARGE_PDF_BYTES = 100 * 1024 * 1024;
/** 超过此体积拒绝导入，避免移动端 OOM */
const MAX_PDF_BYTES = 250 * 1024 * 1024;

function isPdfFile(f: File): boolean {
  return PDF_RE.test(f.name) || f.type === 'application/pdf';
}

function isTxtFile(f: File): boolean {
  return TXT_RE.test(f.name) || (f.type.startsWith('text/') && !isPdfFile(f));
}

export const useImportQueue = create<ImportStore>((set) => ({
  tasks: [],
  dragging: false,

  add: (files) => {
    const valid = files.filter((f) => isTxtFile(f) || isPdfFile(f));
    if (valid.length === 0) {
      toast(
        files.length
          ? `不支持的文件类型：${files[0].name || '未知文件'}（只收 txt / md / log / pdf）`
          : '没有读到文件',
        'warn',
      );
      return;
    }
    const tasks: ImportTask[] = valid.map((f) => ({
      id: nanoid(8),
      fileName: f.name,
      size: f.size,
      ratio: 0,
      status: 'queued',
    }));
    set((s) => ({ tasks: [...s.tasks, ...tasks] }));
    void pump(valid, tasks);
  },

  setDragging: (v) => set({ dragging: v }),

  clearFinished: () =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'running' || t.status === 'queued') })),
}));

/**
 * 全局拖放接管：窗口任意位置松手都能导入。
 *
 * 两个坑必须在这里兜住：
 *   1. dragover 不 preventDefault，WebView 会把文件当成导航目标，整页跳成空白；
 *   2. Tauri 默认 dragDropEnabled=true 会吞掉 HTML5 拖放事件，
 *      所以 tauri.conf.json 里要显式关掉，事件才会回到网页。
 */
export function installGlobalDrop(): void {
  if (typeof window === 'undefined') return;
  const state = useImportQueue;
  let depth = 0;

  const allow = (e: DragEvent) => e.preventDefault();
  const carriesFiles = (e: DragEvent) => (e.dataTransfer?.types ?? []).includes('Files');

  const onEnter = (e: DragEvent) => {
    e.preventDefault();
    if (!carriesFiles(e)) return;
    depth++;
    if (depth === 1) state.getState().setDragging(true);
  };

  // 离开时不看 types：部分 WebView 在 dragleave 已清空 dataTransfer，
  // 若跟着判断就会漏减计数，遮罩挂在屏幕上不消失。
  const onLeave = (e: DragEvent) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) state.getState().setDragging(false);
  };

  const reset = () => {
    depth = 0;
    state.getState().setDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    reset();
    const files = e.dataTransfer?.files;
    if (files?.length) state.getState().add([...files]);
  };

  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', allow);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);
  window.addEventListener('dragend', reset);
}

/** 串行泵：逐个跑，直到队列清空 */
async function pump(files: File[], tasks: ImportTask[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    await importOne(files[i], tasks[i].id);
  }
}

function patchTask(id: string, patch: Partial<ImportTask>): void {
  useImportQueue.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

async function importOne(file: File, taskId: string): Promise<void> {
  if (isPdfFile(file)) {
    await importPdf(file, taskId);
    return;
  }
  await importTxt(file, taskId);
}

async function importPdf(file: File, taskId: string): Promise<void> {
  patchTask(taskId, { status: 'running', ratio: 0.05 });
  try {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(
        `文件过大（${formatBytes(file.size)}），请控制在 ${formatBytes(MAX_PDF_BYTES)} 以内`,
      );
    }
    if (file.size > LARGE_PDF_BYTES) {
      toast(`${file.name} 约 ${formatBytes(file.size)}，导入与翻页可能较慢`, 'warn');
    }

    const body = file.slice(0, file.size, 'application/pdf');
    if (!body.size) throw new Error('PDF 为空，未保存');

    const head = new Uint8Array(await body.slice(0, Math.min(body.size, 64 * 1024)).arrayBuffer());
    const fp = fingerprint(body.size, head);
    patchTask(taskId, { ratio: 0.15 });

    const dup = await findByFingerprint(fp);
    if (dup) {
      patchTask(taskId, { status: 'duplicate', bookId: dup.id, ratio: 1 });
      return;
    }

    patchTask(taskId, { ratio: 0.4 });
    let pageCount = 0;
    let cover: Blob | null = null;
    try {
      const meta = await probePdfMeta(body);
      pageCount = meta.pageCount;
      cover = meta.cover;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 旧版 pdf.js + 旧 WebView 会冒这个错；不是权限/文件损坏
      if (/getOrInsertComputed/i.test(msg)) {
        throw new Error('当前环境无法解析 PDF，请更新到最新版客户端后重试');
      }
      throw new Error(`无法解析 PDF：${msg}`);
    }
    if (pageCount < 1) throw new Error('PDF 没有可阅读的页面');

    patchTask(taskId, { ratio: 0.7 });
    const title = file.name.replace(/\.[^.]+$/, '') || '未命名';
    const book: Book = newBookRecord({
      title,
      kind: 'pdf',
      pageCount,
      size: body.size,
      encoding: 'utf-8',
      fingerprint: fp,
      blockCount: pageCount,
      charCount: 0,
      lineCount: 0,
      chapterCount: 0,
      cleanedLines: 0,
      footnoteCount: 0,
      blockSize: 0,
    });

    await putBookFile(book.id, body);
    const stored = await getBookBlob(book.id);
    if (!stored || stored.size !== body.size) {
      await deleteBookFile(book.id);
      throw new Error(`文件写入不完整（${stored?.size ?? 0}/${body.size} 字节）`);
    }

    let hasCover = false;
    if (cover) {
      await putBookCover(book.id, cover);
      hasCover = true;
    }

    await putBook(hasCover ? { ...book, hasCover: true } : book);
    patchTask(taskId, { status: 'done', ratio: 1, bookId: book.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchTask(taskId, { status: 'error', error: msg });
    toast(`${file.name} 导入失败：${msg}`, 'warn');
  }
}

async function importTxt(file: File, taskId: string): Promise<void> {
  patchTask(taskId, { status: 'running', ratio: 0.01 });

  try {
    const settings = useSettings.getState().settings;
    const job = runIndex(
      {
        type: 'index',
        id: taskId,
        file,
        fileName: file.name,
        blockSize: 16384,
        detectChapters: settings.detectChapters,
        customChapterPattern: settings.customChapterPattern,
        cleanAds: settings.cleanAds,
        cleanRules: [...loadUserRules()],
        detectFootnotes: settings.detectFootnotes,
      },
      {
        onProgress: (p) => patchTask(taskId, { ratio: p.ratio }),
      },
    );

    activeJobs.set(taskId, job);
    const outcome = await job.promise;
    activeJobs.delete(taskId);

    // 去重：同指纹直接复用旧书，不重复占空间
    const dup = await findByFingerprint(outcome.fingerprint);
    if (dup) {
      patchTask(taskId, { status: 'duplicate', bookId: dup.id, ratio: 1 });
      return;
    }

    const book: Book = newBookRecord({
      // 书名缺失时退回文件名，绝不让 title 变成空值（书架渲染依赖它）
      title: (outcome.title ?? '').trim() || file.name.replace(/\.[^.]+$/, '') || '未命名',
      author: outcome.author,
      kind: 'txt',
      pageCount: 0,
      size: outcome.scan.byteCount,
      encoding: outcome.encoding,
      fingerprint: outcome.fingerprint,
      blockCount: outcome.scan.blockCount,
      charCount: outcome.scan.charCount,
      lineCount: outcome.scan.lineCount,
      chapterCount: outcome.scan.chapters.length,
      cleanedLines: outcome.scan.cleanedLines,
      footnoteCount: outcome.scan.footnoteCount,
      blockSize: outcome.scan.blockSize,
    });

    // 统一转成纯 Blob 再落库：File 带有磁盘路径语义，部分 WebView 存进
    // IndexedDB 后只剩引用，读回来 size 为 0，就是「有书没字」的成因。
    const body =
      outcome.normalized instanceof File
        ? outcome.normalized.slice(0, outcome.normalized.size, 'text/plain;charset=utf-8')
        : outcome.normalized;
    if (!body.size) throw new Error('正文为空，未保存');

    await putBookFile(book.id, body);

    // 写完立刻读回校验：宁可现在报错，也不要留下一本点开没字的书
    const stored = await getBookBlob(book.id);
    if (!stored || stored.size !== body.size) {
      await deleteBookFile(book.id);
      throw new Error(`正文写入不完整（${stored?.size ?? 0}/${body.size} 字节）`);
    }

    await saveIndex(
      book.id,
      {
        bookId: book.id,
        blockSize: outcome.scan.blockSize,
        count: outcome.scan.blockCount,
        starts: outcome.scan.starts,
        charCounts: outcome.scan.charCounts,
        charOffsets: outcome.scan.charOffsets,
        lineCounts: outcome.scan.lineCounts,
      },
      outcome.scan.chapters.map((c) => ({
        bookId: book.id,
        index: c.index,
        title: c.title,
        blockIndex: c.blockIndex,
        lineInBlock: c.lineInBlock,
        charOffset: c.charOffset,
        level: c.level,
      })),
      outcome.scan.footnotes.map((f) => ({
        bookId: book.id,
        marker: f.marker,
        blockIndex: f.blockIndex,
        lineInBlock: f.lineInBlock,
        text: f.text,
      })),
    );
    await putBook(book);

    patchTask(taskId, { status: 'done', ratio: 1, bookId: book.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchTask(taskId, { status: 'error', error: msg });
    // 托盘 6 秒后自动收起，失败原因必须再走一次 toast，否则用户什么都看不到
    toast(`${file.name} 导入失败：${msg}`, 'warn');
  }
}

const activeJobs = new Map<string, ReturnType<typeof runIndex>>();

export function cancelTask(taskId: string): void {
  activeJobs.get(taskId)?.cancel();
  patchTask(taskId, { status: 'cancelled' });
}

export function describeTask(t: ImportTask): string {
  switch (t.status) {
    case 'queued':
      return '排队中';
    case 'running':
      return `解析中 ${Math.round(t.ratio * 100)}%`;
    case 'done':
      return '完成';
    case 'duplicate':
      return '书架中已存在';
    case 'error':
      return t.error ?? '失败';
    case 'cancelled':
      return '已取消';
  }
}

export function totalBytes(tasks: ImportTask[]): string {
  return formatBytes(tasks.reduce((acc, t) => acc + t.size, 0));
}
