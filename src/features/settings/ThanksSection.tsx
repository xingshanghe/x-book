import thanksFile from './thanks.json';

interface ThanksPerson {
  name: string;
  via?: string;
}

/** 鸣谢名单只读 thanks.json。赞助开通不会往这里写名字。 */
export function ThanksSection() {
  const entries = (thanksFile.entries as ThanksPerson[]).filter((entry) => entry.name.trim());

  return (
    <>
      <h2>鸣谢</h2>
      <p className="desc">{thanksFile.intro}</p>
      {entries.length === 0 ? (
        <p className="desc">这一版还没有写上名字。</p>
      ) : (
        <ul className="thanks-list">
          {entries.map((entry) => (
            <li className="thanks-item" key={`${entry.name}-${entry.via ?? ''}`}>
              <b>{entry.name}</b>
              {entry.via ? <span>{entry.via}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
