import { ChapterDetector, BUILTIN_CHAPTER_SOURCES } from '../src/core/parser/chapters';

const d = new ChapterDetector();
const cases = ['第一章 开端', '第100章 大结局（下）', '卷一', 'Chapter 12: The End', '楔子', '后记', '12、夜航船', '正文一'];
for (const c of cases) {
  console.log(c.padEnd(20), d.test(c) ? 'HIT ' + d.test(c)!.title : 'null');
}
console.log('--- single patterns ---');
for (const s of BUILTIN_CHAPTER_SOURCES) {
  const re = new RegExp(s);
  console.log(re.test('Chapter 12: The End'), s.slice(0, 40));
}
