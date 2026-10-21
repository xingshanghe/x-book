/** 尾部去抖：用于进度落盘，保证「最后一次一定写」 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...args);
    }, wait);
  };
  run.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
  };
  run.flush = (...args: A) => {
    if (t) clearTimeout(t);
    t = undefined;
    fn(...args);
  };
  return run;
}

/** 节流：用于 scroll / resize，保证每 wait 毫秒最多执行一次（首帧立即） */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, wait = 100) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  const invoke = (args: A) => {
    last = Date.now();
    fn(...args);
  };
  const run = (...args: A) => {
    const now = Date.now();
    const remain = wait - (now - last);
    if (remain <= 0) {
      invoke(args);
      return;
    }
    pending = args;
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) invoke(pending);
        pending = null;
      }, remain);
    }
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  return run;
}

/** 让浏览器在空闲时做预取；不支持则回退 setTimeout */
export function onIdle(fn: () => void, timeout = 1200): () => void {
  const ric = (globalThis as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    const handle = ric(fn, { timeout });
    return () => (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
  }
  const t = setTimeout(fn, 16);
  return () => clearTimeout(t);
}
