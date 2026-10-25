import { describe, expect, it } from 'vitest';
import { createMemorySink, downloadEngine } from '@/tts/download';
import { ENGINE_MANIFEST, manifestReady } from '@/tts/manifest';
import type { EngineFile, EngineManifest } from '@/tts/types';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('引擎下载', () => {
  it('加载清单本身不发请求，未确认时也不发请求', async () => {
    expect(manifestReady(ENGINE_MANIFEST)).toBe(false);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(new Uint8Array([1]));
    };
    const result = await downloadEngine({
      confirmed: false,
      manifest: await readyManifest(new Uint8Array([1, 2, 3])),
      fetchImpl,
      openSink: () => createMemorySink(),
    });
    expect(result.phase).toBe('absent');
    expect(calls).toBe(0);
  });

  it('取消后不是已安装', async () => {
    const manifest = await readyManifest(new Uint8Array([1, 2, 3, 4]));
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async () => {
      controller.abort();
      return new Response(new Uint8Array([1, 2, 3, 4]));
    };
    const result = await downloadEngine({
      confirmed: true,
      manifest,
      fetchImpl,
      signal: controller.signal,
      openSink: () => createMemorySink(),
    });
    expect(result.phase).not.toBe('installed');
  });

  it('校验不一致时删除字节并回到未安装', async () => {
    const body = new Uint8Array([9, 8, 7]);
    const manifest = await readyManifest(body);
    const broken: EngineManifest = {
      ...manifest,
      files: [{ ...manifest.files[0], sha256: 'ab'.repeat(32) }],
    };
    const sink = createMemorySink();
    const result = await downloadEngine({
      confirmed: true,
      manifest: broken,
      fetchImpl: async () => new Response(body),
      openSink: () => sink,
    });
    expect(result.phase).toBe('absent');
    expect(sink.snapshot().byteLength).toBe(0);
  });
});

async function readyManifest(body: Uint8Array): Promise<EngineManifest> {
  const file: EngineFile = {
    name: 'model.bin',
    url: 'https://example.test/model.bin',
    bytes: body.byteLength,
    sha256: await sha256Hex(body),
  };
  return { version: 'test', files: [file] };
}
