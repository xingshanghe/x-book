import { UIAbility, AbilityConstant, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'QingYueAbility';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, '轻阅启动');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(0x0000, TAG, `加载页面失败: ${err.message}`);
        return;
      }
      try {
        const win = windowStage.getMainWindowSync();
        // 全屏沉浸：内容延伸到状态栏下方，由 Web 用 --safe-t 自行让位
        win.setWindowLayoutFullScreen(true);
        win.setWindowSystemBarProperties({
          statusBarColor: '#F7EFDC',
          statusBarContentColor: '#1A1A1A',
          navigationBarColor: '#F7EFDC',
          navigationBarContentColor: '#1A1A1A'
        });
      } catch (e) {
        hilog.warn(0x0000, TAG, `窗口沉浸配置失败: ${JSON.stringify(e)}`);
      }
    });
  }
}

interface BusinessError {
  code: number;
  message: string;
}
