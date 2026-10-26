import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READING_PREFS,
  pickReadingVoice,
  readReadingPrefs,
  writeReadingPrefs,
} from '@/tts/prefs';

describe('朗读偏好', () => {
  it('没有存过时用默认值，不把语速和停顿放到听起来发飘的范围', () => {
    const storage = memory();
    expect(readReadingPrefs(storage)).toEqual(DEFAULT_READING_PREFS);
    const saved = writeReadingPrefs(
      { speed: 4, sentencePauseMs: 5, paragraphPauseMs: 9000, silenceScale: 0, voiceId: '  ' },
      storage,
    );
    expect(saved.speed).toBe(1.15);
    expect(saved.sentencePauseMs).toBe(80);
    expect(saved.paragraphPauseMs).toBe(1200);
    expect(saved.silenceScale).toBe(0.4);
    expect(saved.voiceId).toBe('auto');
    expect(readReadingPrefs(storage)).toEqual(saved);
  });

  it('自动音色优先最近导入的一份，也可以固定用雷军示例', () => {
    expect(pickReadingVoice('auto', [])).toBe('builtin');
    expect(pickReadingVoice('auto', ['a', 'b'])).toBe('b');
    expect(pickReadingVoice('builtin', ['a'])).toBe('builtin');
    expect(pickReadingVoice('a', ['a', 'b'])).toBe('a');
    expect(pickReadingVoice('missing', ['a', 'b'])).toBe('b');
    expect(pickReadingVoice('builtin', ['a'], false)).toBe('a');
    expect(pickReadingVoice('auto', [], false)).toBe('builtin');
  });
});

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}
