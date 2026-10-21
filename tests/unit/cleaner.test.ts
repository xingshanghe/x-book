import { describe, expect, it } from 'vitest';
import { BUILTIN_RULES, Cleaner, mergeRules } from '@/core/parser/cleaner';

describe('内置清洗规则', () => {
  it('全部正则可编译（避免像 \\b? 这类非法写法）', () => {
    for (const r of BUILTIN_RULES) {
      expect(() => new RegExp(r.pattern), r.name).not.toThrow();
    }
  });

  const samples = [
    '更多好书下载：www.dospy.com',
    '本书由 bbs.dospy.com 收集整理',
    '——知轩藏书——',
    '喜欢这本书的话请支持正版',
    'http://www.example.com/book',
  ];

  it('命中常见站点广告行', () => {
    const c = new Cleaner(mergeRules([]), true);
    for (const s of samples) {
      expect(c.test(s), s).not.toBeNull();
    }
  });

  it('正文绝不误伤', () => {
    const c = new Cleaner(mergeRules([]), true);
    for (const s of [
      '他把灯笼挂在船头',
      '第一章 夜航',
      '请支持正版这句话出现在对话里',
      '他说：本书由他父亲写成，后来被很多人收集整理。',
    ]) {
      // 只有「请支持正版」结尾式广告才命中，句中出现不命中
      expect(c.test(s), s).toBeNull();
    }
  });

  it('关闭清洗后不命中任何行', () => {
    const c = new Cleaner(mergeRules([]), false);
    expect(c.isEmpty).toBe(true);
    expect(c.test(samples[0])).toBeNull();
  });
});
