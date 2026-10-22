import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPlatformFlags } from './lib/platform';
import { installGlobalDrop } from './features/import/importQueue';
import './styles/tokens.css';
import './styles/base.css';
import './styles/motion.css';

// 先落平台标记再挂载，避免首帧顶栏位置跳一下
applyPlatformFlags();
// 拖放监听早于渲染挂上：任何页面拖入文件都不会被 WebView 当成导航
installGlobalDrop();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root 缺失');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
