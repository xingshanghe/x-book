import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '@/sync/cloudBooks/nativeFetch';

describe('cloud nativeFetch base64', () => {
  it('roundtrips utf-8 text', () => {
    const raw = new TextEncoder().encode('云书架 hello');
    expect(base64ToBytes(bytesToBase64(raw))).toEqual(raw);
  });

  it('roundtrips binary with padding edge cases', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array([1])))).toEqual(new Uint8Array([1]));
    expect(base64ToBytes(bytesToBase64(new Uint8Array([1, 2])))).toEqual(new Uint8Array([1, 2]));
    expect(base64ToBytes(bytesToBase64(new Uint8Array([1, 2, 3])))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
