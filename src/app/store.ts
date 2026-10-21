/** 全局设置状态（Zustand）：设置即状态，状态即 localStorage */

import { create } from 'zustand';
import type { AppSettings, CleanRule, ThemeName, Typography } from '@/types/models';
import { defaultSettings, loadUserRules, saveUserRules } from '@/storage/repositories/defaults';
import { loadSettings, saveSettings } from '@/storage/repositories/settingsRepo';
import { prefersDark } from '@/lib/platform';

interface SettingsStore {
  settings: AppSettings;
  userRules: CleanRule[];
  hydrated: boolean;
  resolvedTheme: ThemeName;
  hydrate: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
  updateTypography: (patch: Partial<Typography>) => void;
  setRules: (rules: CleanRule[]) => void;
}

function resolveTheme(mode: AppSettings['themeMode']): ThemeName {
  if (mode === 'system') return prefersDark() ? 'night' : 'day';
  return mode;
}

export const applyTheme = (theme: ThemeName) => {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      theme === 'night' ? '#0B0E15' : theme === 'sepia' ? '#F2E7CF' : '#F7EFDC',
    );
  }
};

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: defaultSettings(),
  userRules: [],
  hydrated: false,
  resolvedTheme: 'day',

  hydrate: async () => {
    const settings = await loadSettings();
    const userRules = loadUserRules();
    const resolvedTheme = resolveTheme(settings.themeMode);
    applyTheme(resolvedTheme);
    saveSettings(settings);
    set({ settings, userRules, resolvedTheme, hydrated: true });
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    const resolvedTheme = resolveTheme(settings.themeMode);
    applyTheme(resolvedTheme);
    saveSettings(settings);
    set({ settings, resolvedTheme });
  },

  updateTypography: (patch) => {
    const settings = {
      ...get().settings,
      typography: { ...get().settings.typography, ...patch },
    };
    saveSettings(settings);
    set({ settings });
  },

  setRules: (rules) => {
    saveUserRules(rules);
    set({ userRules: rules.filter((r) => !r.builtin) });
  },
}));

/** 系统主题变化时跟随（仅在 system 模式下生效） */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const fn = () => {
    const { settings, update } = useSettings.getState();
    if (settings.themeMode === 'system') {
      applyTheme(resolveTheme('system'));
      update({ themeMode: 'system' });
    }
  };
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
