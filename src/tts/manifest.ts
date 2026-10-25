import type { EngineManifest } from './types';

/**
 * 引擎文件清单。只放常量。
 * sha256 留空时下载器拒绝开始，避免把未校验的权重当成已安装。
 * 模型不进安装包，URL 仅在用户确认下载后才会被请求。
 *
 * 权重来自 Emilia 训练的 ZipVoice，发布方标明 CC-BY-NC，不能用于对外收费。
 */
export const ENGINE_MANIFEST: EngineManifest = {
  version: 'zipvoice-distill-int8-zh-en-emilia',
  files: [
    {
      name: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2',
      bytes: 109_162_785,
      sha256: '',
    },
    {
      name: 'vocos_24khz.onnx',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx',
      bytes: 0,
      sha256: '',
    },
  ],
};

export const BUILTIN_VOICE = {
  id: 'builtin-sample',
  name: '引擎示例',
  refText: '那还是三十六年前, 一九八七年. 我呢考上了武汉大学的计算机系.',
  file: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/test_wavs/leijun-1.wav',
} as const;

export const ENGINE_LICENSE_NOTE =
  '当前 ZipVoice 权重按发布方说明为 CC-BY-NC，不能作为收费功能对外提供。内置示例音色只供本机试听。';

export function manifestReady(manifest: EngineManifest = ENGINE_MANIFEST): boolean {
  return (
    manifest.files.length > 0 && manifest.files.every((file) => /^[a-f0-9]{64}$/i.test(file.sha256))
  );
}

export function manifestBytes(manifest: EngineManifest = ENGINE_MANIFEST): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}
