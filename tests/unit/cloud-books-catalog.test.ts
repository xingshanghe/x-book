import { describe, expect, it } from 'vitest';
import { cloudObjectKeys } from '@/sync/cloudBooks/catalog';

describe('cloudBooks catalog keys', () => {
  it('builds stable object keys from fingerprint', () => {
    const keys = cloudObjectKeys('abc123');
    expect(keys.meta).toBe('books/abc123/meta.json');
    expect(keys.file).toBe('books/abc123/file.bin');
  });
});
