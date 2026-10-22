/** 默认设置与取值范围 —— 与 brand-vi.html 的规范一致 */

import type { AppSettings, CleanRule } from '@/types/models';
import { nanoid } from '@/lib/id';

export const FONT_SIZE_RANGE = { min: 13, max: 32, step: 1 };
export const LINE_HEIGHT_RANGE = { min: 1.3, max: 2.4, step: 0.05 };
export const SPACING_RANGE = { min: 0, max: 1.2, step: 0.05 };
export const INDENT_RANGE = { min: 0, max: 4, step: 0.5 };
export const WIDTH_RANGE = { min: 22, max: 60, step: 1 };

export const BODY_FONT_OPTIONS: { id: AppSettings['bodyFont']; label: string; sample: string }[] = [
  { id: 'kai', label: '楷体', sample: '轻阅' },
  { id: 'serif', label: '宋体', sample: '轻阅' },
  { id: 'sans', label: '黑体', sample: '轻阅' },
];

export function defaultSettings(): AppSettings {
  return {
    key: 'default',
    schemaVersion: 2,

    themeMode: 'system',
    bodyFont: 'kai',
    headingFont: 'auto',
    typography: {
      fontSize: 19,
      lineHeight: 1.9,
      paragraphSpacing: 0.6,
      letterSpacing: 0,
      textIndent: 2,
      maxWidth: 38,
      textAlign: 'start',
    },

    pageMode: 'page',
    tocDocked: true,
    flipAnimation: true,
    showTitlePage: true,
    showProgressHints: true,
    keepScreenAwake: false,

    detectChapters: true,
    cleanAds: true,
    cleanRules: [],
    detectFootnotes: true,

    sortMode: 'recent',
    shelfDensity: 'comfortable',

    enableShortcuts: true,
    tapToTurn: true,
    volumeToTurn: false,

    storagePersisted: false,
    deviceId: nanoid(8),
  };
}

export const USER_RULES_KEY = 'qingyue.cleanRules.v1';

export function loadUserRules(): CleanRule[] {
  try {
    const raw = localStorage.getItem(USER_RULES_KEY);
    return raw ? (JSON.parse(raw) as CleanRule[]) : [];
  } catch {
    return [];
  }
}

export function saveUserRules(rules: CleanRule[]): void {
  localStorage.setItem(USER_RULES_KEY, JSON.stringify(rules.filter((r) => !r.builtin)));
}
