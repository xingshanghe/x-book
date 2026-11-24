import { describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_DEFAULT_LPM,
  AUTO_SCROLL_MAX_LPM,
  AUTO_SCROLL_MIN_LPM,
  AUTO_SCROLL_STEP_LPM,
  atScrollEnd,
  autoScrollPxPerSec,
  bumpAutoScrollSpeed,
  clampAutoScrollSpeed,
} from '@/features/reader/autoScroll';

describe('clampAutoScrollSpeed', () => {
  it('把速度收进 3–60 行/分钟，并对齐档位', () => {
    expect(clampAutoScrollSpeed(0)).toBe(AUTO_SCROLL_MIN_LPM);
    expect(clampAutoScrollSpeed(1000)).toBe(AUTO_SCROLL_MAX_LPM);
    expect(clampAutoScrollSpeed(13)).toBe(12);
    expect(clampAutoScrollSpeed(14)).toBe(15);
    expect(clampAutoScrollSpeed(AUTO_SCROLL_DEFAULT_LPM)).toBe(AUTO_SCROLL_DEFAULT_LPM);
  });

  it('脏数据回落到默认值，而不是 NaN', () => {
    expect(clampAutoScrollSpeed(Number.NaN)).toBe(AUTO_SCROLL_DEFAULT_LPM);
    expect(clampAutoScrollSpeed(Number.POSITIVE_INFINITY)).toBe(AUTO_SCROLL_DEFAULT_LPM);
  });
});

describe('bumpAutoScrollSpeed', () => {
  it('每次加减一档，并在两端夹住', () => {
    expect(bumpAutoScrollSpeed(12, 1)).toBe(15);
    expect(bumpAutoScrollSpeed(12, -1)).toBe(9);
    expect(bumpAutoScrollSpeed(AUTO_SCROLL_MAX_LPM, 1)).toBe(AUTO_SCROLL_MAX_LPM);
    expect(bumpAutoScrollSpeed(AUTO_SCROLL_MIN_LPM, -1)).toBe(AUTO_SCROLL_MIN_LPM);
    expect(AUTO_SCROLL_STEP_LPM).toBe(3);
  });
});

describe('autoScrollPxPerSec', () => {
  it('按行高把「行/分钟」换算成像素/秒', () => {
    // 12 行/分 × 36px/行 = 432px/分 = 7.2px/秒
    expect(autoScrollPxPerSec(12, 36)).toBeCloseTo(7.2);
    expect(autoScrollPxPerSec(60, 36)).toBeCloseTo(36);
  });

  it('行高非法时返回 0，循环不会除零或拿到 NaN', () => {
    expect(autoScrollPxPerSec(12, 0)).toBe(0);
    expect(autoScrollPxPerSec(12, Number.NaN)).toBe(0);
  });
});

describe('atScrollEnd', () => {
  it('视口底部碰到正文末尾才算到底', () => {
    expect(atScrollEnd({ scrollTop: 800, clientHeight: 800, scrollHeight: 1700 })).toBe(false);
    expect(atScrollEnd({ scrollTop: 900, clientHeight: 800, scrollHeight: 1700 })).toBe(true);
    expect(atScrollEnd({ scrollTop: 0, clientHeight: 800, scrollHeight: 600 })).toBe(true);
  });
});
