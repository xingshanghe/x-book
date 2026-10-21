/** 启动序列：DB → 设置 → 字体 → 持久化存储申请。任一失败都不阻塞 UI */

import { getDB } from '@/storage/db';
import { restoreFonts } from '@/storage/fontStore';
import { requestPersistentStorage } from '@/lib/platform';
import { useSettings, watchSystemTheme } from './store';

let started = false;

export async function bootstrap(): Promise<void> {
  if (started) return;
  started = true;

  // 1. 设置最优先（决定主题，避免闪屏）
  await useSettings.getState().hydrate();
  watchSystemTheme();

  // 2. 其余并行，失败静默
  void getDB().catch((e) => console.error('[qingyue] IndexedDB 打开失败', e));
  void restoreFonts().catch(() => {});
  void requestPersistentStorage().then((ok) => {
    if (ok) useSettings.setState((s) => ({ settings: { ...s.settings, storagePersisted: true } }));
  });
}
