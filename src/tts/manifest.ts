import type { EngineManifest } from './types';

/** 引擎文件放在建档同一台机器上，避免阅读端直连 GitHub。 */
export const ENGINE_DOWNLOAD_ORIGIN = 'http://118.25.79.136/tts';

/**
 * 引擎文件清单。只放常量。
 * sha256 来自官方发布包。缺校验值时下载器拒绝开始。
 * 模型不进安装包，URL 仅在用户确认下载后才会被请求。
 *
 * 权重来自 Emilia 训练的 ZipVoice，发布方标明 CC-BY-NC，不能用于对外收费。
 */
export const ENGINE_MANIFEST: EngineManifest = {
  version: 'zipvoice-distill-int8-zh-en-emilia',
  files: [
    {
      name: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2',
      url: `${ENGINE_DOWNLOAD_ORIGIN}/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2`,
      bytes: 109_162_785,
      sha256: '77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803',
    },
    {
      name: 'vocos_24khz.onnx',
      url: `${ENGINE_DOWNLOAD_ORIGIN}/vocos_24khz.onnx`,
      bytes: 54_157_409,
      sha256: 'bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0',
    },
  ],
};

export const BUILTIN_VOICE = {
  id: 'builtin-sample',
  name: '引擎示例',
  refText: '那还是三十六年前, 一九八七年. 我呢考上了武汉大学的计算机系.',
  file: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/test_wavs/leijun-1.wav',
} as const;

export function manifestReady(manifest: EngineManifest = ENGINE_MANIFEST): boolean {
  return (
    manifest.files.length > 0 && manifest.files.every((file) => /^[a-f0-9]{64}$/i.test(file.sha256))
  );
}

export function manifestBytes(manifest: EngineManifest = ENGINE_MANIFEST): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}
