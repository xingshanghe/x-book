import type { EngineFile, EngineManifest } from './types';

/** 引擎文件放在建档同一台机器上，避免阅读端直连 GitHub。 */
export const ENGINE_DOWNLOAD_ORIGIN = 'http://118.25.79.136/tts';

const RUNTIME_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.0';

/**
 * 引擎文件清单。只放常量。
 * sha256 来自官方发布包。缺校验值时下载器拒绝开始。
 * 模型不进安装包，URL 仅在用户确认下载后才会被请求。
 *
 * 权重来自 Emilia 训练的 ZipVoice，发布方标明 CC-BY-NC，不能用于对外收费。
 * 模型与声码器各系统共用。推理程序按桌面系统和处理器分开下载。
 */
export const ENGINE_VERSION = 'zipvoice-distill-int8-zh-en-emilia';

const MODEL_FILES: readonly EngineFile[] = [
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
];

export const BUILTIN_VOICE = {
  id: 'builtin-sample',
  name: '引擎示例',
  refText: '那还是三十六年前, 一九八七年. 我呢考上了武汉大学的计算机系.',
  file: 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/test_wavs/leijun-1.wav',
} as const;

type DesktopOs = 'macos' | 'windows' | 'linux';
type CpuArch = 'aarch64' | 'x86_64';

function runtime(name: string, bytes: number, sha256: string): EngineFile {
  return {
    name,
    url: `${ENGINE_DOWNLOAD_ORIGIN}/${name}`,
    fallbackUrl: `${RUNTIME_RELEASE}/${name}`,
    bytes,
    sha256,
  };
}

const RUNTIMES: Record<DesktopOs, Record<CpuArch, EngineFile>> = {
  macos: {
    aarch64: runtime(
      'sherpa-onnx-v2.0.0-osx-arm64-shared.tar.bz2',
      20_225_744,
      'ca352a87d313fb1cce311c7b5ddc2e48df3ff899fb2c43ce8076071f029d1d3f',
    ),
    x86_64: runtime(
      'sherpa-onnx-v2.0.0-osx-x64-shared.tar.bz2',
      22_786_593,
      '6d67041ee4e8a683dd8f0789ba83d1bbb4ba6ab64c129f483fb77ff8b4a74e28',
    ),
  },
  windows: {
    aarch64: runtime(
      'sherpa-onnx-v2.0.0-win-arm64-shared-MT-Release.tar.bz2',
      25_570_325,
      'd2fc12f76d601e34b70ea9c79cb46bddb17b843bf0bda858421bf56704523382',
    ),
    x86_64: runtime(
      'sherpa-onnx-v2.0.0-win-x64-shared-MT-Release.tar.bz2',
      26_570_586,
      'a66a89c6f3401f3f26a6f53d39ea632900884cbd6a116155e2a85f434b6a7bda',
    ),
  },
  linux: {
    aarch64: runtime(
      'sherpa-onnx-v2.0.0-linux-aarch64-shared-cpu.tar.bz2',
      27_802_045,
      '0ee6e6a6de388f9db6f24c241ee6631c7509d47f3c8e5cd7b05259ff92f722b6',
    ),
    x86_64: runtime(
      'sherpa-onnx-v2.0.0-linux-x64-shared.tar.bz2',
      27_896_866,
      'ee729caa387ede28fb62dd0c111e267da5ed436c9438ee502da9ee0a2e03ab7c',
    ),
  },
};

/** 按本机系统和处理器选择引擎包。手机和浏览器没有可执行的桌面程序，返回空。 */
export function manifestForHost(os: string, arch: string): EngineManifest | null {
  const desktop = desktopOs(os);
  const cpu = cpuArch(arch);
  if (!desktop || !cpu) return null;
  return {
    version: ENGINE_VERSION,
    files: [...MODEL_FILES, RUNTIMES[desktop][cpu]],
  };
}

/** macOS Apple 芯片清单。已安装的引擎仍用这份版本号。 */
export const ENGINE_MANIFEST: EngineManifest = manifestForHost('macos', 'aarch64') as EngineManifest;

export function manifestReady(manifest: EngineManifest = ENGINE_MANIFEST): boolean {
  return (
    manifest.files.length > 0 && manifest.files.every((file) => /^[a-f0-9]{64}$/i.test(file.sha256))
  );
}

export function manifestBytes(manifest: EngineManifest = ENGINE_MANIFEST): number {
  return manifest.files.reduce((sum, file) => sum + file.bytes, 0);
}

/** 各桌面包里最大的一份，用来提示下载大小。 */
export function manifestBytesUpperBound(): number {
  let max = 0;
  for (const os of ['macos', 'windows', 'linux'] as const) {
    for (const arch of ['aarch64', 'x86_64'] as const) {
      max = Math.max(max, manifestBytes(manifestForHost(os, arch) as EngineManifest));
    }
  }
  return max;
}

function desktopOs(os: string): DesktopOs | null {
  if (os === 'macos' || os === 'windows' || os === 'linux') return os;
  return null;
}

function cpuArch(arch: string): CpuArch | null {
  if (arch === 'aarch64' || arch === 'arm64') return 'aarch64';
  if (arch === 'x86_64' || arch === 'amd64') return 'x86_64';
  return null;
}
