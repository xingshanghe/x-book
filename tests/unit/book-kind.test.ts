import { describe, expect, it } from 'vitest';
import { bookKind, isPdfBook } from '@/lib/bookKind';

describe('bookKind', () => {
  it('defaults missing kind to txt', () => {
    expect(bookKind({})).toBe('txt');
    expect(bookKind({ kind: undefined })).toBe('txt');
    expect(isPdfBook({})).toBe(false);
  });

  it('detects pdf', () => {
    expect(bookKind({ kind: 'pdf' })).toBe('pdf');
    expect(isPdfBook({ kind: 'pdf' })).toBe(true);
  });
});
