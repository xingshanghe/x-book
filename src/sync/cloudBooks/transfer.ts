/** 手动上传 / 下载书籍文件（走账号鉴权的云书架 API） */

import { useImportQueue } from '@/features/import/importQueue';
import { getBookBlob } from '@/storage/blobStore';
import { getBook } from '@/storage/repositories/bookRepo';
import type { Book } from '@/types/models';
import {
  apiDeleteBook,
  apiGetFile,
  apiGetMeta,
  apiPutFile,
  apiPutMeta,
  CloudApiError,
  ensureAccessToken,
} from './api';
import { type CloudBookMeta, listRemoteBooks } from './catalog';
import { cloudConfigReady, readCloudConfig } from './config';
import { useTransferQueue } from './transferQueue';

/** 启用云书架且能拿到登录态，否则抛可读错误（避免先读本地文件再 401） */
async function requireReady(): Promise<void> {
  if (!cloudConfigReady(readCloudConfig())) {
    throw new Error('请先在「同步」里启用云书架');
  }
  try {
    await ensureAccessToken();
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 401) {
      throw new Error('请先登录账号');
    }
    throw err;
  }
}

function metaFromBook(book: Book, fileName?: string): CloudBookMeta {
  return {
    fingerprint: book.fingerprint,
    title: book.title,
    author: book.author,
    kind: book.kind ?? 'txt',
    size: book.size,
    encoding: book.encoding,
    pageCount: book.pageCount,
    charCount: book.charCount,
    fileName,
    uploadedAt: Date.now(),
  };
}

function suggestFileName(meta: CloudBookMeta): string {
  if (meta.fileName) return meta.fileName;
  const safe = (meta.title || 'book').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  return meta.kind === 'pdf' ? `${safe}.pdf` : `${safe}.txt`;
}

const lastPatchAt = new Map<string, number>();

/** 节流进度写入，避免 XHR 每帧触发整页重渲染 */
function mapTransferProgress(taskId: string, ratio: number, scale = 1, offset = 0): void {
  const next = Math.min(1, Math.max(0, offset + ratio * scale));
  const now = Date.now();
  const prevAt = lastPatchAt.get(taskId) ?? 0;
  const cur = useTransferQueue.getState().tasks.find((t) => t.id === taskId)?.ratio ?? 0;
  if (next < 0.999 && now - prevAt < 80 && Math.abs(next - cur) < 0.02) return;
  lastPatchAt.set(taskId, now);
  useTransferQueue.getState().patch(taskId, { ratio: next });
}

/** 上传本地书到云端（覆盖同 fingerprint） */
export async function uploadBook(bookId: string): Promise<CloudBookMeta> {
  await requireReady();
  const book = await getBook(bookId);
  if (!book) throw new Error('本地没有这本书');
  const blob = await getBookBlob(bookId);
  if (!blob || blob.size === 0) throw new Error('书籍文件缺失，无法上传');

  const fileName = suggestFileName(metaFromBook(book));
  const meta = metaFromBook(book, fileName);
  const taskId = useTransferQueue.getState().begin({
    kind: 'upload',
    fingerprint: book.fingerprint,
    title: book.title || fileName,
    size: blob.size,
  });

  try {
    // 文件传输占 0–0.9，写 meta 占 0.9–1
    await apiPutFile(
      book.fingerprint,
      blob,
      book.kind === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8',
      (p) => mapTransferProgress(taskId, p.ratio, 0.9, 0),
    );
    mapTransferProgress(taskId, 0.95);
    const saved = await apiPutMeta(book.fingerprint, meta);
    useTransferQueue.getState().finish(taskId);
    lastPatchAt.delete(taskId);
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : '上传失败';
    useTransferQueue.getState().fail(taskId, message);
    lastPatchAt.delete(taskId);
    throw err;
  }
}

/** 从云端下载并丢进导入队列（复用现有索引 / 去重） */
export async function downloadByFingerprint(fingerprint: string): Promise<void> {
  await requireReady();
  let meta: CloudBookMeta;
  try {
    meta = await apiGetMeta(fingerprint);
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) {
      throw new Error('云端没有这本书');
    }
    throw err;
  }
  if (meta.fingerprint && meta.fingerprint !== fingerprint) {
    throw new Error('云端元数据与指纹不一致');
  }
  meta = { ...meta, fingerprint };

  const taskId = useTransferQueue.getState().begin({
    kind: 'download',
    fingerprint,
    title: meta.title || suggestFileName(meta),
    size: meta.size || 0,
  });

  try {
    const fileBlob = await apiGetFile(
      fingerprint,
      (p) => mapTransferProgress(taskId, p.ratio, 0.95, 0),
      meta.size || 0,
    );
    if (!fileBlob.size) throw new Error('云端文件为空');

    const name = suggestFileName(meta);
    const type = meta.kind === 'pdf' ? 'application/pdf' : 'text/plain';
    const file = new File([fileBlob], name, { type });
    // 先入导入队列，再结束下载任务，托盘可无缝衔接到「导入中」
    useImportQueue.getState().add([file]);
    useTransferQueue.getState().finish(taskId);
    lastPatchAt.delete(taskId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '下载失败';
    useTransferQueue.getState().fail(taskId, message);
    lastPatchAt.delete(taskId);
    throw err;
  }
}

/** 仅云端、本地没有的书 */
export async function listCloudOnly(localFingerprints: Set<string>): Promise<CloudBookMeta[]> {
  const remote = await listRemoteBooks();
  const out: CloudBookMeta[] = [];
  for (const [fp, meta] of remote) {
    if (!localFingerprints.has(fp)) out.push(meta);
  }
  return out.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

/** 按 fingerprint 删除云端书；需已启用云书架并登录 */
export async function deleteCloudBook(fingerprint: string): Promise<void> {
  await requireReady();
  try {
    await apiDeleteBook(fingerprint);
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return;
    throw err;
  }
}
