import { describe, expect, it } from 'vitest';
import { ChapterDetector } from '@/core/parser/chapters';
import { indexBook } from '@/core/parser/indexer';
import { ChapterRewriter, PAGE_BREAK, splitHeadingLine } from '@/core/parser/reformat';

const detector = new ChapterDetector();

function rewrite(text: string): string {
  const rewriter = new ChapterRewriter(detector);
  const bytes = new TextEncoder().encode(text);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 5) {
    parts.push(...rewriter.push(bytes.subarray(i, i + 5)));
  }
  parts.push(...rewriter.finish());
  return new TextDecoder().decode(concat(parts));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('导入时拆章', () => {
  it('粘在正文里的第N章会被拆成独立一行', () => {
    const pieces = splitHeadingLine(
      '大家都支持他。第2章 《初露锋芒》秦末那会，天下乱得跟一锅粥',
      detector,
    );
    expect(pieces).toEqual(['大家都支持他。', '第2章 《初露锋芒》', '秦末那会，天下乱得跟一锅粥']);
  });

  it('口述里提到第几章时不拆', () => {
    const line = '他说第一章只是个开始，然后走出了门。';
    expect(splitHeadingLine(line, detector)).toEqual([line]);
  });

  it('新章之前写入分页符，再跑一次不会重复插入', () => {
    const once = rewrite(
      '刘邦听了。\n第2章 《初露锋芒》\n秦末那会，天下乱得跟一锅粥。\n第3章 再起\n又一段。',
    );
    expect(once).toBe(
      [
        '刘邦听了。',
        PAGE_BREAK,
        '第2章 《初露锋芒》',
        '秦末那会，天下乱得跟一锅粥。',
        PAGE_BREAK,
        '第3章 再起',
        '又一段。',
        '',
      ].join('\n'),
    );
    expect(rewrite(once)).toBe(once);
  });
});

describe('格式化结果写入缓存', () => {
  it('缓存正文和章节偏移指向同一行标题', async () => {
    const raw =
      '大家都支持他。第2章 《初露锋芒》秦末那会，天下乱得跟一锅粥。\n刘邦听了。\n第3章 再起\n又一段。';
    const out = await indexBook(new Blob([raw]), { fileName: '刘邦.txt' });
    const cached = await out.normalized.text();

    expect(cached).toContain(`${PAGE_BREAK}\n第2章 《初露锋芒》\n`);
    expect(out.scan.chapters.map((chapter) => chapter.title)).toEqual([
      '第2章 《初露锋芒》',
      '第3章 再起',
    ]);

    const lines = cached.split('\n');
    for (const chapter of out.scan.chapters) {
      let offset = 0;
      let found = '';
      for (const line of lines) {
        if (offset === chapter.charOffset) {
          found = line;
          break;
        }
        offset += line.length + 1;
      }
      expect(found).toBe(chapter.title);
    }
  });
});
