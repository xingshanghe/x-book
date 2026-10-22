import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const r = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  // 相对路径：这份 dist 既能跑 Tauri 的资产协议，也能跑 file://（鸿蒙 ArkWeb 外壳），
  // 因此产物不绑定任何一种加载方式。
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 「渐进增强」的分界线：PWA 只是外壳交付形式，
      // 离线能力来自数据全在本地，而非任何 runtimeCaching 外部域名。
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // 显式声明：不缓存任何跨域资源，杜绝隐性网络依赖
        runtimeCaching: [],
      },
      manifest: {
        id: '/',
        name: '轻阅 QINGYUE',
        short_name: '轻阅',
        description: '本地优先、完全离线的 txt 阅读器',
        lang: 'zh-CN',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F7EFDC',
        theme_color: '#3E5C97',
        categories: ['books', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
      injectRegister: null,
    }),
  ],
  resolve: {
    alias: { '@': r('./src') },
  },
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
    assetsInlineLimit: 8192,
    // 受限文件系统下 Vite 的 emptyOutDir（rm -rf dist）可能被安全策略拦截；
    // 关闭后产物按名覆盖，旧的同名修订文件会在 apply-first-clean 脚本里清理。
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || /[\\/]node_modules[\\/](react|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
