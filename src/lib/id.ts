/** 极简 id：24 字符 base36，够用且不引入依赖 */
export function nanoid(size = 12): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(36).padStart(2, '0');
  return out.slice(0, size * 2);
}

/** 稳定的字符串哈希（FNV-1a 32bit），用于封面色相等派生值 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 由 fingerprint 派生封面色相，保证同一本书跨设备颜色一致 */
export function coverHue(fingerprint: string): number {
  return hash32(fingerprint) % 360;
}
