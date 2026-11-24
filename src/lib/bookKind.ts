import type { Book, BookKind } from '@/types/models';

/** 旧库无 kind 字段时按 txt 处理 */
export function bookKind(book: Pick<Book, 'kind'> | null | undefined): BookKind {
  return book?.kind === 'pdf' ? 'pdf' : 'txt';
}

export function isPdfBook(book: Pick<Book, 'kind'> | null | undefined): boolean {
  return bookKind(book) === 'pdf';
}
