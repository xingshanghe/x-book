import { describe, expect, it } from 'vitest';
import {
  explainPronunciation,
  lexiconEntries,
  readPronunciations,
  writePronunciations,
} from '@/tts/pronounce';

describe('注音表', () => {
  it('把拼音和声调符号写成引擎词表的声母韵母', () => {
    expect(explainPronunciation('行长', 'hang2 zhang3')).toBeNull();
    expect(explainPronunciation('行长', 'hang2zhang3')).toBeNull();
    expect(explainPronunciation('行长', 'háng zhǎng')).toBeNull();
    expect(lexiconEntries([{ word: '行长', reading: 'hángzhǎng' }])[0]?.phones).toBe(
      'h0 ang2 zh0 ang3',
    );
    expect(lexiconEntries([{ word: '银行', reading: 'yin2hang2' }])[0]?.phones).toBe(
      'y0 in2 h0 ang2',
    );
    expect(lexiconEntries([{ word: '音乐', reading: 'yīn yuè' }])[0]?.phones).toBe('y0 in1 y0 ue4');
    expect(lexiconEntries([{ word: '女儿', reading: 'nü3 er2' }])[0]?.phones).toBe('n0 v3 er2');
    expect(lexiconEntries([{ word: '绿', reading: 'lǜ' }])[0]?.phones).toBe('l0 v4');
    expect(lexiconEntries([{ word: '居', reading: 'ju1' }])[0]?.phones).toBe('j0 u1');
    expect(lexiconEntries([{ word: '月', reading: 'yue4' }])[0]?.phones).toBe('y0 ue4');
    expect(lexiconEntries([{ word: '啊', reading: 'a5' }])[0]?.phones).toBe('a5');
    expect(lexiconEntries([{ word: '二', reading: 'er4' }])[0]?.phones).toBe('er4');
  });

  it('字数对不上、没有声调或不是汉字时不收', () => {
    expect(explainPronunciation('行长', 'hang2')).toBe('读音要和字数一样，每个字一个音节');
    expect(explainPronunciation('行', 'hang')).toBe('「hang」不是带声调的拼音');
    expect(explainPronunciation('hello', 'he1')).toBe('词语请用十个以内的汉字');
    expect(explainPronunciation('', 'hang2')).toBe('请填写词语');
    expect(explainPronunciation('行', '')).toBe('请填写读音');
    expect(explainPronunciation('啊', 'er1')).toBe('「er1」不是带声调的拼音');
  });

  it('存在本机，同一词以后写的为准', () => {
    const storage = memory();
    writePronunciations([{ word: '行长', reading: 'xing2 zhang3' }], storage);
    const saved = writePronunciations(
      [
        { word: '行长', reading: 'hang2 zhang3' },
        { word: '行长', reading: 'xing2 zhang3' },
        { word: '  ', reading: 'hang2' },
      ],
      storage,
    );
    expect(saved).toEqual([{ word: '行长', reading: 'hang2 zhang3' }]);
    expect(readPronunciations(storage)).toEqual(saved);
    expect(lexiconEntries(saved)[0]?.phones).toBe('h0 ang2 zh0 ang3');
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
