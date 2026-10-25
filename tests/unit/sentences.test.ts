import { describe, expect, it } from 'vitest';
import { sentenceSpans, splitSentences } from '@/core/text/sentences';

describe('分句', () => {
  it('按中英文句末切分，并保留引号、省略号和破折号', () => {
    const text = '他说：“慢着……你听。”门外——什么声音？Mr. Smith paid 3.14 dollars. "Really?"';
    expect(splitSentences(text)).toEqual([
      '他说：“慢着……你听。”',
      '门外——什么声音？',
      'Mr. Smith paid 3.14 dollars.',
      '"Really?"',
    ]);
  });

  it('不把英文缩写和小数点当成句号', () => {
    expect(splitSentences('See e.g. Dr. Wu at 3.14, i.e. noon.')).toEqual([
      'See e.g. Dr. Wu at 3.14, i.e. noon.',
    ]);
  });

  it('空文本得到空数组', () => {
    expect(splitSentences('  \n  ')).toEqual([]);
  });

  it('记下每句起点，句与句之间的换行不记进句子', () => {
    const text = '甲。\n乙。';
    expect(sentenceSpans(text)).toEqual([
      { text: '甲。', start: 0 },
      { text: '乙。', start: 3 },
    ]);
    expect(sentenceSpans(text).map((span) => span.text)).toEqual(splitSentences(text));
  });
});
