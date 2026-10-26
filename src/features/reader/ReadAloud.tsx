import { useEffect, useRef, useState } from 'react';
import type { BlockIndexView } from '@/core/reader/progress';
import { listVoices } from '@/storage/voiceStore';
import {
  cancelEngineDownload,
  deleteInstalledEngine,
  downloadDesktopEngine,
  type EngineProgress,
  engineDownloadLabel,
  engineProgressLabel,
  readEnginePhase,
  speakSentence,
} from '@/tts/engine';
import { playWavBytes, primePlayback } from '@/tts/playback';
import { createSentencePlayer, type SentencePlayer } from '@/tts/player';
import {
  pickReadingVoice,
  type ReadingPrefs,
  readReadingPrefs,
  writeReadingPrefs,
} from '@/tts/prefs';
import {
  clearReadMark,
  type ReadMark,
  readingOrigin,
  recallReadMark,
  rememberReadMark,
} from '@/tts/resume';
import {
  FIRST_WINDOW_BLOCKS,
  NEXT_WINDOW_BLOCKS,
  readSpokenScript,
  type SpokenSentence,
} from '@/tts/script';
import { desktopReadingReady } from '@/tts/support';
import type { PlayerSnapshot, VoicePack } from '@/tts/types';
import { Button, Slider } from '@/ui';

/** 阅读页朗读条。只在用户点过「朗读」后才会被加载。 */
export function ReadAloud({
  bookId,
  anchorChar,
  chapterOffsets,
  readPlace,
  index,
  readLines,
  onFollow,
  onClose,
}: {
  bookId: string;
  /** 当前屏幕上的字符位置。没有停读记录，或已经换了章节时，从这里开始。 */
  anchorChar: number;
  chapterOffsets: readonly number[];
  /** 读者点了目录、进度或书签。变了就不再续上停止的那一句。 */
  readPlace: number;
  index: BlockIndexView;
  readLines: (block: number) => Promise<string[]>;
  onFollow: (charOffset: number) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState(readEnginePhase());
  const [note, setNote] = useState<string | null>(desktopReadingReady() ? null : '朗读即将支持');
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [player, setPlayer] = useState<SentencePlayer | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [mark, setMark] = useState<ReadMark | null>(() => recallReadMark(bookId));
  const [seenPlace, setSeenPlace] = useState(readPlace);
  const [confirming, setConfirming] = useState(false);
  const [voices, setVoices] = useState<VoicePack[]>([]);
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => readReadingPrefs());
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const run = useRef(0);
  const playerRef = useRef<SentencePlayer | null>(null);
  const scriptRef = useRef<SpokenSentence[]>([]);
  const ahead = useRef<number | null>(null);
  const voicesRef = useRef<VoicePack[]>([]);
  const readLinesRef = useRef(readLines);
  const indexRef = useRef(index);
  const anchorRef = useRef(anchorChar);
  const onFollowRef = useRef(onFollow);
  /** 停下时屏幕上的位置。拿它和现在的位置比，才知道人有没有换章。 */
  const parkedRef = useRef<number | null>(null);
  const offsetsRef = useRef(chapterOffsets);
  const placeRef = useRef(readPlace);
  /** 刚换过章节时，别让还在跑的跟读把画面拉回去。 */
  const holdFollow = useRef(false);
  readLinesRef.current = readLines;
  indexRef.current = index;
  anchorRef.current = anchorChar;
  onFollowRef.current = onFollow;
  offsetsRef.current = chapterOffsets;
  if (readPlace !== seenPlace) {
    setSeenPlace(readPlace);
    holdFollow.current = true;
    if (mark) {
      clearReadMark(bookId);
      parkedRef.current = null;
      setMark(null);
    }
  } else if (parkedRef.current == null && mark) {
    parkedRef.current = mark.charOffset;
  }

  const spokenIndex = snapshot && snapshot.status !== 'idle' ? snapshot.index : -1;
  const parked = parkedRef.current ?? mark?.charOffset ?? anchorChar;
  const resumeMark =
    mark && readingOrigin(mark, anchorChar, chapterOffsets, parked) === mark.charOffset
      ? mark
      : null;

  useEffect(() => {
    if (preparing || player) return;
    if (!mark) return;
    const stayed = readingOrigin(
      mark,
      anchorChar,
      offsetsRef.current,
      parkedRef.current ?? mark.charOffset,
    );
    if (stayed === mark.charOffset) return;
    clearReadMark(bookId);
    parkedRef.current = null;
    setMark(null);
  }, [anchorChar, bookId, mark, player, preparing]);

  useEffect(() => {
    if (placeRef.current === readPlace) return;
    placeRef.current = readPlace;
    const current = playerRef.current;
    if (!current) return;
    run.current += 1;
    current.stop();
    playerRef.current = null;
    setPlayer(null);
    setPreparing(false);
    setSnapshot(null);
  }, [readPlace]);

  useEffect(() => {
    void listVoices()
      .then((items) => {
        voicesRef.current = items;
        setVoices(items);
      })
      .catch(() => setVoices([]));
  }, []);

  const changePrefs = (patch: Partial<ReadingPrefs>) => {
    const next = writeReadingPrefs(patch);
    setPrefs(next);
  };

  useEffect(() => {
    const item = spokenIndex >= 0 ? scriptRef.current[spokenIndex] : undefined;
    if (!item) {
      clearSpokenMark();
      return;
    }
    let seeked = false;
    const tick = () => {
      if (holdFollow.current) return;
      if (paintSpoken(item.charOffset)) return;
      if (seeked) return;
      seeked = true;
      onFollowRef.current(item.charOffset);
    };
    tick();
    const id = window.setInterval(tick, 350);
    return () => window.clearInterval(id);
  }, [spokenIndex]);

  useEffect(() => {
    return () => {
      run.current += 1;
      const current = playerRef.current;
      const item = scriptRef.current[current?.state.index ?? -1];
      if (current && item && current.state.status !== 'idle') {
        rememberReadMark(bookId, { charOffset: item.charOffset, sentence: item.text });
        parkedRef.current = anchorRef.current;
      }
      current?.stop();
      playerRef.current = null;
    };
  }, [bookId]);

  const keep = (item: SpokenSentence) => {
    const next = { charOffset: item.charOffset, sentence: item.text };
    rememberReadMark(bookId, next);
    parkedRef.current = anchorRef.current;
    setMark(next);
  };

  const dropMark = () => {
    clearReadMark(bookId);
    parkedRef.current = null;
    setMark(null);
  };

  const stopReading = () => {
    run.current += 1;
    const current = playerRef.current;
    const item = scriptRef.current[current?.state.index ?? -1];
    if (current && item && current.state.status !== 'idle') keep(item);
    current?.stop();
    playerRef.current = null;
    setPlayer(null);
    setPreparing(false);
  };

  const pullMore = async (session: number): Promise<readonly string[]> => {
    let from = ahead.current;
    for (let guard = 0; guard < 8 && from != null; guard++) {
      if (session !== run.current) return [];
      const window = await readSpokenScript(
        readLinesRef.current,
        indexRef.current,
        from,
        NEXT_WINDOW_BLOCKS,
      );
      if (session !== run.current) return [];
      if (window.nextChar != null && window.nextChar <= from) {
        ahead.current = null;
        return [];
      }
      ahead.current = window.nextChar;
      if (window.sentences.length > 0) {
        scriptRef.current = [...scriptRef.current, ...window.sentences];
        return window.sentences.map((item) => item.text);
      }
      from = window.nextChar;
    }
    return [];
  };

  const start = async () => {
    const ticket = ++run.current;
    holdFollow.current = false;
    const previous = playerRef.current;
    playerRef.current = null;
    previous?.stop();
    primePlayback();
    if (!desktopReadingReady()) {
      setNote('朗读即将支持');
      return;
    }
    if (readEnginePhase() !== 'installed') {
      setConfirming(true);
      return;
    }
    setPreparing(true);
    setNote(null);
    try {
      const saved = recallReadMark(bookId);
      const anchor = anchorRef.current;
      let from = readingOrigin(saved, anchor, offsetsRef.current, parkedRef.current ?? undefined);
      if (saved && from !== saved.charOffset) dropMark();
      let loaded = await readSpokenScript(
        readLinesRef.current,
        indexRef.current,
        from,
        FIRST_WINDOW_BLOCKS,
      );
      if (ticket !== run.current) return;
      if (loaded.sentences.length === 0 && saved && from !== anchor) {
        from = anchor;
        loaded = await readSpokenScript(
          readLinesRef.current,
          indexRef.current,
          from,
          FIRST_WINDOW_BLOCKS,
        );
        if (ticket !== run.current) return;
      }
      if (loaded.sentences.length === 0) {
        setNote('后面没有可以朗读的句子');
        dropMark();
        return;
      }
      const loadedVoices = await listVoices();
      if (ticket !== run.current) return;
      voicesRef.current = loadedVoices;
      setVoices(loadedVoices);
      scriptRef.current = loaded.sentences;
      ahead.current = loaded.nextChar;
      const next = createSentencePlayer({
        sentences: loaded.sentences.map((item) => item.text),
        synth: (sentence) => {
          const current = readReadingPrefs();
          const voiceId = pickReadingVoice(
            current.voiceId,
            voicesRef.current.map((voice) => voice.id),
          );
          const pack =
            voiceId === 'builtin'
              ? 'builtin'
              : (voicesRef.current.find((voice) => voice.id === voiceId) ?? 'builtin');
          return speakSentence(sentence, pack, { silenceScale: current.silenceScale });
        },
        play: (audio, signal) => playWavBytes(audio, signal, readReadingPrefs().speed),
        pauseAfter: (index) => {
          const current = readReadingPrefs();
          const item = scriptRef.current[index];
          return item?.paragraphEnd ? current.paragraphPauseMs : current.sentencePauseMs;
        },
        onChange: setSnapshot,
        pull: () => pullMore(ticket),
      });
      if (ticket !== run.current) return;
      playerRef.current = next;
      setPlayer(next);
      setPreparing(false);
      await next.start();
      if (ticket !== run.current) return;
      dropMark();
      scriptRef.current = [];
    } catch (error) {
      if (ticket !== run.current) return;
      const message = textOf(error);
      const item = scriptRef.current[playerRef.current?.state.index ?? -1];
      if (item && playerRef.current && playerRef.current.state.status !== 'idle') keep(item);
      setSnapshot(null);
      setNote(message);
      if (message.includes('sherpa-onnx-offline-tts')) setConfirming(true);
    } finally {
      if (ticket === run.current) {
        playerRef.current = null;
        setPlayer(null);
        setPreparing(false);
      }
    }
  };

  const active = preparing || player != null;
  const paused = snapshot?.status === 'paused';
  const lead = snapshot?.sentence || resumeMark?.sentence || '从当前这一屏开始，会一直往下读。';

  return (
    <section className="tts-panel" aria-label="朗读">
      <p>{lead}</p>
      {snapshot?.gapNote && <p className="tts-note">{snapshot.gapNote}</p>}
      {!snapshot?.sentence && resumeMark && <p className="tts-note">点继续，从这句重新读。</p>}
      {!snapshot?.sentence && !resumeMark && !note && (
        <p className="tts-note">不会在段末停下，只有停止才会停。</p>
      )}
      {note && <p className="tts-note">{note}</p>}
      {!confirming && (
        <details className="tts-prefs">
          <summary>朗读设置</summary>
          <p className="tts-note">修改从后面的句子生效。换气和段末停顿留出来，听起来会更接近人读。</p>
          <label className="tts-voice">
            <span>音色</span>
            <select
              value={prefs.voiceId}
              onChange={(event) => changePrefs({ voiceId: event.target.value })}
            >
              <option value="auto">自动（优先最近的音色）</option>
              <option value="builtin">引擎示例（雷军）</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="语速"
            min={0.85}
            max={1.15}
            step={0.05}
            value={prefs.speed}
            format={(value) => `${value.toFixed(2)}×`}
            onChange={(speed) => changePrefs({ speed })}
          />
          <Slider
            label="句间"
            min={80}
            max={800}
            step={20}
            value={prefs.sentencePauseMs}
            format={(value) => `${value} ms`}
            onChange={(sentencePauseMs) => changePrefs({ sentencePauseMs })}
          />
          <Slider
            label="段间"
            min={160}
            max={1200}
            step={20}
            value={prefs.paragraphPauseMs}
            format={(value) => `${value} ms`}
            onChange={(paragraphPauseMs) => changePrefs({ paragraphPauseMs })}
          />
          <Slider
            label="换气"
            min={0.4}
            max={1.6}
            step={0.1}
            value={prefs.silenceScale}
            format={(value) => value.toFixed(1)}
            onChange={(silenceScale) => changePrefs({ silenceScale })}
          />
        </details>
      )}
      {confirming && !downloading && <p className="tts-note">{engineDownloadLabel()}</p>}
      {downloading && (
        <div className="tts-progress-wrap">
          <p className="tts-note">
            {progress
              ? `${engineProgressLabel(progress)}，中断后可以继续`
              : '正在开始下载，中断后可以继续'}
          </p>
          <div
            className="tts-progress"
            aria-valuenow={progress ? progressPercent(progress) : 0}
            aria-valuemin={0}
            aria-valuemax={100}
            role="progressbar"
          >
            <span style={{ width: `${progress ? progressPercent(progress) : 0}%` }} />
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
            <Button size="sm" disabled={active} onClick={() => void start()}>
              {beginLabel(preparing, player != null, resumeMark)}
            </Button>
            {paused ? (
              <Button size="sm" onClick={() => player?.resume()}>
                继续
              </Button>
            ) : (
              <Button size="sm" onClick={() => player?.pause()} disabled={!player}>
                暂停
              </Button>
            )}
            <Button size="sm" onClick={stopReading} disabled={!active && !paused}>
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
            <Button
              size="sm"
              onClick={() => {
                stopReading();
                onClose();
              }}
            >
              关闭
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function beginLabel(preparing: boolean, playing: boolean, mark: ReadMark | null): string {
  if (preparing) return '准备中';
  if (playing) return '朗读中';
  if (mark) return '继续';
  return '开始';
}

function textOf(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return '这一句没有读出来';
}

function progressPercent(progress: EngineProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}

function clearSpokenMark(): void {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll('.tts-current')) el.classList.remove('tts-current');
}

/** 把当前句所在的行标出来。行不在视野里时返回 false，调用方再去翻页。 */
function paintSpoken(char: number): boolean {
  if (typeof document === 'undefined') return false;
  clearSpokenMark();
  const root = document.querySelector('.reader-main') ?? document.body;
  const lines = root.querySelectorAll<HTMLElement>('.qy-line[data-char]');
  let best = -1;
  const hits: HTMLElement[] = [];
  for (const line of lines) {
    const at = Number(line.dataset.char);
    if (!Number.isFinite(at) || at > char) continue;
    if (at > best) {
      best = at;
      hits.length = 0;
      hits.push(line);
    } else if (at === best) {
      hits.push(line);
    }
  }
  const visible = hits.filter((line) => inView(line));
  if (visible.length === 0) return false;
  for (const line of visible) line.classList.add('tts-current');
  return true;
}

function inView(line: HTMLElement): boolean {
  const frame =
    line.closest<HTMLElement>('.paged-col') ?? line.closest<HTMLElement>('.reader-scroll');
  if (!frame) return false;
  const rect = line.getBoundingClientRect();
  const bounds = frame.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) return false;
  const visibleHeight = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
  const visibleWidth = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left);
  return visibleHeight > 8 && visibleWidth > 8;
}
