/** 用麦克风录一段对齐文本，并写成 16-bit 单声道 wav。 */

import { sharedAudioContext } from './playback';
import type { ParsedVoicePack } from './voicePack';
import { VOICE_PACK_MAX_BYTES } from './voicePack';
import { encodeWavPcm16, mixToMono } from './wav';

export const RECORD_MIN_SECONDS = 5;
export const RECORD_MAX_SECONDS = 15;

/** 读完大约 8 到 12 秒。整段录音就是对齐文本。 */
export const RECORD_SCRIPT =
  '今晚的风从江面过来，路灯一盏盏亮着。我把今天的书读完，关上灯，就回家了。';

export interface MicSession {
  sampleRate: number;
  elapsed: () => number;
  close: () => Float32Array;
}

export function packFromMic(input: {
  name: string;
  samples: Float32Array;
  sampleRate: number;
}): ParsedVoicePack {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error('请填写音色名称');
  const samples = takeRecording(input.samples, input.sampleRate);
  return {
    name,
    refText: RECORD_SCRIPT,
    lang: 'zh',
    wav: encodeWavPcm16(samples, input.sampleRate),
  };
}

export function micErrorMessage(error: unknown): string {
  const name = errorName(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '没有麦克风权限。请在系统设置里允许轻阅使用麦克风，然后再录。';
  }
  if (name === 'NotFoundError') return '没有找到麦克风';
  if (error instanceof Error && error.message) return error.message;
  return '麦克风打不开';
}

/** 点「开始录音」才申请麦克风。录满 15 秒后不再收下一段。 */
export async function openMicSession(): Promise<MicSession> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error('当前环境不能使用麦克风');
  const stream = await media.getUserMedia({
    audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = sharedAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  let total = 0;
  let closed = false;
  const maxSamples = Math.floor(ctx.sampleRate * RECORD_MAX_SECONDS);

  processor.onaudioprocess = (event) => {
    if (closed || total >= maxSamples) return;
    event.outputBuffer.getChannelData(0).fill(0);
    const frame = copyFrame(event.inputBuffer);
    const room = maxSamples - total;
    const slice = frame.length > room ? frame.subarray(0, room) : frame;
    chunks.push(slice.length === frame.length ? slice : new Float32Array(slice));
    total += slice.length;
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,
    elapsed: () => total / ctx.sampleRate,
    close: () => {
      if (closed) return concat(chunks, total);
      closed = true;
      processor.onaudioprocess = null;
      for (const track of stream.getTracks()) track.stop();
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      // 不要 ctx.close()。关掉之后，这一页后面的朗读会没有声音。
      return concat(chunks, total);
    },
  };
}

function takeRecording(samples: Float32Array, sampleRate: number): Float32Array {
  if (!(sampleRate > 0) || samples.length === 0) throw new Error('没有录到声音');
  const maxSamples = Math.floor(sampleRate * RECORD_MAX_SECONDS);
  const taken = samples.length > maxSamples ? samples.slice(0, maxSamples) : samples;
  const duration = taken.length / sampleRate;
  if (duration < RECORD_MIN_SECONDS) throw new Error('声音需要在 5 到 15 秒');
  if (44 + taken.length * 2 > VOICE_PACK_MAX_BYTES) throw new Error('wav 不超过 3 MB');
  return taken;
}

function copyFrame(buffer: AudioBuffer): Float32Array {
  const channels: Float32Array[] = [];
  for (let index = 0; index < buffer.numberOfChannels; index += 1) {
    channels.push(new Float32Array(buffer.getChannelData(index)));
  }
  return mixToMono(channels);
}

function concat(chunks: readonly Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return '';
}
