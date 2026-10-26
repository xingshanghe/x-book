import { describe, expect, it } from 'vitest';
import { readBuiltinHidden, voiceLimitError, writeBuiltinHidden } from '@/storage/voiceStore';

describe('音色名额', () => {
  it('引擎示例占一个名额，从列表移除后可以再留三个自己的音色', () => {
    expect(voiceLimitError(2)).toMatch(/含引擎示例/);
    expect(voiceLimitError(2, 3, 0)).toBeNull();
    expect(voiceLimitError(3, 3, 0)).toMatch(/请先删掉一个/);
    expect(voiceLimitError(3, 3, 0)).not.toMatch(/含引擎示例/);
  });

  it('是否收起引擎示例只记在传入的存储里', () => {
    const storage = memory();
    expect(readBuiltinHidden(storage)).toBe(false);
    writeBuiltinHidden(true, storage);
    expect(readBuiltinHidden(storage)).toBe(true);
    writeBuiltinHidden(false, storage);
    expect(readBuiltinHidden(storage)).toBe(false);
  });
});

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
