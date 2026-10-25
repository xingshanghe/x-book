import { useEffect, useRef, useState } from 'react';
import { accountSession } from '@/account/session';
import { listVoices, removeVoice, renameVoice, saveVoice } from '@/storage/voiceStore';
import {
  type EngineProgress,
  deleteInstalledEngine,
  downloadDesktopEngine,
  engineDownloadLabel,
  engineProgressLabel,
  readEnginePhase,
} from '@/tts/engine';
import { enrollBlockReason, GUIDE_TEXT } from '@/tts/enroll';
import { desktopReadingReady } from '@/tts/support';
import type { VoicePack } from '@/tts/types';
import { encodeWavPcm16, mixToMono } from '@/tts/wav';
import { Button } from '@/ui';
import { useAccountProfile } from './useAccountProfile';

export function ReadingAloudSection({ toast }: { toast: (text: string) => void }) {
  const profile = useAccountProfile();
  const [voices, setVoices] = useState<VoicePack[]>([]);
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

      <p className="desc">
        {profile
          ? `${profile.username} · 剩余建档次数 ${profile.enrollCredits}`
          : '建档需要先在书架右上角的「账号」里登录。未登录时，已在本机的音色仍可朗读。'}
      </p>

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
      <Button
        size="sm"
        onClick={() => {
          if (!file) {
            toast('请选择 wav');
            return;
          }
          void saveVoice({ name: voiceName, refText, refAudio: file, origin: 'import' })
            .then(async () => {
              setVoices(await listVoices());
              toast('已导入音色');
            })
            .catch((error: unknown) => toast(error instanceof Error ? error.message : '导入失败'));
        }}
      >
        导入
      </Button>
      <Button
        size="sm"
        disabled={!consent || !profile}
        onClick={() => {
          if (!file) {
            toast('请选择 wav');
            return;
          }
          if (!consent || !profile) return;
          void accountSession
            .client()
            .enroll(file, refText)
            .then(async (result) => {
              if (!result.ok || !result.data) {
                toast(result.message);
                return;
              }
              await saveVoice({
                name: voiceName || '我的音色',
                refText: result.data.refText,
                refAudio: file,
                origin: 'enrolled',
                consentAt: Date.now(),
                remoteId: result.data.id,
              });
              setVoices(await listVoices());
              await refreshProfile();
              toast('建档完成，已保存在本机');
            });
        }}
      >
        用这个文件建档
      </Button>
      {voices.map((voice) => (
        <div className="rule-item" key={voice.id}>
          <b>{voice.name}</b>
          <Button
            size="sm"
            onClick={() => {
              const next = window.prompt('音色名称', voice.name);
              if (!next) return;
              void renameVoice(voice.id, next).then(async () => setVoices(await listVoices()));
            }}
          >
            改名
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void removeVoice(voice.id).then(async () => setVoices(await listVoices()));
            }}
          >
            删除
          </Button>
        </div>
      ))}

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
        <Button
          size="sm"
          onClick={() => {
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
        >
          {recording ? '停止试读' : '开始试读'}
        </Button>
        <Button
          size="sm"
          disabled={!consent || !profile}
          onClick={() => {
            const reason = enrollBlockReason({
              loggedIn: profile != null,
              consent,
              durationMs,
            });
            if (reason || !sample) {
              toast(reason ?? '请先完成试读');
              return;
            }
            void accountSession
              .client()
              .enroll(sample, GUIDE_TEXT)
              .then(async (result) => {
                if (!result.ok || !result.data) {
                  toast(result.message);
                  return;
                }
                await saveVoice({
                  name: voiceName || '我的音色',
                  refText: result.data.refText,
                  refAudio: sample,
                  origin: 'enrolled',
                  consentAt: Date.now(),
                  remoteId: result.data.id,
                });
                setVoices(await listVoices());
                await refreshProfile();
                toast('建档完成，已保存在本机');
              });
          }}
        >
          提交建档
        </Button>
      </div>
    </>
  );
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
