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
import { putBookFile } from '@/storage/blobStore';
import { loadUserRules } from '@/storage/repositories/defaults';
import { useSettings } from '@/app/store';
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
  add: (files: File[]) => void;
  clearFinished: () => void;
}

const TXT_RE = /\.(txt|text|log|md)$/i;

export const useImportQueue = create<ImportStore>((set) => ({
  tasks: [],

  add: (files) => {
    const valid = files.filter((f) => TXT_RE.test(f.name) || f.type.startsWith('text/'));
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

  clearFinished: () =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'running' || t.status === 'queued') })),
}));

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
      title: outcome.title,
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

    await putBookFile(book.id, outcome.normalized);
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
