/** 用户音色包：短 wav + 对齐文本，存在 IndexedDB，不进安装包。 */

import { nanoid } from '@/lib/id';
import { BUILTIN_VOICE_SLOTS, VOICE_KEEP_LIMIT } from '@/tts/account';
import type { VoiceOrigin, VoicePack } from '@/tts/types';
import { wavBlobFromBase64 } from '@/tts/wav';
import { getDB } from './db';

const HIDE_BUILTIN_KEY = 'qingyue.tts.hideBuiltin';

type FlagStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 引擎示例从列表里拿掉之后，不再占用名额。没有其他音色时，朗读仍用它。 */
export function readBuiltinHidden(storage: FlagStore = browserFlagStore()): boolean {
  try {
    return storage.getItem(HIDE_BUILTIN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeBuiltinHidden(hidden: boolean, storage: FlagStore = browserFlagStore()): void {
  if (hidden) storage.setItem(HIDE_BUILTIN_KEY, '1');
  else storage.removeItem(HIDE_BUILTIN_KEY);
}

export function builtinSlotsInUse(hidden = readBuiltinHidden()): number {
  return hidden ? 0 : BUILTIN_VOICE_SLOTS;
}

export function voiceLimitError(
  storedCount: number,
  limit = VOICE_KEEP_LIMIT,
  builtinSlots = BUILTIN_VOICE_SLOTS,
): string | null {
  const slots = builtinSlots > 0 ? builtinSlots : 0;
  if (storedCount + slots >= limit) {
    const scope = slots > 0 ? '（含引擎示例）' : '';
    return `最多保留 ${limit} 个音色${scope}，请先删掉一个`;
  }
  return null;
}

export function voiceDraftError(name: string, refText: string): string | null {
  if (!name.trim()) return '请填写音色名称';
  if (!refText.trim()) return '对齐文本不能为空';
  return null;
}

export async function listVoices(): Promise<VoicePack[]> {
  const db = await getDB();
  const all = await db.getAll('voices');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveVoice(input: {
  name: string;
  refText: string;
  refAudio: Blob;
  origin?: VoiceOrigin;
  lang?: 'zh' | 'en';
  consentAt?: number;
  remoteId?: string;
}): Promise<VoicePack> {
  const problem = voiceDraftError(input.name, input.refText);
  if (problem) throw new Error(problem);
  const existing = await listVoices();
  const full = voiceLimitError(existing.length, VOICE_KEEP_LIMIT, builtinSlotsInUse());
  if (full) throw new Error(full);
  const pack: VoicePack = {
    id: nanoid(8),
    name: input.name.trim().slice(0, 40),
    origin: input.origin ?? 'import',
    refText: input.refText.trim(),
    lang: input.lang ?? 'zh',
    refAudio: input.refAudio,
    consentAt: input.consentAt,
    remoteId: input.remoteId,
    createdAt: Date.now(),
  };
  const db = await getDB();
  await db.put('voices', pack);
  return pack;
}

/** 换机登录后补上本机还没有的音色。已有 remoteId 的不重复写入。 */
export async function saveMissingRemoteVoices(
  items: readonly { id: string; refText: string; wavBase64: string }[],
): Promise<void> {
  const existing = await listVoices();
  const known = new Set(existing.map((voice) => voice.remoteId).filter((id) => id != null));
  if (voiceLimitError(existing.length, VOICE_KEEP_LIMIT, builtinSlotsInUse())) return;
  for (const item of items) {
    if (known.has(item.id) || !item.refText.trim() || !item.wavBase64) continue;
    if (voiceLimitError((await listVoices()).length, VOICE_KEEP_LIMIT, builtinSlotsInUse())) return;
    await saveVoice({
      name: '我的音色',
      refText: item.refText,
      refAudio: wavBlobFromBase64(item.wavBase64),
      origin: 'enrolled',
      remoteId: item.id,
    });
    known.add(item.id);
  }
}

export async function renameVoice(id: string, name: string): Promise<void> {
  const next = name.trim();
  if (!next) throw new Error('请填写音色名称');
  const db = await getDB();
  const current = await db.get('voices', id);
  if (!current) return;
  await db.put('voices', { ...current, name: next.slice(0, 40) });
}

export async function removeVoice(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('voices', id);
}

function browserFlagStore(): FlagStore {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no storage');
    return localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
}
