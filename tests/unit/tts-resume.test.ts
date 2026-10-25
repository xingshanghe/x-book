import { describe, expect, it } from 'vitest';
import { clearReadMark, recallReadMark, rememberReadMark } from '@/tts/resume';

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
});
