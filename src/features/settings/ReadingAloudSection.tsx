import { useEffect, useRef, useState } from 'react';
import { accountSession } from '@/account/session';
import {
  listVoices,
  readBuiltinHidden,
  removeVoice,
  renameVoice,
  saveVoice,
  voiceLimitError,
  writeBuiltinHidden,
} from '@/storage/voiceStore';
import { BUILTIN_VOICE_SLOTS, VOICE_KEEP_LIMIT } from '@/tts/account';
import {
  deleteInstalledEngine,
  downloadDesktopEngine,
  type EngineProgress,
  engineDownloadLabel,
  engineProgressLabel,
  readEnginePhase,
} from '@/tts/engine';
import { readReadingPrefs, writeReadingPrefs } from '@/tts/prefs';
import { desktopReadingReady } from '@/tts/support';
import type { VoicePack } from '@/tts/types';
import { type ParsedVoicePack, readVoicePack, voicePackSource } from '@/tts/voicePack';
import { Button } from '@/ui';
import { PronunciationTable } from './PronunciationTable';
import { useAccountProfile } from './useAccountProfile';
import { VoiceList } from './VoiceList';
import { VoiceRecord } from './VoiceRecord';
import { VoiceSponsor } from './VoiceSponsor';

export function ReadingAloudSection({ toast }: { toast: (text: string) => void }) {
  const profile = useAccountProfile();
  const [voices, setVoices] = useState<VoicePack[]>([]);
  const [builtinHidden, setBuiltinHidden] = useState(() => readBuiltinHidden());
  const ready = desktopReadingReady();
  const [progress, setProgress] = useState<EngineProgress | null>(null);

  useEffect(() => {
    void listVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
    if (accountSession.hasStoredSession()) void accountSession.restore();
  }, []);

  const refreshProfile = async () => {
    const me = await accountSession.client().me();
    if (me.data) accountSession.remember(me.data);
  };

  const builtinSlots = builtinHidden ? 0 : BUILTIN_VOICE_SLOTS;
  const gate = (): string | null => voiceLimitError(voices.length, VOICE_KEEP_LIMIT, builtinSlots);

  const hideBuiltin = () => {
    writeBuiltinHidden(true);
    setBuiltinHidden(true);
    if (readReadingPrefs().voiceId === 'builtin') writeReadingPrefs({ voiceId: 'auto' });
    toast('已从列表移除');
  };

  const restoreBuiltin = () => {
    if (voices.length + BUILTIN_VOICE_SLOTS > VOICE_KEEP_LIMIT) {
      toast(`最多保留 ${VOICE_KEEP_LIMIT} 个音色，请先删掉一个`);
      return;
    }
    writeBuiltinHidden(false);
    setBuiltinHidden(false);
  };

  return (
    <>
      <h2>朗读</h2>
      <p className="desc">
        {ready ? engineDownloadLabel() : '朗读即将支持。当前只有 macOS 桌面版可以下载引擎。'}
      </p>
      <p className="desc">
        引擎状态：{readEnginePhase() === 'installed' ? '已下载' : '未下载'}
        {progress ? ` · ${engineProgressLabel(progress)}` : ''}
      </p>
      {ready && (
        <div className="tts-actions">
          <Button
            size="sm"
            onClick={() => {
              if (!window.confirm(engineDownloadLabel())) return;
              setProgress(null);
              void downloadDesktopEngine(setProgress).then((error) => {
                setProgress(null);
                toast(error ?? '引擎已下载');
              });
            }}
          >
            下载引擎
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void deleteInstalledEngine().then(() => toast('已删除朗读引擎'));
            }}
          >
            删除引擎
          </Button>
        </div>
      )}

      <PronunciationTable toast={toast} />

      <h3>音色</h3>
      <VoiceLibrary
        voices={voices}
        builtinHidden={builtinHidden}
        usedVoices={voices.length + builtinSlots}
        onImport={async (pack) => {
          const blocked = gate();
          if (blocked) {
            toast(blocked);
            throw new Error(blocked);
          }
          try {
            await saveVoice({
              name: pack.name,
              refText: pack.refText,
              refAudio: pack.wav,
              lang: pack.lang,
              origin: 'import',
            });
            setVoices(await listVoices());
            toast(`已导入「${pack.name}」`);
          } catch (error: unknown) {
            toast(error instanceof Error ? error.message : '导入失败');
            throw error;
          }
        }}
        onRename={(voice) => {
          const next = window.prompt('音色名称', voice.name);
          if (!next) return;
          void renameVoice(voice.id, next).then(async () => setVoices(await listVoices()));
        }}
        onRemove={(voice) => {
          void removeStoredVoice(voice).then(async (message) => {
            if (message) {
              toast(message);
              return;
            }
            if (readReadingPrefs().voiceId === voice.id) writeReadingPrefs({ voiceId: 'auto' });
            setVoices(await listVoices());
            await refreshProfile();
          });
        }}
        onHideBuiltin={hideBuiltin}
        onRestoreBuiltin={restoreBuiltin}
      />
      <VoiceSponsor loggedIn={profile != null} username={profile?.username ?? ''} toast={toast} />
    </>
  );
}

function VoiceLibrary({
  voices,
  builtinHidden,
  usedVoices,
  onImport,
  onRename,
  onRemove,
  onHideBuiltin,
  onRestoreBuiltin,
}: {
  voices: VoicePack[];
  builtinHidden: boolean;
  usedVoices: number;
  onImport: (pack: ParsedVoicePack) => Promise<void>;
  onRename: (voice: VoicePack) => void;
  onRemove: (voice: VoicePack) => void;
  onHideBuiltin: () => void;
  onRestoreBuiltin: () => void;
}) {
  return (
    <>
      <p className="desc">
        最多保留 {usedVoices}/{VOICE_KEEP_LIMIT} 个。删掉一个就可以再加。
      </p>
      <VoiceList
        voices={voices}
        builtinHidden={builtinHidden}
        onRename={(id) => {
          const voice = voices.find((item) => item.id === id);
          if (voice) onRename(voice);
        }}
        onRemove={(id) => {
          const voice = voices.find((item) => item.id === id);
          if (voice) onRemove(voice);
        }}
        onHideBuiltin={onHideBuiltin}
        onRestoreBuiltin={onRestoreBuiltin}
      />
      <VoiceRecord onImport={onImport} />
      <VoiceImport onImport={onImport} />
    </>
  );
}

function VoiceImport({ onImport }: { onImport: (pack: ParsedVoicePack) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<ParsedVoicePack | null>(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const choose = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    try {
      setPicked(await readVoicePack([...list].map(voicePackSource)));
      setProblem('');
    } catch (error: unknown) {
      setPicked(null);
      setProblem(error instanceof Error ? error.message : '这个文件夹读不出来');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <details className="voice-import">
      <summary>已有 wav 文件</summary>
      <p className="desc">
        放进一个文件夹再选择导入。名称用文件夹名，这段声音对应的文字写在 voice.txt，UTF-8。
      </p>
      <pre className="voice-import-tree">{'妈妈/\n  voice.wav\n  voice.txt'}</pre>
      <p className="desc">voice.wav 用 16-bit，单声道或双声道，5 到 15 秒，不超过 3 MB。</p>
      <div className="tts-actions">
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          选择文件夹
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!picked || saving}
          onClick={() => {
            if (!picked || saving) return;
            setSaving(true);
            void onImport(picked)
              .then(() => {
                setPicked(null);
                setProblem('');
              })
              .catch(() => undefined)
              .finally(() => setSaving(false));
          }}
        >
          导入
        </Button>
      </div>
      <input
        ref={inputRef}
        className="voice-import-file"
        type="file"
        multiple
        accept=".wav,.txt,.json,audio/wav,text/plain,application/json"
        onChange={(event) => void choose(event.target.files)}
      />
      {picked ? (
        <>
          <p className="voice-import-picked">将导入</p>
          <p className="voice-import-name">{picked.name}</p>
          <p className="voice-import-text">{picked.refText}</p>
        </>
      ) : null}
      {problem ? <p className="voice-import-error">{problem}</p> : null}
    </details>
  );
}

async function removeStoredVoice(voice: VoicePack): Promise<string | null> {
  if (voice.remoteId) {
    const remote = await accountSession.client().deleteVoice(voice.remoteId);
    if (!remote.ok) return remote.message || '服务器上的音色还没删掉';
  }
  await removeVoice(voice.id);
  return null;
}
