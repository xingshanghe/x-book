import { describe, expect, it } from 'vitest';

describe('pdfEngine legacy entry', () => {
  it('resolves pdfjs legacy modules', async () => {
    // 动态 import：确认 Vite/Node 能解析 legacy 路径（与 pdfEngine 同源）
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(typeof mod.getDocument).toBe('function');
    expect(mod.GlobalWorkerOptions).toBeTruthy();
  });
});
