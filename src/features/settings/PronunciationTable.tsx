import { useState } from 'react';
import {
  explainPronunciation,
  normalizedReading,
  PRONUNCIATION_LIMIT,
  type Pronunciation,
  readPronunciations,
  writePronunciations,
} from '@/tts/pronounce';
import { Button } from '@/ui';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 朗读设置里的注音表。记下的词从下一句开始按这里的读音读。 */
export function PronunciationTable({
  toast,
  storage,
}: {
  toast: (text: string) => void;
  storage?: Store;
}) {
  const [rows, setRows] = useState<Pronunciation[]>(() => readPronunciations(storage));
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');

  const add = () => {
    const error = explainPronunciation(word, reading);
    if (error) {
      toast(error);
      return;
    }
    const spoken = normalizedReading(reading);
    if (!spoken) {
      toast('请填写读音');
      return;
    }
    const entry = { word: word.trim(), reading: spoken };
    const exists = rows.some((row) => row.word === entry.word);
    if (!exists && rows.length >= PRONUNCIATION_LIMIT) {
      toast(`注音表最多 ${PRONUNCIATION_LIMIT} 条`);
      return;
    }
    const next = writePronunciations(
      [entry, ...rows.filter((row) => row.word !== entry.word)],
      storage,
    );
    setRows(next);
    setWord('');
    setReading('');
    toast(exists ? '已改这条读音' : '已记下');
  };

  return (
    <div className="pronounce">
      <h3>注音</h3>
      <p className="desc">
        某个词读错时，把词语和读音填在这里。每个字一个音节，声调用数字，例如行长 hang2
        zhang3，也可以写 háng
        zhǎng。按整词生效，想改「银行」就写「银行」，不要只写「行」。一次最多十个字。
      </p>
      <form
        className="pronounce-form"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label>
          词语
          <input
            value={word}
            maxLength={10}
            placeholder="行长"
            onChange={(event) => setWord(event.target.value)}
          />
        </label>
        <label>
          读音
          <input
            value={reading}
            placeholder="hang2 zhang3"
            onChange={(event) => setReading(event.target.value)}
          />
        </label>
        <Button size="sm" type="submit">
          添加
        </Button>
      </form>
      {rows.length > 0 ? (
        <ul className="voice-list">
          {rows.map((row) => (
            <li className="voice-row" key={row.word}>
              <div className="voice-row-name">
                <b>{row.word}</b>
                <span className="voice-badge">{row.reading}</span>
              </div>
              <span className="voice-row-actions">
                <Button
                  size="sm"
                  onClick={() => {
                    const next = writePronunciations(
                      rows.filter((item) => item.word !== row.word),
                      storage,
                    );
                    setRows(next);
                  }}
                >
                  删除
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
