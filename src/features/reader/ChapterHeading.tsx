import type { HeadingPlate } from '@/core/parser/chapters';

/** 前言、正文、章回共用的标题牌。章回编号和题名拆开，短标题拉开字距。 */
export function ChapterHeading({ char, plate }: { char: number; plate: HeadingPlate }) {
  const kind = plate.kicker ? 'has-kicker' : '';
  const short = plate.spaced ? 'is-short' : '';
  const className = ['qy-line', 'qy-chapter', `qy-chapter-${plate.role}`, kind, short]
    .filter(Boolean)
    .join(' ');
  return (
    <h2 className={className} data-char={char} aria-label={plate.full}>
      <span className="qy-chapter-kicker" aria-hidden="true">
        {plate.kicker || '◆'}
      </span>
      <span className="qy-chapter-title">{plate.title}</span>
    </h2>
  );
}
