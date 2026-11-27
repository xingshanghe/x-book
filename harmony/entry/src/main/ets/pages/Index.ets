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
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Load, LoadResult } from '../common/Load';
import { NetBridge } from '../common/NetBridge';

const TAG = 'QingYueIndex';
/** 自定义离线源；勿与真实公网域名冲突 */
const ORIGIN = 'https://local.qingyue';
// 必须用 / 而不是 /index.html：wouter 路由挂在 pathname===`/`，
// 否则只会渲染 toast 容器，看起来像白屏。
const ENTRY_URL = `${ORIGIN}/`;
/** 读不到系统避让区时的兜底（vp）——宁多勿少，避免顶栏被状态栏压住 */
const FALLBACK_SAFE_TOP = 44;
const FALLBACK_SAFE_BOTTOM = 20;

@Entry
@Component
struct Index {
  private webController: webview.WebviewController = new webview.WebviewController();
  /** H5 账号 / 云书架走原生 HTTP，避开 https 页拦明文 http */
  private netBridge: NetBridge = new NetBridge();
  private progressBound: boolean = false;
  @State private ready: boolean = false;
  @State private cacheDir: string = '';
  @State private errorText: string = '';
  /** 系统状态栏高度（vp），注入给 Web 的 --safe-t */
  @State private safeTopVp: number = FALLBACK_SAFE_TOP;
  @State private safeBottomVp: number = FALLBACK_SAFE_BOTTOM;
  private avoidBound: boolean = false;

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    this.bindAvoidArea(context);
    this.bindNetProgress();
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

  /** 原生 HTTP 进度 → H5 window.__QY_NET_PROGRESS__ */
  private bindNetProgress(): void {
    if (this.progressBound) {
      return;
    }
    this.progressBound = true;
    this.netBridge.setProgressEmitter((id: string, loaded: number, total: number) => {
      try {
        const script =
          `try{window.__QY_NET_PROGRESS__&&window.__QY_NET_PROGRESS__(${JSON.stringify(id)},${loaded},${total})}catch(e){}`;
        this.webController.runJavaScript(script);
      } catch (e) {
        hilog.warn(0x0000, TAG, `推送传输进度失败: ${JSON.stringify(e)}`);
      }
    });
  }

  /** 读系统避让区（状态栏 / 导航条），横竖屏变化时再推一次给 Web */
  private bindAvoidArea(context: common.UIAbilityContext): void {
    window.getLastWindow(context)
      .then((win: window.Window) => {
        this.applyAvoidArea(win);
        if (this.avoidBound) {
          return;
        }
        this.avoidBound = true;
        win.on('avoidAreaChange', () => {
          this.applyAvoidArea(win);
          if (this.ready) {
            this.injectSafeInsets();
          }
        });
      })
      .catch((e: Error) => {
        hilog.warn(0x0000, TAG, `读取避让区失败: ${e?.message ?? String(e)}`);
      });
  }

  private applyAvoidArea(win: window.Window): void {
    try {
      const system = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const nav = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      const ui = this.getUIContext();
      const topPx = system.topRect.height;
      const bottomPx = Math.max(system.bottomRect.height, nav.bottomRect.height);
      const topVp = topPx > 0 ? Math.ceil(ui.px2vp(topPx)) : FALLBACK_SAFE_TOP;
      const bottomVp = bottomPx > 0 ? Math.ceil(ui.px2vp(bottomPx)) : FALLBACK_SAFE_BOTTOM;
      // 顶栏控件本身还有行高，再留 8vp 呼吸，避免字贴住系统时间
      this.safeTopVp = Math.max(topVp, FALLBACK_SAFE_TOP);
      this.safeBottomVp = Math.max(bottomVp, FALLBACK_SAFE_BOTTOM);
      hilog.info(0x0000, TAG, `避让区 top=${this.safeTopVp}vp bottom=${this.safeBottomVp}vp (px ${topPx}/${bottomPx})`);
    } catch (e) {
      hilog.warn(0x0000, TAG, `解析避让区失败: ${JSON.stringify(e)}`);
    }
  }

  /** 把实测安全区写进 CSS 变量 + 顶栏实值（ArkWeb 对 calc(var()) 不稳） */
  private injectSafeInsets(): void {
    const top = this.safeTopVp;
    const bottom = this.safeBottomVp;
    // 书架/设置只留 4vp 呼吸；阅读顶栏同样紧凑
    const shelfPad = top + 4;
    const readerPad = top + 4;
    const script =
      `(function(){try{window.__QY_HARMONY__=true;` +
      `var el=document.documentElement;` +
      `el.dataset.os='harmony';el.dataset.arkweb='1';` +
      `el.style.setProperty('--safe-t','${top}px');` +
      `el.style.setProperty('--safe-b','${bottom}px');` +
      `var s=document.getElementById('qy-safe-dyn');` +
      `if(!s){s=document.createElement('style');s.id='qy-safe-dyn';document.documentElement.appendChild(s);}` +
      `s.textContent='html[data-arkweb="1"] .shelf-top,html[data-arkweb="1"] .settings-top{padding-top:${shelfPad}px!important}'` +
      `+'html[data-arkweb="1"] .reader-bar.top,html[data-arkweb="1"] .comic-top{padding-top:${readerPad}px!important}'` +
      `+'html[data-arkweb="1"] .toc-rail-head{padding-top:${readerPad}px!important}';` +
      `}catch(e){}})()`;
    try {
      this.webController.runJavaScript(script);
    } catch (e) {
      hilog.warn(0x0000, TAG, `注入安全区失败: ${JSON.stringify(e)}`);
    }
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
          .javaScriptProxy({
            object: this.netBridge,
            name: '__QY_NET__',
            methodList: ['request'],
            controller: this.webController,
            // 仅允许本壳虚拟源调用，避免第三方页蹭桥
            permission:
              '{"javascriptProxyPermission":{"urlPermissionList":[{"scheme":"https","host":"local.qingyue","port":"","path":""}],"methodList":[{"methodName":"request","urlPermissionList":[{"scheme":"https","host":"local.qingyue","port":"","path":""}]}]}}',
          })
          .onInterceptRequest((event) => {
            if (!event) {
              return null;
            }
            return this.intercept(event.request.getRequestUrl());
          })
          .onPageBegin((event) => {
            hilog.info(0x0000, TAG, `页面开始加载 ${event?.url ?? ''}`);
            // 尽早注入实测安全区，避免首帧顶栏被状态栏压住
            this.injectSafeInsets();
          })
          .onPageEnd((event) => {
            hilog.info(0x0000, TAG, `页面加载结束 ${event?.url ?? ''}`);
            // React 挂载后再推一次，覆盖首帧前可能被 CSS 回写的值
            this.injectSafeInsets();
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
