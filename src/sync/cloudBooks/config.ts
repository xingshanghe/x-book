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

export function readCloudConfig(
  storage: Pick<Storage, 'getItem'> = localStorage,
): CloudBooksConfig {
  const base = defaultCloudConfig();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CloudBooksConfig>;
    return {
      enabled: parsed.enabled !== false,
      // 服务地址写死，忽略本地旧值
      apiBase: DEFAULT_CLOUD_API_BASE,
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
    apiBase: DEFAULT_CLOUD_API_BASE,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify({ enabled: next.enabled, apiBase: next.apiBase }));
  return next;
}

/** 开关打开即可尝试（真正请求还要登录） */
export function cloudConfigReady(cfg: CloudBooksConfig = readCloudConfig()): boolean {
  return Boolean(cfg.enabled && cfg.apiBase);
}

/**
 * 上传 / 下载 / 删云端的完整门槛：开关打开且已登录。
 * UI 用 profile 是否存在；传输层在 ensure 登录后再调用。
 */
export function cloudOpsReady(
  cfg: CloudBooksConfig = readCloudConfig(),
  loggedIn = false,
): boolean {
  return cloudConfigReady(cfg) && loggedIn;
}
