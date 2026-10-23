import { useEffect } from 'react';
import { Route, useLocation } from 'wouter';
import { ReaderPage } from '@/features/reader/ReaderPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ShelfPage } from '@/features/shelf/ShelfPage';
import { bootstrap } from './app/bootstrap';
import { ErrorBoundary } from './app/ErrorBoundary';
import { Providers } from './app/providers';

/** 原生菜单「设置…」不经过网页快捷键，由壳层派发这个事件。 */
function NativeMenuBridge() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const onMenu = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== 'settings') return;
      navigate('/settings');
    };
    window.addEventListener('qingyue:menu', onMenu);
    return () => window.removeEventListener('qingyue:menu', onMenu);
  }, [navigate]);
  return null;
}

export function App() {
  useEffect(() => {
    void bootstrap();
  }, []);

  return (
    <ErrorBoundary>
      <Providers>
        <NativeMenuBridge />
        <Route path="/" component={ShelfPage} />
        <Route path="/read/:id" component={ReaderPage} />
        <Route path="/settings" component={SettingsPage} />
      </Providers>
    </ErrorBoundary>
  );
}
