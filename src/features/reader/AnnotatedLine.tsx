import { isNoteDivider, noteLabel, parseFootnoteDef, splitByRefs } from '@/core/parser/footnotes';
import { sentencePieces } from '@/core/text/sentences';

interface Props {
  text: string;
  char: number;
  onNote: (marker: string, anchor: DOMRect, char: number) => void;
}

/** 一行正文：注释界线、章末定义，或带可点注号的段落。 */
export function AnnotatedLine({ text, char, onNote }: Props) {
  if (isNoteDivider(text)) {
    return (
      <p className="qy-line qy-note-rule" data-char={char}>
        <span aria-hidden="true">* * *</span>
      </p>
    );
  }

  const def = parseFootnoteDef(text);
  if (def) {
    return (
      <p className="qy-line qy-note" data-char={char}>
        <span className="qy-note-no">{noteLabel(def.marker)}</span>
        {def.text}
      </p>
    );
  }

  return (
    <p className="qy-line" data-char={char}>
      {sentencePieces(text).map((piece) => {
        const bits = <TextBits text={piece.text} lineChar={char} onNote={onNote} />;
        if (!piece.sentence) return <span key={`g-${piece.start}`}>{bits}</span>;
        return (
          <span key={`s-${piece.start}`} className="qy-sentence" data-char={char + piece.start}>
            {bits}
          </span>
        );
      })}
    </p>
  );
}

function TextBits({
  text,
  lineChar,
  onNote,
}: {
  text: string;
  lineChar: number;
  onNote: Props['onNote'];
}) {
  const parts = splitByRefs(text);
  const counts = new Map<string, number>();
  return parts.map((part) => {
    const base = part.ref ? `r:${part.ref}` : `t:${part.text}`;
    const nth = counts.get(base) ?? 0;
    counts.set(base, nth + 1);
    const key = nth === 0 ? base : `${base}#${nth}`;
    if (!part.ref) return <span key={key}>{part.text}</span>;
    const marker = part.ref;
    return (
      <button
        key={key}
        type="button"
        className="qy-ref"
        aria-label={`注释 ${noteLabel(marker)}`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onNote(marker, event.currentTarget.getBoundingClientRect(), lineChar);
        }}
      >
        {marker}
      </button>
    );
  });
}
