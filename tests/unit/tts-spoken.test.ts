import { describe, expect, it } from 'vitest';
import {
  joinUtterance,
  partIndexAtRatio,
  prepareSpokenText,
  type UtteranceSentence,
  utteranceCount,
} from '@/tts/spoken';

describe('朗读稿', () => {
  it('把章节、年份、日期和百分数读成中文，原文里的汉字不动', () => {
    expect(prepareSpokenText('第12章写于1987年12月5日，增长30%。')).toBe(
      '第十二章写于一九八七年十二月五日，增长百分之三十。',
    );
    expect(prepareSpokenText('第100章')).toBe('第一百章');
    expect(prepareSpokenText('第101回')).toBe('第一百零一回');
    expect(prepareSpokenText('第１０章')).toBe('第十章');
    expect(prepareSpokenText('第十二章')).toBe('第十二章');
    expect(prepareSpokenText('过了5年。')).toBe('过了五年。');
    expect(prepareSpokenText('大约12.5%。')).toBe('大约百分之十二点五。');
  });

  it('不改小数、英文和过长的数字串', () => {
    expect(prepareSpokenText('留着 3.14 和 Chapter 12。')).toBe('留着 3.14 和 Chapter 12。');
    expect(prepareSpokenText('编号12345年')).toBe('编号12345年');
  });
});

describe('分段合成', () => {
  it('按下后的第一段只含一句', () => {
    const lines = paragraph('甲。', '乙。', '丙。');
    expect(utteranceCount(lines, 0, true)).toBe(1);
  });

  it('同一段里后面的短句合成一段，段末切断', () => {
    expect(utteranceCount(paragraph('甲。', '乙。', '丙。'), 1, false)).toBe(2);
    expect(utteranceCount([sentence('甲。', true), sentence('乙。', true)], 0, false)).toBe(1);
  });

  it('加上会超过一段的长度时不再并进去，超长句单独读', () => {
    const long = `${'长'.repeat(80)}。`;
    const lines = [sentence('甲。', false), sentence('乙。', false), sentence(long, true)];
    expect(utteranceCount(lines, 0, false)).toBe(2);
    expect(utteranceCount(lines, 2, false)).toBe(1);
  });

  it('拼句时中文直接相连，英文句号后留空格', () => {
    expect(joinUtterance(['甲。', '乙。'])).toBe('甲。乙。');
    expect(joinUtterance(['Hello.', 'World.'])).toBe('Hello. World.');
  });

  it('按字数把一段音频里的位置对回其中一句', () => {
    expect(partIndexAtRatio([2, 2], 0)).toBe(0);
    expect(partIndexAtRatio([2, 2], 0.2)).toBe(0);
    expect(partIndexAtRatio([2, 2], 0.6)).toBe(1);
    expect(partIndexAtRatio([2, 2], 1)).toBe(1);
  });
});

function paragraph(...texts: string[]): UtteranceSentence[] {
  return texts.map((text, index) => sentence(text, index === texts.length - 1));
}

function sentence(text: string, paragraphEnd: boolean): UtteranceSentence {
  return { text, paragraphEnd };
}
