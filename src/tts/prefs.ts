/** 朗读偏好。只读写本地，不发请求。 */

export interface ReadingPrefs {
  /** auto：有导入音色时用最近一份，否则用引擎示例。 */
  voiceId: string;
  /** 1 为原速。范围收窄，避免拉得太快或太慢以后变调明显。 */
  speed: number;
  sentencePauseMs: number;
  paragraphPauseMs: number;
  /** 句内逗号、顿号的换气。1 接近模型自带的停顿。 */
  silenceScale: number;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  voiceId: 'auto',
  speed: 1,
  sentencePauseMs: 280,
  paragraphPauseMs: 520,
  silenceScale: 1,
};

type PrefsStore = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'qingyue.tts.reading';

export function readReadingPrefs(storage: PrefsStore = browserStore()): ReadingPrefs {
  const raw = storage.getItem(KEY);
  if (!raw) return DEFAULT_READING_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_READING_PREFS;
    return normalize(parsed as Partial<ReadingPrefs>);
  } catch {
    return DEFAULT_READING_PREFS;
  }
}

export function writeReadingPrefs(
  patch: Partial<ReadingPrefs>,
  storage: PrefsStore = browserStore(),
): ReadingPrefs {
  const next = normalize({ ...readReadingPrefs(storage), ...patch });
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** 选出真正用来合成的音色。builtin 表示引擎自带的雷军示例。 */
export function pickReadingVoice(voiceId: string, idsInOrder: readonly string[]): string {
  if (voiceId === 'builtin') return 'builtin';
  if (voiceId !== 'auto' && idsInOrder.includes(voiceId)) return voiceId;
  return idsInOrder[idsInOrder.length - 1] ?? 'builtin';
}

function normalize(input: Partial<ReadingPrefs>): ReadingPrefs {
  const voiceId = typeof input.voiceId === 'string' ? input.voiceId.trim().slice(0, 40) : '';
  return {
    voiceId: voiceId || DEFAULT_READING_PREFS.voiceId,
    speed: clamp(input.speed, 0.85, 1.15, DEFAULT_READING_PREFS.speed),
    sentencePauseMs: Math.round(
      clamp(input.sentencePauseMs, 80, 800, DEFAULT_READING_PREFS.sentencePauseMs),
    ),
    paragraphPauseMs: Math.round(
      clamp(input.paragraphPauseMs, 160, 1200, DEFAULT_READING_PREFS.paragraphPauseMs),
    ),
    silenceScale: round1(clamp(input.silenceScale, 0.4, 1.6, DEFAULT_READING_PREFS.silenceScale)),
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function browserStore(): PrefsStore {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no storage');
    return localStorage;
  } catch {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  }
}
