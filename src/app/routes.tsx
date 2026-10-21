import { useEffect } from 'react';
import { Route, Switch as WouterSwitch } from 'wouter';
import { ShelfPage } from '@/features/shelf/ShelfPage';
import { ReaderPage } from '@/features/reader/ReaderPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

export function Routes() {
  return (
    <WouterSwitch>
      <Route path="/" component={ShelfPage} />
      <Route path="/read/:id" component={ReaderPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={ShelfPage} />
    </WouterSwitch>
  );
}

/** 全局键盘：/ 聚焦书架搜索等（阅读页有自己的快捷键层） */
export function GlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ',') {
        e.preventDefault();
        location.hash = '#/settings';
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
