import { useEffect, useState } from 'react';
import { splitSentences } from '@/core/text/sentences';
import { listVoices } from '@/storage/voiceStore';
import {
  cancelEngineDownload,
  deleteInstalledEngine,
  downloadDesktopEngine,
  engineDownloadLabel,
  engineProgressLabel,
  readEnginePhase,
  speakSentence,
  type EngineProgress,
} from '@/tts/engine';
import { ENGINE_LICENSE_NOTE } from '@/tts/manifest';
import { playWavBytes } from '@/tts/playback';
import { createSentencePlayer, type SentencePlayer } from '@/tts/player';
import { desktopReadingReady } from '@/tts/support';
import type { PlayerSnapshot } from '@/tts/types';
import { Button } from '@/ui';

/** 阅读页朗读条。只在用户点过「朗读」后才会被加载。 */
export function ReadAloud({ passage, onClose }: { passage: string; onClose: () => void }) {
  const [phase, setPhase] = useState(readEnginePhase());
  const [note, setNote] = useState<string | null>(desktopReadingReady() ? null : '朗读即将支持');
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [player, setPlayer] = useState<SentencePlayer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<EngineProgress | null>(null);

  useEffect(() => {
    const sentence = snapshot?.sentence;
    for (const el of document.querySelectorAll('.tts-current')) el.classList.remove('tts-current');
    if (!sentence) return;
    const root = document.querySelector('.paged-flow') ?? document.querySelector('.reader-content');
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.textContent ?? '';
      if (value.includes(sentence) && node.parentElement) {
        node.parentElement.classList.add('tts-current');
        break;
      }
      node = walker.nextNode();
    }
  }, [snapshot?.sentence]);

  const start = async () => {
    if (!desktopReadingReady()) {
      setNote('朗读即将支持');
      return;
    }
    if (readEnginePhase() !== 'installed') {
      setConfirming(true);
      return;
    }
    const sentences = splitSentences(passage).slice(0, 40);
    if (sentences.length === 0) {
      setNote('这一屏没有可以朗读的句子');
      return;
    }
    const voices = await listVoices();
    const chosen = voices[voices.length - 1];
    const next = createSentencePlayer({
      sentences,
      synth: (sentence) => speakSentence(sentence, chosen ?? 'builtin'),
      play: (audio) => playWavBytes(audio),
      onChange: setSnapshot,
    });
    setPlayer(next);
    setNote(null);
    await next.start();
    setPlayer(null);
  };

  return (
    <section className="tts-panel" aria-label="朗读">
      <p>{snapshot?.sentence || '从当前这一屏开始朗读。'}</p>
      {snapshot?.gapNote && <p className="tts-note">{snapshot.gapNote}</p>}
      {note && <p className="tts-note">{note}</p>}
      {confirming && !downloading && (
        <p className="tts-note">
          {engineDownloadLabel()} {ENGINE_LICENSE_NOTE}
        </p>
      )}
      {downloading && progress && (
        <div className="tts-progress-wrap">
          <p className="tts-note">{engineProgressLabel(progress)}，中断后可以继续</p>
          <div className="tts-progress" aria-valuenow={progressPercent(progress)} aria-valuemin={0} aria-valuemax={100} role="progressbar">
            <span style={{ width: `${progressPercent(progress)}%` }} />
          </div>
        </div>
      )}
      <div className="tts-actions">
        {confirming ? (
          <>
            <Button
              size="sm"
              disabled={downloading}
              onClick={() => {
                setDownloading(true);
                setProgress(null);
                void downloadDesktopEngine(setProgress).then((error) => {
                  setDownloading(false);
                  setPhase(readEnginePhase());
                  setConfirming(false);
                  setNote(error);
                });
              }}
            >
              {downloading ? '下载中' : '开始下载'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (downloading) {
                  void cancelEngineDownload();
                  return;
                }
                setConfirming(false);
              }}
            >
              取消
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => void start()}>
              {player ? '朗读中' : '开始'}
            </Button>
            <Button size="sm" onClick={() => player?.pause()} disabled={!player}>
              暂停
            </Button>
            <Button
              size="sm"
              onClick={() => {
                player?.stop();
                setPlayer(null);
              }}
            >
              停止
            </Button>
            {phase === 'installed' && (
              <Button
                size="sm"
                onClick={() => {
                  void deleteInstalledEngine().then(() => setPhase('absent'));
                }}
              >
                删除引擎
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              关闭
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function progressPercent(progress: EngineProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}
