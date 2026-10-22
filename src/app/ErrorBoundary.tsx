/**
 * 兜底错误边界。
 *
 * 没有它时，任何一处渲染期异常（比如某本书元数据缺字段）都会让 React
 * 卸载整棵树 —— 窗口里只剩纸面背景和红绿灯，用户完全无从判断发生了什么。
 * 这里把错误就地显示出来，并提供重试 / 重新加载，书架数据不受影响。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[qingyue] 渲染异常', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="qy-crash" role="alert">
        <h1>界面出了点问题</h1>
        <p>书都还在本地，重试或重新加载即可，不会丢数据。</p>
        <pre>{error.message || String(error)}</pre>
        <div className="qy-crash-actions">
          <button type="button" className="qy-crash-primary" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
