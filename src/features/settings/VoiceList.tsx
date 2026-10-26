import { Button } from '@/ui';

export interface VoiceListItem {
  id: string;
  name: string;
}

/** 引擎示例和自己的音色放在同一份列表里。示例只能移除，自己的音色可以改名、删除。 */
export function VoiceList({
  voices,
  builtinHidden,
  onRename,
  onRemove,
  onHideBuiltin,
  onRestoreBuiltin,
}: {
  voices: readonly VoiceListItem[];
  builtinHidden: boolean;
  onRename: (id: string) => void;
  onRemove: (id: string) => void;
  onHideBuiltin: () => void;
  onRestoreBuiltin: () => void;
}) {
  const empty = builtinHidden && voices.length === 0;

  return (
    <div className="voice-catalog">
      {empty ? <p className="desc">列表里还没有音色。</p> : null}
      <ul className="voice-list">
        {!builtinHidden && (
          <li className="voice-row">
            <div className="voice-row-name">
              <b>引擎示例（雷军）</b>
              <span className="voice-badge">内置</span>
            </div>
            <span className="voice-row-actions">
              <Button size="sm" onClick={onHideBuiltin}>
                删除
              </Button>
            </span>
          </li>
        )}
        {voices.map((voice) => (
          <li className="voice-row" key={voice.id}>
            <div className="voice-row-name">
              <b>{voice.name}</b>
            </div>
            <span className="voice-row-actions">
              <Button size="sm" onClick={() => onRename(voice.id)}>
                改名
              </Button>
              <Button size="sm" onClick={() => onRemove(voice.id)}>
                删除
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {builtinHidden ? (
        <Button size="sm" onClick={onRestoreBuiltin}>
          恢复引擎示例
        </Button>
      ) : null}
    </div>
  );
}
