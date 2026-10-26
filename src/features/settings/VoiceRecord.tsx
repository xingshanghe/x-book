import { useEffect, useRef, useState } from 'react';
import {
  type MicSession,
  micErrorMessage,
  openMicSession,
  packFromMic,
  RECORD_MAX_SECONDS,
  RECORD_SCRIPT,
} from '@/tts/micCapture';
import type { ParsedVoicePack } from '@/tts/voicePack';
import { Button } from '@/ui';

/** 对着麦克风读一段固定的话。软件写成 16-bit，名称可以改。 */
export function VoiceRecord({ onImport }: { onImport: (pack: ParsedVoicePack) => Promise<void> }) {
  const [name, setName] = useState('我的声音');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const sessionRef = useRef<MicSession | null>(null);
  const draftRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const finishRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current?.close();
      sessionRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      const elapsed = session.elapsed();
      setSeconds(elapsed);
      if (elapsed >= RECORD_MAX_SECONDS) finishRef.current();
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  const replacePreview = (url: string) => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
  };

  const finish = () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const samples = session.close();
    setSeconds(samples.length / session.sampleRate);
    try {
      const pack = packFromMic({ name: '音色', samples, sampleRate: session.sampleRate });
      draftRef.current = { samples, sampleRate: session.sampleRate };
      replacePreview(URL.createObjectURL(pack.wav));
      setProblem('');
      setPhase('ready');
    } catch (error: unknown) {
      draftRef.current = null;
      replacePreview('');
      setProblem(error instanceof Error ? error.message : '这段录音不能用');
      setPhase('idle');
    }
  };
  finishRef.current = finish;

  const start = () => {
    const ticket = generation.current + 1;
    generation.current = ticket;
    sessionRef.current?.close();
    sessionRef.current = null;
    draftRef.current = null;
    replacePreview('');
    setProblem('');
    setSeconds(0);
    setPhase('recording');
    void openMicSession()
      .then((session) => {
        if (!mounted.current || generation.current !== ticket) {
          session.close();
          return;
        }
        sessionRef.current = session;
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setPhase('idle');
        setProblem(micErrorMessage(error));
      });
  };

  const stop = () => {
    generation.current += 1;
    if (sessionRef.current) finish();
    else setPhase('idle');
  };

  const play = () => {
    if (!previewUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    void audio.play().catch(() => setProblem('这段录音播不出来'));
  };

  const save = () => {
    const draft = draftRef.current;
    if (!draft || saving) return;
    let pack: ParsedVoicePack;
    try {
      pack = packFromMic({ name, samples: draft.samples, sampleRate: draft.sampleRate });
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : '这段录音不能用');
      return;
    }
    setSaving(true);
    void onImport(pack)
      .then(() => {
        draftRef.current = null;
        replacePreview('');
        setSeconds(0);
        setProblem('');
        setPhase('idle');
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  return (
    <div className="voice-record">
      <h3>录一段声音</h3>
      <p className="desc">
        对着麦克风把下面这段话读完，读满 5 秒再停，最长 15 秒。软件会录成
        16-bit，不用自己调录音格式。录音只保存在这台设备上。
      </p>
      <p className="desc">引擎示例（雷军）已经能直接朗读，不用下载成文件夹再导入。</p>
      <p className="voice-record-script">{RECORD_SCRIPT}</p>
      <label className="voice-record-name">
        名称
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="tts-actions">
        {phase === 'recording' ? (
          <Button size="sm" onClick={stop}>
            停止
          </Button>
        ) : (
          <Button size="sm" disabled={saving} onClick={start}>
            {phase === 'ready' ? '重新录' : '开始录音'}
          </Button>
        )}
        <Button size="sm" disabled={!previewUrl} onClick={play}>
          试听
        </Button>
        <Button size="sm" variant="primary" disabled={phase !== 'ready' || saving} onClick={save}>
          保存
        </Button>
      </div>
      <p className="voice-record-time">已录 {seconds.toFixed(1)} 秒，需要 5 到 15 秒</p>
      {problem ? <p className="voice-import-error">{problem}</p> : null}
    </div>
  );
}
