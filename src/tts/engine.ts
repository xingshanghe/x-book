import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_VOICE, ENGINE_MANIFEST, manifestBytes, manifestReady } from './manifest';
import { desktopReadingReady } from './support';
import type { EnginePhase, VoicePack } from './types';

const PHASE_KEY = 'qingyue.tts.engine-phase';

export interface EngineProgress {
  name: string;
  received: number;
  total: number;
  index: number;
  count: number;
  stage: 'downloading' | 'verifying';
}

export function readEnginePhase(): EnginePhase {
  if (typeof localStorage === 'undefined') return 'absent';
  const raw = localStorage.getItem(PHASE_KEY);
  if (raw === 'installed' || raw === 'failed' || raw === 'downloading' || raw === 'verifying')
    return raw;
  return 'absent';
}

function writePhase(phase: EnginePhase): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PHASE_KEY, phase);
}

/** 只有 macOS 桌面壳、且用户已经确认时才调用。其他端直接返回说明，不发下载。 */
export async function downloadDesktopEngine(
  onProgress?: (progress: EngineProgress) => void,
): Promise<string | null> {
  if (!desktopReadingReady()) return '朗读即将支持';
  if (!manifestReady()) return '引擎清单还没有校验值，暂不能下载';
  writePhase('downloading');
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<EngineProgress>('tts-download-progress', (event) => {
    onProgress?.(event.payload);
  });
  try {
    await invoke('tts_download_engine', {
      version: ENGINE_MANIFEST.version,
      files: ENGINE_MANIFEST.files.map((file) => ({
        name: file.name,
        url: file.url,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
    });
    writePhase('installed');
    return null;
  } catch (error) {
    writePhase('absent');
    return messageOf(error, '下载没有完成');
  } finally {
    unlisten();
  }
}

export async function cancelEngineDownload(): Promise<void> {
  if (!desktopReadingReady()) return;
  await invoke('tts_cancel_download');
}

export function engineProgressLabel(progress: EngineProgress): string {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const got = (progress.received / (1024 * 1024)).toFixed(1);
  const all = (progress.total / (1024 * 1024)).toFixed(0);
  if (progress.stage === 'verifying') return `正在校验 ${pct}%`;
  return `正在下载 ${progress.index + 1}/${progress.count} · ${pct}% · ${got}/${all} MB`;
}

export async function deleteInstalledEngine(): Promise<void> {
  writePhase('absent');
  if (!desktopReadingReady()) return;
  await invoke('tts_delete_engine', { version: ENGINE_MANIFEST.version });
}

export async function speakSentence(
  text: string,
  pack: VoicePack | 'builtin',
  options?: { silenceScale?: number },
): Promise<Uint8Array> {
  if (!desktopReadingReady()) throw new Error('朗读即将支持');
  if (readEnginePhase() !== 'installed') throw new Error('请先下载朗读引擎');
  const builtin = pack === 'builtin';
  const wav = await invoke<number[]>('tts_speak', {
    request: {
      version: ENGINE_MANIFEST.version,
      text,
      refText: builtin ? BUILTIN_VOICE.refText : pack.refText,
      builtinFile: builtin ? BUILTIN_VOICE.file : null,
      refWav: builtin ? null : Array.from(new Uint8Array(await pack.refAudio.arrayBuffer())),
      silenceScale: options?.silenceScale ?? 1,
    },
  });
  return Uint8Array.from(wav);
}

function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function engineDownloadLabel(): string {
  const mb = Math.max(1, Math.round(manifestBytes() / (1024 * 1024)));
  return `朗读引擎大约 ${mb} MB，只需下载一次。下载完成后可离线朗读。`;
}
