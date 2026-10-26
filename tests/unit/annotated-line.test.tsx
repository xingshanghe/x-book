import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnnotatedLine } from '@/features/reader/AnnotatedLine';

describe('正文按句留下朗读位置', () => {
  it('同一段里的两句各有自己的字符位置', () => {
    const html = renderToStaticMarkup(
      <AnnotatedLine text="朱棣看着朱能。他也曾经动摇过。" char={100} onNote={() => undefined} />,
    );
    expect(html).toContain('data-char="100"');
    expect(html).toContain('data-char="107"');
    expect(html.match(/qy-sentence/g)).toHaveLength(2);
  });
});
