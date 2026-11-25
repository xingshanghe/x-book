/** 云书架配置：只保留开关与 API 地址；鉴权用账号 Bearer，不再存 MinIO 密钥 */

export interface CloudBooksConfig {
  /** 是否在书架显示上传/下载；需同时已登录 */
  enabled: boolean;
  /** 云书架 API 根地址，如 http://47.108.79.158 */
  apiBase: string;
}

const STORAGE_KEY = 'qingyue.cloud.v1';

export const DEFAULT_CLOUD_API_BASE = 'http://47.108.79.158';

export function defaultCloudConfig(): CloudBooksConfig {
  return {
    enabled: true,
    apiBase: DEFAULT_CLOUD_API_BASE,
  };
}

export function readCloudConfig(storage: Pick<Storage, 'getItem'> = localStorage): CloudBooksConfig {
  const base = defaultCloudConfig();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CloudBooksConfig> & {
      /** 旧版字段，迁移时忽略 */
      endpoint?: string;
      accessKey?: string;
      secretKey?: string;
    };
    const apiBase = (parsed.apiBase ?? parsed.endpoint ?? base.apiBase)
      .trim()
      .replace(/\/+$/, '')
      // 旧版 endpoint 可能是 …/s3，迁到 API 根
      .replace(/\/s3$/i, '');
    return {
      enabled: parsed.enabled !== false,
      apiBase: apiBase || base.apiBase,
    };
  } catch {
    return base;
  }
}

export function writeCloudConfig(
  patch: Partial<CloudBooksConfig>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): CloudBooksConfig {
  const next: CloudBooksConfig = {
    ...readCloudConfig(storage),
    ...patch,
  };
  next.apiBase = next.apiBase.trim().replace(/\/+$/, '').replace(/\/s3$/i, '') || DEFAULT_CLOUD_API_BASE;
  storage.setItem(STORAGE_KEY, JSON.stringify({ enabled: next.enabled, apiBase: next.apiBase }));
  return next;
}

/** 开关打开即可尝试（真正请求还要登录） */
export function cloudConfigReady(cfg: CloudBooksConfig = readCloudConfig()): boolean {
  return Boolean(cfg.enabled && cfg.apiBase);
}
