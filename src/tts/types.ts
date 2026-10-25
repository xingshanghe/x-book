/** 朗读相关的数据类型。本文件不发网络请求。 */

export type EnginePhase = 'absent' | 'downloading' | 'verifying' | 'installed' | 'failed';

export type VoiceOrigin = 'builtin' | 'import' | 'enrolled';

export interface VoicePack {
  id: string;
  name: string;
  origin: VoiceOrigin;
  refText: string;
  lang: 'zh' | 'en';
  refAudio: Blob;
  consentAt?: number;
  remoteId?: string;
  createdAt: number;
}

export interface EngineFile {
  name: string;
  url: string;
  bytes: number;
  /** 64 位十六进制。空字符串表示清单还没钉住，禁止下载。 */
  sha256: string;
}

export interface EngineManifest {
  version: string;
  files: readonly EngineFile[];
}

export interface PlayerSnapshot {
  status: 'idle' | 'playing' | 'paused';
  index: number;
  sentence: string;
  gapNote: string | null;
}

export const IDLE_PLAYER: PlayerSnapshot = {
  status: 'idle',
  index: -1,
  sentence: '',
  gapNote: null,
};
