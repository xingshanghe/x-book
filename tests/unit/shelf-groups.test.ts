import { describe, expect, it } from 'vitest';
import {
  addGroupToCatalog,
  encodeBookDragPayload,
  filterBooksByGroup,
  groupSectionTitle,
  listShelfGroups,
  normalizeGroupName,
  parseBookDragPayload,
  removeGroupFromCatalog,
  renameGroupInCatalog,
  resolveDragBookIds,
} from '@/features/shelf/groups';
import type { Book } from '@/types/models';

function book(partial: Partial<Book> & Pick<Book, 'id' | 'title'>): Book {
  return {
    size: 1,
    encoding: 'utf-8',
    fingerprint: partial.id,
    blockSize: 1,
    blockCount: 1,
    charCount: 1,
    lineCount: 1,
    chapterCount: 0,
    cleanedLines: 0,
    footnoteCount: 0,
    status: 'ready',
    indexProgress: 1,
    finished: false,
    createdAt: 0,
    coverHue: 0,
    ...partial,
  };
}

describe('normalizeGroupName', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeGroupName('  西游  记  ')).toBe('西游 记');
  });

  it('rejects empty and reserved names', () => {
    expect(normalizeGroupName('')).toBeNull();
    expect(normalizeGroupName('   ')).toBeNull();
    expect(normalizeGroupName('全部')).toBeNull();
    expect(normalizeGroupName('未分组')).toBeNull();
  });

  it('truncates long names', () => {
    expect(normalizeGroupName('甲'.repeat(30))?.length).toBe(24);
  });
});

describe('listShelfGroups', () => {
  it('keeps catalog order and appends orphans from books', () => {
    const books = [book({ id: '1', title: 'a', group: '连环画' }), book({ id: '2', title: 'b' })];
    expect(listShelfGroups(['名著', '连环画'], books)).toEqual(['名著', '连环画']);
    expect(listShelfGroups(['名著'], books)).toEqual(['名著', '连环画']);
  });
});

describe('filterBooksByGroup', () => {
  const books = [
    book({ id: '1', title: 'a', group: '名著' }),
    book({ id: '2', title: 'b' }),
    book({ id: '3', title: 'c', group: '名著' }),
  ];

  it('filters all / ungrouped / named', () => {
    expect(filterBooksByGroup(books, 'all')).toHaveLength(3);
    expect(filterBooksByGroup(books, 'ungrouped').map((b) => b.id)).toEqual(['2']);
    expect(filterBooksByGroup(books, '名著').map((b) => b.id)).toEqual(['1', '3']);
  });
});

describe('groupSectionTitle', () => {
  it('labels built-in filters', () => {
    expect(groupSectionTitle('all')).toBe('全部书籍');
    expect(groupSectionTitle('ungrouped')).toBe('未分组');
    expect(groupSectionTitle('名著')).toBe('名著');
  });
});

describe('catalog mutations', () => {
  it('adds, renames, removes', () => {
    expect(addGroupToCatalog([], ' 名著 ')).toEqual(['名著']);
    expect(addGroupToCatalog(['名著'], '名著')).toEqual(['名著']);
    expect(renameGroupInCatalog(['名著', '诗'], '名著', '古典')).toEqual(['古典', '诗']);
    expect(renameGroupInCatalog(['名著'], '名著', '诗')).toEqual(['诗']);
    expect(renameGroupInCatalog(['名著', '诗'], '名著', '诗')).toBeNull();
    expect(removeGroupFromCatalog(['名著', '诗'], '名著')).toEqual(['诗']);
  });
});

describe('book drag payload', () => {
  it('resolveDragBookIds expands selection when dragged id is selected', () => {
    expect(resolveDragBookIds('a', new Set(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
    expect(resolveDragBookIds('x', new Set(['a', 'b']))).toEqual(['x']);
    expect(resolveDragBookIds('a', new Set())).toEqual(['a']);
  });

  it('round-trips encode/parse and rejects junk', () => {
    expect(parseBookDragPayload(encodeBookDragPayload(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseBookDragPayload(encodeBookDragPayload(['a', 'a', '']))).toEqual(['a']);
    expect(parseBookDragPayload(null)).toEqual([]);
    expect(parseBookDragPayload('not-json')).toEqual([]);
    expect(parseBookDragPayload('{"a":1}')).toEqual([]);
    expect(parseBookDragPayload('[1,"ok",null]')).toEqual(['ok']);
  });
});
