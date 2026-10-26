import { describe, expect, it } from 'vitest';
import { clearReadMark, readingOrigin, recallReadMark, rememberReadMark } from '@/tts/resume';

const CHAPTERS = [0, 1000, 5000];

describe('朗读停止点', () => {
  it('记住停止的句子，清除之后不再续上', () => {
    const bookId = 'book-resume-test';
    clearReadMark(bookId);
    expect(recallReadMark(bookId)).toBeNull();
    rememberReadMark(bookId, { charOffset: 42, sentence: '乙。' });
    expect(recallReadMark(bookId)).toEqual({ charOffset: 42, sentence: '乙。' });
    clearReadMark(bookId);
    expect(recallReadMark(bookId)).toBeNull();
  });

  it('还停在同一章时从停止的那句接着读', () => {
    const mark = { charOffset: 1200, sentence: '乙。' };
    expect(readingOrigin(mark, 1800, CHAPTERS)).toBe(1200);
    expect(readingOrigin(null, 1800, CHAPTERS)).toBe(1800);
  });

  it('换了章节就从新位置开始，不再续上原来的句子', () => {
    const mark = { charOffset: 1200, sentence: '乙。' };
    expect(readingOrigin(mark, 5000, CHAPTERS)).toBe(5000);
    expect(readingOrigin(mark, 200, CHAPTERS)).toBe(200);
  });

  it('没有章节时，只挪了一点仍接着读，挪远了就从新位置开始', () => {
    const mark = { charOffset: 42, sentence: '乙。' };
    expect(readingOrigin(mark, 100, [])).toBe(42);
    expect(readingOrigin(mark, 9000, [])).toBe(9000);
  });

  it('停住时页首落在上一章，人没换章就仍从那句接着读', () => {
    const mark = { charOffset: 5200, sentence: '丙。' };
    const chapters = [0, 5000, 9000];
    expect(readingOrigin(mark, 4900, chapters, 4900)).toBe(5200);
    expect(readingOrigin(mark, 9000, chapters, 4900)).toBe(9000);
  });
});
