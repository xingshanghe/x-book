import { describe, expect, it } from 'vitest';
import { StreamIndexer } from '@/core/parser/scanner';
import { ChapterDetector } from '@/core/parser/chapters';
import { Cleaner } from '@/core/parser/cleaner';
import { detectEncoding } from '@/core/encoding/detect';

const enc = new TextEncoder();

function scan(text: string, opts?: ConstructorParameters<typeof StreamIndexer>[0]) {
  const indexer = new StreamIndexer(opts);
  const bytes = enc.encode(text);
  // 按 7 字节不规则分块，验证跨块扫描正确性
  for (let i = 0; i < bytes.length; i += 7) indexer.push(bytes.subarray(i, i + 7));
  return indexer.finish();
}

describe('scanner', () => {
  it('块边界永不落在行中间', () => {
    const text = Array.from({ length: 300 }, (_, i) => `第${i}行内容abc`).join('\n');
    const r = scan(text, { blockSize: 512 });
    // 每块末尾必然是换行后的新行起点
    for (let i = 1; i < r.blockCount; i++) {
      const prevEnd = r.starts[i];
      // 重新扫描验证 prevEnd 处是行首（前一字节是 \n）
      const bytes = enc.encode(text);
      expect(bytes[prevEnd - 1]).toBe(0x0a);
    }
  });

  it('字符计数与解码后的码点数一致（不含被清洗行）', () => {
    const text = '轻阅是本地优先的阅读器。\n第二行有汉字与English混排。\n'.repeat(50);
    const r = scan(text, { blockSize: 256 });
    expect(r.charCount).toBe([...text].length);
    expect(r.byteCount).toBe(enc.encode(text).length);
  });

  it('CRLF 与 CR 归一为行终止符', () => {
    const r1 = scan('a\r\nb\rc\nd');
    expect(r1.lineCount).toBe(4);
    // 与归一化文本 'a\nb\nc\nd' 的码点数一致（CRLF 只计 1 个终止符）
    expect(r1.charCount).toBe(7);
  });

  it('识别章节并记录块内行号', () => {
    const text = ['第一章 起点', '正文一', '正文二', '第二章 转折', '正文三'].join('\n');
    const r = scan(text, { detector: new ChapterDetector() });
    expect(r.chapters.length).toBe(2);
    expect(r.chapters[0].title).toBe('第一章 起点');
    expect(r.chapters[1].blockIndex).toBeGreaterThanOrEqual(0);
  });

  it('清洗只删整行并从统计中扣除', () => {
    const cleaner = new Cleaner(
      [{ id: 't', name: 't', pattern: '^本章说.*$', enabled: true }],
      true,
    );
    const text = '正文甲\n本章说：支持正版\n正文乙\n'.repeat(10);
    const r = scan(text, { cleaner, blockSize: 128 });
    expect(r.cleanedLines).toBe(10);
    const plain = scan('正文甲\n正文乙\n'.repeat(10), { blockSize: 128 });
    expect(r.charCount).toBe(plain.charCount);
  });
});

describe('chapters', () => {
  const d = new ChapterDetector();
  it('通杀正则覆盖常见格式', () => {
    for (const t of ['第一章 开端', '第100章 大结局（下）', '卷一', 'Chapter 12: The End', '楔子', '后记']) {
      expect(d.test(t), t).not.toBeNull();
    }
  });
  it('正文不误报', () => {
    expect(d.test('他说第一章只是个开始，然后走出了门。')).toBeNull();
    expect(d.test('这是一段很长很长的正文，讲述主角在雨天里遇见了一只猫，它的毛是橘色的。')).toBeNull();
  });
  it('学习模式可覆盖非标准编号', () => {
    const learned = ['^\\s*[0-9]{1,4}[、.]\\s*\\S{1,40}$'];
    const d2 = new ChapterDetector({ learned });
    expect(d2.test('12、夜航船')).not.toBeNull();
  });
  it('[::] 手动标记最高优先级', () => {
    expect(d.test('[::]我的标记')?.title).toBe('我的标记');
  });
});

describe('detectEncoding', () => {
  it('UTF-8 中文', () => {
    const r = detectEncoding(enc.encode('轻阅阅读器，本地优先。'.repeat(20)));
    expect(r.encoding).toBe('utf-8');
  });
  it('GBK 中文', () => {
    const gbk = new TextEncoder(); // Node 环境无 GBK 编码器，用字节样本直接验证
    void gbk;
    const sample = new Uint8Array([
      0xce, 0xd2, 0xb0, 0xae, 0xd4, 0xc4, 0xb6, 0xc1, 0x0a, // 我爱阅读\n (GBK)
      0xd5, 0xe2, 0xca, 0xc7, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, // 这是中文\n
    ]);
    const r = detectEncoding(sample);
    expect(['gb18030', 'big5']).toContain(r.encoding);
  });
  it('UTF-16LE BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
    expect(detectEncoding(le).encoding).toBe('utf-16le');
  });
});
