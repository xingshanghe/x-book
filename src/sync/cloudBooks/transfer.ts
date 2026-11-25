/** 手动上传 / 下载书籍文件（走账号鉴权的云书架 API） */

import { useImportQueue } from '@/features/import/importQueue';
import { getBookBlob } from '@/storage/blobStore';
import { getBook } from '@/storage/repositories/bookRepo';
import type { Book } from '@/types/models';
import { apiDeleteBook, apiGetFile, apiGetMeta, apiPutFile, apiPutMeta, CloudApiError } from './api';
import { type CloudBookMeta, listRemoteBooks } from './catalog';
import { cloudConfigReady, readCloudConfig } from './config';

function requireReady(): void {
  if (!cloudConfigReady(readCloudConfig())) {
    throw new Error('请先在「同步」里启用云书架');
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

/** 上传本地书到云端（覆盖同 fingerprint） */
export async function uploadBook(bookId: string): Promise<CloudBookMeta> {
  requireReady();
  const book = await getBook(bookId);
  if (!book) throw new Error('本地没有这本书');
  const blob = await getBookBlob(bookId);
  if (!blob || blob.size === 0) throw new Error('书籍文件缺失，无法上传');

  const fileName = suggestFileName(metaFromBook(book));
  const meta = metaFromBook(book, fileName);

  // 先文件后 meta
  await apiPutFile(
    book.fingerprint,
    blob,
    book.kind === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8',
  );
  return apiPutMeta(book.fingerprint, meta);
}

/** 从云端下载并丢进导入队列（复用现有索引 / 去重） */
export async function downloadByFingerprint(fingerprint: string): Promise<void> {
  requireReady();
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

  const fileBlob = await apiGetFile(fingerprint);
  if (!fileBlob.size) throw new Error('云端文件为空');

  const name = suggestFileName(meta);
  const type = meta.kind === 'pdf' ? 'application/pdf' : 'text/plain';
  const file = new File([fileBlob], name, { type });
  useImportQueue.getState().add([file]);
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
  requireReady();
  try {
    await apiDeleteBook(fingerprint);
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return;
    throw err;
  }
}
