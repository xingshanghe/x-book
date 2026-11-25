/** 云端书目清单：按 fingerprint 对齐 */

import type { BookEncoding, BookKind } from '@/types/models';
import { apiListBooks, apiProbe } from './api';
import { cloudConfigReady, readCloudConfig } from './config';

export interface CloudBookMeta {
  fingerprint: string;
  title: string;
  author?: string;
  kind: BookKind;
  size: number;
  encoding: BookEncoding;
  pageCount?: number;
  charCount?: number;
  /** 原始文件名后缀提示，下载时用来构造 File */
  fileName?: string;
  uploadedAt: number;
}

export function cloudObjectKeys(fingerprint: string): { meta: string; file: string } {
  return {
    meta: `books/${fingerprint}/meta.json`,
    file: `books/${fingerprint}/file.bin`,
  };
}

/** 列出云端书籍；失败返回空 Map（静默降级） */
export async function listRemoteBooks(): Promise<Map<string, CloudBookMeta>> {
  const map = new Map<string, CloudBookMeta>();
  if (!cloudConfigReady(readCloudConfig())) return map;
  try {
    const items = await apiListBooks();
    for (const meta of items) {
      if (meta?.fingerprint) map.set(meta.fingerprint, meta);
    }
  } catch {
    /* 未登录或网络失败 → 空表 */
  }
  return map;
}

export async function probeCloud(): Promise<{ ok: boolean; reason?: string }> {
  if (!cloudConfigReady(readCloudConfig())) {
    return { ok: false, reason: '未启用云书架' };
  }
  return apiProbe();
}

export async function remoteHasFingerprint(fingerprint: string): Promise<boolean> {
  const map = await listRemoteBooks();
  return map.has(fingerprint);
}
