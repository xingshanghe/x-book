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
import { enrollBlockReason, GUIDE_TEXT } from '@/tts/enroll';
import { readReadingPrefs, writeReadingPrefs } from '@/tts/prefs';
import { desktopReadingReady } from '@/tts/support';
import type { VoicePack } from '@/tts/types';
import { encodeWavPcm16, mixToMono } from '@/tts/wav';
import { Button } from '@/ui';
import { useAccountProfile } from './useAccountProfile';
import { VoiceList } from './VoiceList';
import { VoiceSponsor } from './VoiceSponsor';

export function ReadingAloudSection({ toast }: { toast: (text: string) => void }) {
  const profile = useAccountProfile();
  const [voices, setVoices] = useState<VoicePack[]>([]);
  const [builtinHidden, setBuiltinHidden] = useState(() => readBuiltinHidden());
  const [voiceName, setVoiceName] = useState('');
  const [refText, setRefText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [sample, setSample] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedRef = useRef(0);
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

  const storeEnrolled = async (audio: Blob, transcript: string) => {
    const blocked = gate();
    if (blocked) {
      toast(blocked);
      return;
    }
    const result = await accountSession.client().enroll(audio, transcript);
    if (!result.ok || !result.data) {
      toast(result.message);
      return;
    }
    await saveVoice({
      name: voiceName || '我的音色',
      refText: result.data.refText,
      refAudio: audio,
      origin: 'enrolled',
      consentAt: Date.now(),
      remoteId: result.data.id,
    });
    setVoices(await listVoices());
    await refreshProfile();
    toast('建档完成，已保存在本机');
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

      <h3>音色</h3>
      {!profile && (
        <p className="desc">建档需要先在上面的账号里登录。未登录时，已在本机的音色仍可朗读。</p>
      )}
      <VoiceLibrary
        voices={voices}
        voiceName={voiceName}
        refText={refText}
        consent={consent}
        recording={recording}
        profileReady={profile != null}
        setVoiceName={setVoiceName}
        setRefText={setRefText}
        setFile={setFile}
        setConsent={setConsent}
        onImport={() => {
          const blocked = gate();
          if (blocked || !file) {
            toast(blocked ?? '请选择 wav');
            return;
          }
          void saveVoice({ name: voiceName, refText, refAudio: file, origin: 'import' })
            .then(async () => {
              setVoices(await listVoices());
              toast('已导入音色');
            })
            .catch((error: unknown) => toast(error instanceof Error ? error.message : '导入失败'));
        }}
        onEnrollFile={() => {
          if (!file) {
            toast('请选择 wav');
            return;
          }
          if (!consent) {
            toast('请先确认已获授权');
            return;
          }
          void storeEnrolled(file, refText);
        }}
        onToggleRecord={() => {
          void toggleRecord(
            recorderRef,
            startedRef,
            recording,
            setRecording,
            setDurationMs,
            setSample,
            toast,
          );
        }}
        onSubmitSample={() => {
          const reason = enrollBlockReason({
            loggedIn: profile != null,
            consent,
            durationMs,
          });
          if (reason || !sample) {
            toast(reason ?? '请先完成试读');
            return;
          }
          void storeEnrolled(sample, GUIDE_TEXT);
        }}
        onRename={(voice) => {
          const next = window.prompt('音色名称', voice.name);
          if (!next) return;
          void renameVoice(voice.id, next).then(async () => setVoices(await listVoices()));
        }}
        onRemove={(voice) => {
          void removeStoredVoice(voice).then(async (message) => {
            if (message) toast(message);
            setVoices(await listVoices());
            await refreshProfile();
          });
        }}
        builtinHidden={builtinHidden}
        usedVoices={voices.length + builtinSlots}
        onHideBuiltin={hideBuiltin}
        onRestoreBuiltin={restoreBuiltin}
      />
      <VoiceSponsor loggedIn={profile != null} username={profile?.username ?? ''} toast={toast} />
    </>
  );
}

function VoiceLibrary({
  voices,
  voiceName,
  refText,
  consent,
  recording,
  profileReady,
  setVoiceName,
  setRefText,
  setFile,
  setConsent,
  onImport,
  onEnrollFile,
  onToggleRecord,
  onSubmitSample,
  onRename,
  onRemove,
  builtinHidden,
  usedVoices,
  onHideBuiltin,
  onRestoreBuiltin,
}: {
  voices: VoicePack[];
  voiceName: string;
  refText: string;
  consent: boolean;
  recording: boolean;
  profileReady: boolean;
  setVoiceName: (value: string) => void;
  setRefText: (value: string) => void;
  setFile: (file: File | null) => void;
  setConsent: (value: boolean) => void;
  onImport: () => void;
  onEnrollFile: () => void;
  onToggleRecord: () => void;
  onSubmitSample: () => void;
  onRename: (voice: VoicePack) => void;
  onRemove: (voice: VoicePack) => void;
  builtinHidden: boolean;
  usedVoices: number;
  onHideBuiltin: () => void;
  onRestoreBuiltin: () => void;
}) {
  return (
    <>
      <p className="desc">
        最多保留 {usedVoices}/{VOICE_KEEP_LIMIT} 个。删掉一个就可以再加。
      </p>
      <p className="desc">提交请用 16-bit wav，单声道或双声道，5 到 15 秒，不超过 3 MB。</p>
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
      <h3>导入音色包</h3>
      <label className="qy-row">
        <span className="qy-row-label">名称</span>
        <input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} />
      </label>
      <label className="qy-row">
        <span className="qy-row-label">对齐文本</span>
        <textarea value={refText} onChange={(event) => setRefText(event.target.value)} rows={3} />
      </label>
      <input
        type="file"
        accept="audio/wav,audio/wave,.wav"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <Button size="sm" onClick={onImport}>
        导入
      </Button>
      <Button size="sm" disabled={!consent || !profileReady} onClick={onEnrollFile}>
        用这个文件建档
      </Button>

      <h3>试读建档</h3>
      <p className="desc">{GUIDE_TEXT}</p>
      <label className="qy-row">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>我是本人，或已获得声音主人的授权。音频只用于这一次加工。</span>
      </label>
      <div className="tts-actions">
        <Button size="sm" onClick={onToggleRecord}>
          {recording ? '停止试读' : '开始试读'}
        </Button>
        <Button size="sm" disabled={!consent || !profileReady} onClick={onSubmitSample}>
          提交建档
        </Button>
      </div>
    </>
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

async function toggleRecord(
  recorderRef: { current: MediaRecorder | null },
  startedRef: { current: number },
  recording: boolean,
  setRecording: (value: boolean) => void,
  setDurationMs: (value: number) => void,
  setSample: (blob: Blob | null) => void,
  toast: (text: string) => void,
): Promise<void> {
  if (recording && recorderRef.current) {
    recorderRef.current.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('当前环境不能录音');
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    for (const track of stream.getTracks()) track.stop();
    const elapsed = Date.now() - startedRef.current;
    setRecording(false);
    recorderRef.current = null;
    const recorded = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    void recorded
      .arrayBuffer()
      .then((raw) => new AudioContext().decodeAudioData(raw))
      .then((audio) => {
        const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
          audio.getChannelData(index),
        );
        const wav = encodeWavPcm16(mixToMono(channels), audio.sampleRate);
        setDurationMs(Math.round(audio.duration * 1000));
        setSample(wav);
        toast('试读已结束。请保持在 5 到 15 秒，并勾选授权、登录后再提交。');
      })
      .catch(() => {
        setDurationMs(elapsed);
        setSample(null);
        toast('这段录音转不成 wav，请改用上传 wav');
      });
  };
  recorderRef.current = recorder;
  startedRef.current = Date.now();
  setRecording(true);
  recorder.start();
}
