export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatChars(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿字`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万字`;
  return `${n} 字`;
}

export function formatPercent(p: number): string {
  return `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${sameYear ? '' : `${d.getFullYear()}/`}${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  if (diff < min) return '刚刚';
  if (diff < 60 * min) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} 小时前`;
  if (diff < 7 * 24 * 60 * min) return `${Math.floor(diff / (24 * 60 * min))} 天前`;
  return formatDate(ts);
}

/** 按 250 字/分钟估算剩余阅读时长 */
export function formatRemaining(charsLeft: number): string {
  const min = Math.max(1, Math.round(charsLeft / 250));
  if (min < 60) return `约 ${min} 分钟`;
  return `约 ${(min / 60).toFixed(1)} 小时`;
}

/** 保留 n 位小数，避免浮点毛刺写进设置 */
export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
