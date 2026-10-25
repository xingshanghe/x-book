import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_VOICE, ENGINE_MANIFEST, manifestBytes, manifestReady } from './manifest';
import { desktopReadingReady } from './support';
import type { EnginePhase, VoicePack } from './types';

const PHASE_KEY = 'qingyue.tts.engine-phase';

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
export async function downloadDesktopEngine(): Promise<string | null> {
  if (!desktopReadingReady()) return '朗读即将支持';
  if (!manifestReady()) return '引擎清单还没有校验值，暂不能下载';
  writePhase('downloading');
  try {
    await invoke('tts_download_engine', {
      version: ENGINE_MANIFEST.version,
      files: ENGINE_MANIFEST.files.map((file) => ({
        name: file.name,
        url: file.url,
        sha256: file.sha256,
      })),
    });
    writePhase('installed');
    return null;
  } catch (error) {
    writePhase('absent');
    return messageOf(error, '下载没有完成');
  }
}

export async function deleteInstalledEngine(): Promise<void> {
  writePhase('absent');
  if (!desktopReadingReady()) return;
  await invoke('tts_delete_engine', { version: ENGINE_MANIFEST.version });
}

export async function speakSentence(
  text: string,
  pack: VoicePack | 'builtin',
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
