/**
 * 轻阅 · HarmonyOS ArkTS 外壳
 *
 * 思路：UI 100% 由 Web 承载，原生只做三件事——
 *   1. 首次启动时把 rawfile 里的 dist 复制到应用沙箱 files/qy；
 *   2. 用 Web 组件以 file:// 加载沙箱中的 index.html（同源持久化，IndexedDB 可用）；
 *   3. 接管返回键（web 内部历史优先）。
 *
 * 不申请 INTERNET 权限 —— 这样从机制上保证离线。
 */

import common from '@ohos.app.ability.common';
import webview from '@ohos.web.webview';
import { Load } from '../common/Load';

@Entry
@Component
struct Index {
  private webController: webview.WebviewController = new webview.WebviewController();
  @State private ready: boolean = false;
  @State private src: string = '';

  aboutToAppear(): void {
    const context = getContext(this) as common.UIAbilityContext;
    Load.prepare(context).then((url: string) => {
      this.src = url;
      this.ready = true;
    });
  }

  build() {
    Column() {
      if (this.ready) {
        Web({ src: this.src, controller: this.webController })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .imageAccess(true)
          .databaseAccess(true)
          .cacheMode(CacheMode.Default)
          .mixedMode(MixedMode.All)
          .layoutMode(WebLayoutMode.FIT_CONTENT)
          .width('100%')
          .height('100%')
          .backgroundColor('#F7EFDC')
          // 文件拖拽/选择：由 ArkWeb 提供，导入仍走 Web 的 input[type=file]
          .onPageEnd(() => {
            // 页面加载完成，可在此触发 splash 关闭
          })
          .onAlert((event) => {
            if (event) {
              console.warn('[qingyue] alert: ' + event.message);
              event.result.handleConfirm();
              return true;
            }
            return false;
          })
      } else {
        LoadingProgress().width(48).height(48).color('#3E5C97')
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor('#F7EFDC')
  }

  // 物理返回键 / 侧滑返回：先退 Web 历史
  onBackPress(): boolean {
    if (this.ready && this.webController.accessBackward()) {
      this.webController.backward();
      return true;
    }
    return false;
  }
}
