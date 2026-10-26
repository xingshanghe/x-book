import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoiceRecord } from '@/features/settings/VoiceRecord';
import { RECORD_SCRIPT } from '@/tts/micCapture';

describe('录音入口', () => {
  it('先给出要读的话，并说明软件会写成 16-bit', () => {
    const html = renderToStaticMarkup(<VoiceRecord onImport={async () => undefined} />);
    expect(html).toContain(RECORD_SCRIPT);
    expect(html).toContain('开始录音');
    expect(html).toContain('16-bit');
    expect(html).toContain('引擎示例（雷军）');
    expect(html).not.toContain('已有 wav 文件');
  });
});
