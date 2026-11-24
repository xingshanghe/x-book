import { describe, expect, it } from 'vitest';
import {
  clampPageIndex,
  clampPan,
  fitScale,
  pagePercent,
  panBounds,
} from '@/features/comic/fit';

describe('clampPageIndex', () => {
  it('clamps into range', () => {
    expect(clampPageIndex(-1, 10)).toBe(0);
    expect(clampPageIndex(0, 10)).toBe(0);
    expect(clampPageIndex(9, 10)).toBe(9);
    expect(clampPageIndex(99, 10)).toBe(9);
    expect(clampPageIndex(3.7, 10)).toBe(3);
  });

  it('handles empty books', () => {
    expect(clampPageIndex(5, 0)).toBe(0);
  });
});

describe('pagePercent', () => {
  it('maps first and last page', () => {
    expect(pagePercent(0, 10)).toBe(0);
    expect(pagePercent(9, 10)).toBe(1);
    expect(pagePercent(5, 11)).toBe(0.5);
  });

  it('single page is complete', () => {
    expect(pagePercent(0, 1)).toBe(1);
  });

  it('empty is zero', () => {
    expect(pagePercent(0, 0)).toBe(0);
  });
});

describe('fitScale', () => {
  it('fitWidth uses width ratio', () => {
    expect(fitScale(200, 400, 100, 1000, 'fitWidth')).toBeCloseTo(0.5);
  });

  it('fitHeight uses height ratio', () => {
    expect(fitScale(200, 400, 1000, 100, 'fitHeight')).toBeCloseTo(0.25);
  });

  it('fitPage uses min ratio', () => {
    expect(fitScale(200, 400, 100, 100, 'fitPage')).toBeCloseTo(0.25);
    expect(fitScale(200, 100, 100, 100, 'fitPage')).toBeCloseTo(0.5);
  });
});

describe('panBounds / clampPan', () => {
  it('centers when content fits', () => {
    const b = panBounds(100, 100, 200, 200);
    expect(b).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    expect(clampPan(12, -4, b)).toEqual({ x: 0, y: 0 });
  });

  it('allows slack when zoomed', () => {
    const b = panBounds(400, 200, 200, 200);
    expect(b.minX).toBe(-100);
    expect(b.maxX).toBe(100);
    expect(clampPan(-200, 0, b)).toEqual({ x: -100, y: 0 });
  });
});
