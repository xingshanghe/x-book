import { describe, expect, it } from 'vitest';
import { splitSentences } from '@/core/text/sentences';

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
});
