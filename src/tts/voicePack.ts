/** 从整理好的音色包文件夹读出名称、对齐文本和 wav。不发网络请求。 */

export const VOICE_PACK_MAX_BYTES = 3 * 1024 * 1024;

export interface VoicePackSource {
  name: string;
  /** 相对所选文件夹的路径，用 / 分隔。 */
  path: string;
  size: number;
  readText: () => Promise<string>;
  readBytes: () => Promise<Uint8Array>;
}

export interface ParsedVoicePack {
  name: string;
  refText: string;
  lang: 'zh' | 'en';
  wav: Blob;
}

export function voicePackSource(file: File): VoicePackSource {
  const relative = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
  const parts = relative.split('/').filter((part) => part && part !== '.');
  const name = parts[parts.length - 1] || file.name;
  return {
    name,
    path: parts.join('/'),
    size: file.size,
    readText: () => file.text(),
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

/** 文件夹里只认一份 wav、一份 txt，或用 voice.json 写 name / refText。 */
export async function readVoicePack(files: readonly VoicePackSource[]): Promise<ParsedVoicePack> {
  const kept = files.filter((file) => keepPackFile(file));
  const wavs = kept.filter((file) => extOf(file.name) === 'wav');
  if (wavs.length === 0) throw new Error('音色包里需要一份 wav');
  if (wavs.length > 1) throw new Error('音色包里只能有一份 wav');
  const wavFile = wavs[0];
  if (!wavFile) throw new Error('音色包里需要一份 wav');
  if (wavFile.size > VOICE_PACK_MAX_BYTES) throw new Error('wav 不超过 3 MB');

  const jsonFiles = kept.filter((file) => file.name.toLowerCase() === 'voice.json');
  if (jsonFiles.length > 1) throw new Error('voice.json 只能有一份');
  const meta = jsonFiles[0] ? parseVoiceJson(await jsonFiles[0].readText()) : emptyMeta();

  const texts = kept.filter((file) => extOf(file.name) === 'txt');
  let refText = meta.refText;
  if (!refText) {
    if (texts.length === 0) throw new Error('音色包里需要一份对齐文本（.txt）');
    if (texts.length > 1) throw new Error('对齐文本只能有一份 .txt');
    const textFile = texts[0];
    if (!textFile) throw new Error('音色包里需要一份对齐文本（.txt）');
    refText = stripBom(await textFile.readText()).trim();
  }
  if (!refText) throw new Error('对齐文本不能为空');
  if (refText.length > 2000) throw new Error('对齐文本太长');

  const bytes = await wavFile.readBytes();
  const problem = wavProblem(bytes);
  if (problem) throw new Error(problem);

  const name = (meta.name || folderName(wavFile.path) || stemOf(wavFile.name)).trim().slice(0, 40);
  if (!name) throw new Error('音色包缺少名称');

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    name,
    refText,
    lang: meta.lang,
    wav: new Blob([copy.buffer], { type: 'audio/wav' }),
  };
}

function keepPackFile(file: VoicePackSource): boolean {
  const parts = file.path.split('/');
  if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) return false;
  if (parts.length > 2) return false;
  const ext = extOf(file.name);
  return ext === 'wav' || ext === 'txt' || file.name.toLowerCase() === 'voice.json';
}

function folderName(path: string): string {
  const parts = path.split('/');
  return parts.length >= 2 ? (parts[0] ?? '') : '';
}

function stemOf(name: string): string {
  return name.replace(/\.wav$/i, '');
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

interface VoiceMeta {
  name: string;
  refText: string;
  lang: 'zh' | 'en';
}

function emptyMeta(): VoiceMeta {
  return { name: '', refText: '', lang: 'zh' };
}

function parseVoiceJson(raw: string): VoiceMeta {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(raw));
  } catch {
    throw new Error('voice.json 读不出来');
  }
  if (!data || typeof data !== 'object') throw new Error('voice.json 读不出来');
  const record = data as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const refText = typeof record.refText === 'string' ? record.refText.trim() : '';
  if (record.refText != null && typeof record.refText !== 'string') {
    throw new Error('voice.json 读不出来');
  }
  if (typeof record.refText === 'string' && !refText) throw new Error('对齐文本不能为空');
  const lang = record.lang === 'en' ? 'en' : 'zh';
  return { name, refText, lang };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function wavProblem(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    return '请选择 wav';
  }
  let offset = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = u32(bytes, offset + 4);
    const body = offset + 8;
    if (body > bytes.byteLength) return '请选择 wav';
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.byteLength) return '请选择 wav';
      if (u16(bytes, body) !== 1) return '请选择 16-bit wav';
      channels = u16(bytes, body + 2);
      rate = u32(bytes, body + 4);
      bits = u16(bytes, body + 14);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    const next = body + size + (size % 2);
    if (next <= offset) return '请选择 wav';
    offset = next;
  }
  if (bits !== 16 || (channels !== 1 && channels !== 2) || rate <= 0 || dataSize <= 0) {
    return '请选择 16-bit wav';
  }
  const duration = dataSize / (rate * channels * 2);
  if (duration < 5 || duration > 15) return '声音需要在 5 到 15 秒';
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1)
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}
