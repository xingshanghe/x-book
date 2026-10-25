/** 建档提交前的纯判断。未勾选授权、未登录、时长不够时都不能上传。 */

export const GUIDE_TEXT =
  '今晚的风从江面过来，灯火沿着长街一盏盏亮起。我把今天读过的句子又念了一遍，声音落在纸上，像雨点敲过屋檐。';

const MIN_MS = 5_000;
const MAX_MS = 15_000;

export function enrollBlockReason(input: {
  loggedIn: boolean;
  consent: boolean;
  durationMs: number;
}): string | null {
  if (!input.loggedIn) return '请先登录';
  if (!input.consent) return '请先确认已获授权';
  if (input.durationMs < MIN_MS) return '录音不足 5 秒';
  if (input.durationMs > MAX_MS) return '录音超过 15 秒';
  return null;
}

export function canSubmitEnroll(input: {
  loggedIn: boolean;
  consent: boolean;
  durationMs: number;
}): boolean {
  return enrollBlockReason(input) == null;
}
