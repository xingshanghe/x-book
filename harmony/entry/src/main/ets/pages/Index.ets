/**
 * 轻阅 · HarmonyOS ArkTS 外壳
 *
 * 思路：UI 100% 由 Web 承载，原生只做——
 *   1. 首次启动把 rawfile/qy 复制到沙箱 files/qy（IndexedDB 同源持久化）；
 *   2. 用虚拟 https://local.qingyue/ + onInterceptRequest 喂本地文件
 *      （ArkWeb 在 file:// / resource:// 下会拦 ES module，导致白屏）；
 *   3. 接管返回键。
 *
 * 注意：不要再额外 loadUrl，也不要用 about:blank 占位——会抢导航、
 * 中断正在解析的 module 依赖图，表现为只执行到内联 boot、界面仍白屏。
 */

import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import webview from '@ohos.web.webview';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Load, LoadResult } from '../common/Load';

const TAG = 'QingYueIndex';
/** 自定义离线源；勿与真实公网域名冲突 */
const ORIGIN = 'https://local.qingyue';
// 必须用 / 而不是 /index.html：wouter 路由挂在 pathname===`/`，
// 否则只会渲染 toast 容器，看起来像白屏。
const ENTRY_URL = `${ORIGIN}/`;

@Entry
@Component
struct Index {
  private webController: webview.WebviewController = new webview.WebviewController();
  @State private ready: boolean = false;
  @State private cacheDir: string = '';
  @State private errorText: string = '';

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    Load.prepare(context)
      .then((result: LoadResult) => {
        hilog.info(0x0000, TAG, `准备就绪 dir=${result.dir}`);
        this.cacheDir = result.dir;
        this.errorText = '';
        this.ready = true;
      })
      .catch((e: Error) => {
        const msg = e?.message ?? String(e);
        hilog.error(0x0000, TAG, `准备资产失败: ${msg}`);
        this.errorText = `无法加载页面：${msg}`;
        this.ready = false;
      });
  }

  /** 把 https://local.qingyue/... 映射到 files/qy/... */
  private intercept(url: string): WebResourceResponse | null {
    if (!url.startsWith(ORIGIN)) {
      return null;
    }
    let rel = url.substring(ORIGIN.length);
    const q = rel.indexOf('?');
    if (q >= 0) rel = rel.substring(0, q);
    const h = rel.indexOf('#');
    if (h >= 0) rel = rel.substring(0, h);
    if (rel.startsWith('/')) rel = rel.substring(1);
    if (rel.length === 0 || rel.endsWith('/')) {
      rel = `${rel}index.html`;
    }
    try {
      rel = decodeURIComponent(rel);
    } catch (_e) {
      // keep raw
    }

    const filePath = `${this.cacheDir}/${rel}`;
    try {
      if (!fs.accessSync(filePath) || !fs.statSync(filePath).isFile()) {
        hilog.error(0x0000, TAG, `拦截 404 ${rel}`);
        return Index.notFound(rel);
      }
      const file = fs.openSync(filePath, fs.OpenMode.READ_ONLY);
      const size = fs.statSync(filePath).size;
      const buf = new ArrayBuffer(size);
      fs.readSync(file.fd, buf);
      fs.closeSync(file.fd);

      const mime = Index.mimeOf(rel);
      hilog.info(0x0000, TAG, `拦截 200 ${rel} (${size}B, ${mime})`);
      const response = new WebResourceResponse();
      response.setResponseData(buf);
      response.setResponseEncoding('utf-8');
      response.setResponseMimeType(mime);
      response.setResponseCode(200);
      response.setReasonMessage('OK');
      response.setResponseHeader([
        { headerKey: 'Access-Control-Allow-Origin', headerValue: '*' },
        { headerKey: 'Cache-Control', headerValue: 'no-cache' },
        { headerKey: 'Content-Type', headerValue: `${mime}; charset=utf-8` }
      ]);
      response.setResponseIsReady(true);
      return response;
    } catch (e) {
      hilog.error(0x0000, TAG, `拦截读失败 ${rel}: ${JSON.stringify(e)}`);
      return Index.notFound(rel);
    }
  }

  private static notFound(rel: string): WebResourceResponse {
    const response = new WebResourceResponse();
    const msg = `not found: ${rel}`;
    const bytes = new Uint8Array(msg.length);
    for (let i = 0; i < msg.length; i++) {
      bytes[i] = msg.charCodeAt(i) & 0xff;
    }
    response.setResponseData(bytes.buffer);
    response.setResponseEncoding('utf-8');
    response.setResponseMimeType('text/plain');
    response.setResponseCode(404);
    response.setReasonMessage('Not Found');
    response.setResponseIsReady(true);
    return response;
  }

  private static mimeOf(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
    if (lower.endsWith('.css')) return 'text/css';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.woff2')) return 'font/woff2';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.wasm')) return 'application/wasm';
    return 'application/octet-stream';
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.errorText.length > 0) {
        Text(this.errorText)
          .fontSize(16)
          .fontColor('#8B4513')
          .padding(24)
          .textAlign(TextAlign.Center)
          .width('100%')
      } else if (this.ready) {
        Web({ src: ENTRY_URL, controller: this.webController })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .imageAccess(true)
          .databaseAccess(true)
          .onlineImageAccess(true)
          .cacheMode(CacheMode.None)
          .mixedMode(MixedMode.All)
          .layoutMode(WebLayoutMode.NONE)
          .width('100%')
          .height('100%')
          .backgroundColor('#F7EFDC')
          .onInterceptRequest((event) => {
            if (!event) {
              return null;
            }
            return this.intercept(event.request.getRequestUrl());
          })
          .onPageBegin((event) => {
            hilog.info(0x0000, TAG, `页面开始加载 ${event?.url ?? ''}`);
            // 尽早打上鸿蒙标记 + 安全区，避免首帧顶栏被状态栏压住
            try {
              this.webController.runJavaScript(
                `(function(){try{window.__QY_HARMONY__=true;` +
                  `var el=document.documentElement;` +
                  `el.dataset.os='harmony';el.dataset.arkweb='1';` +
                  `el.style.setProperty('--safe-t','56px');` +
                  `el.style.setProperty('--safe-b','20px');` +
                  `}catch(e){}})()`
              );
            } catch (e) {
              hilog.warn(0x0000, TAG, `注入安全区失败: ${JSON.stringify(e)}`);
            }
          })
          .onPageEnd((event) => {
            hilog.info(0x0000, TAG, `页面加载结束 ${event?.url ?? ''}`);
            // 诊断：白屏时看 #root 是否挂上了 React、有无 JS 异常
            try {
              this.webController.runJavaScript(
                `(function(){try{var r=document.getElementById('root');` +
                  `var html=r?r.innerHTML:'<no-root>';` +
                  `var kids=r?r.children.length:-1;` +
                  `var st=getComputedStyle(document.documentElement);` +
                  `return JSON.stringify({kids:kids,len:html.length,head:html.slice(0,120),` +
                  `safeT:st.getPropertyValue('--safe-t').trim(),` +
                  `os:document.documentElement.dataset.os||'',` +
                  `ua:navigator.userAgent.slice(0,80),err:window.__qyErr||null});` +
                  `}catch(e){return 'probe-fail:'+e}})()`
              ).then((ret: string) => {
                hilog.info(0x0000, TAG, `probe ${ret}`);
              }).catch((e: Error) => {
                hilog.error(0x0000, TAG, `probe failed ${e?.message ?? String(e)}`);
              });
            } catch (e) {
              hilog.error(0x0000, TAG, `runJavaScript throw ${JSON.stringify(e)}`);
            }
          })
          .onErrorReceive((event) => {
            if (event) {
              hilog.error(0x0000, TAG, `Web 错误: ${event.error?.getErrorInfo?.() ?? 'unknown'} url=${event.request?.getRequestUrl?.() ?? ''}`);
            }
          })
          .onConsole((event) => {
            if (event) {
              hilog.info(0x0000, TAG, `console: ${event.message.getMessage()}`);
            }
            return false;
          })
          .onAlert((event) => {
            if (event) {
              hilog.warn(0x0000, TAG, `alert: ${event.message}`);
              event.result.handleConfirm();
              return true;
            }
            return false;
          })
      } else {
        Column() {
          LoadingProgress().width(48).height(48).color('#3E5C97')
          Text('轻阅加载中…')
            .margin({ top: 16 })
            .fontSize(14)
            .fontColor('#746851')
        }
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F7EFDC')
  }

  onBackPress(): boolean {
    if (this.ready && this.webController.accessBackward()) {
      this.webController.backward();
      return true;
    }
    return false;
  }
}
