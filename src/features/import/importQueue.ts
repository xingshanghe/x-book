/**
 * 导入队列：串行处理，可取消，进度上报。
 * 串行的原因：让每本书尽快「完成」而不是全都卡在半路；
 * Worker 与主线程互不阻塞，队列状态驱动书架上的导入卡片。
 */

import { create } from 'zustand';
import { nanoid } from '@/lib/id';
import { formatBytes } from '@/lib/format';
import { runIndex } from '@/core/worker/client';
import { newBookRecord, findByFingerprint, putBook, saveIndex } from '@/storage/repositories/bookRepo';
import { putBookFile, getBookBlob, deleteBookFile } from '@/storage/blobStore';
import { loadUserRules } from '@/storage/repositories/defaults';
import { useSettings } from '@/app/store';
import { toast } from '@/ui';
import type { Book } from '@/types/models';

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

export const useImportQueue = create<ImportStore>((set) => ({
  tasks: [],
  dragging: false,

  add: (files) => {
    const valid = files.filter((f) => TXT_RE.test(f.name) || f.type.startsWith('text/'));
    if (valid.length === 0) {
      // 无反馈的静默失败最容易被当成「拖进来没反应」
      toast(
        files.length ? `不支持的文件类型：${files[0].name || '未知文件'}（只收 txt / md / log）` : '没有读到文件',
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
