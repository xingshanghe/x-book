import { useEffect } from 'react';
import { Route } from 'wouter';
import { Providers } from './app/providers';
import { bootstrap } from './app/bootstrap';
import { ShelfPage } from '@/features/shelf/ShelfPage';
import { ReaderPage } from '@/features/reader/ReaderPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

export function App() {
  useEffect(() => {
    void bootstrap();
  }, []);

  return (
    <Providers>
      <Route path="/" component={ShelfPage} />
      <Route path="/read/:id" component={ReaderPage} />
      <Route path="/settings" component={SettingsPage} />
    </Providers>
  );
}
