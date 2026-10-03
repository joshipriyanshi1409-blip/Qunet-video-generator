import { LIVE_AUDIO_FORMAT, LIVE_PCM_BYTES_PER_SAMPLE } from '@creatordna/shared';
import { PcmResampler, floatToPcm16, pcmToBase64, rmsLevel } from './pcm';
import { PCM_WORKLET_NAME, pcmWorkletUrl } from './pcmWorklet';

/**
 * Microphone capture for the Live Voice Coach.
 *
 * getUserMedia -> AudioWorklet -> resample to 16 kHz -> 16-bit PCM -> base64.
 * Every failure the browser can produce here is mapped to a sentence a creator
 * can act on, because "the coach did not start" with no reason is the single
 * most common support question a feature like this generates.
 */

/**
 * Target size of one WebSocket message, in PCM bytes.
 *
 * 100 ms of 16 kHz 16-bit mono audio: small enough that a tip still feels live,
 * large enough that the socket is not carrying hundreds of frames a second.
 */
const CHUNK_TARGET_BYTES = 3_200;

/** Why the microphone could not be used. */
export type MicFailure =
  | 'permission-denied'
  | 'no-microphone'
  | 'insecure-context'
  | 'worklet-unsupported'
  | 'unknown';

export interface MicError extends Error {
  readonly failure: MicFailure;
}

const MESSAGES: Readonly<Record<MicFailure, string>> = {
  'permission-denied':
    'The coach needs your microphone. Allow it in your browser, then start again.',
  'no-microphone': 'No microphone was found. Connect one and start again.',
  'insecure-context':
    'Microphone access needs a secure connection. Use https or localhost.',
  'worklet-unsupported':
    'This browser cannot stream audio in real time. Use the record-and-review option instead.',
  unknown: 'The microphone could not be started. Check your browser settings and try again.',
};

/** Maps a `getUserMedia` rejection onto a creator-facing failure. */
export function classifyMicError(error: unknown): MicError {
  const failure = classify(error);
  const message = error instanceof Error && error.message.length > 0 ? error.message : MESSAGES[failure];
  return Object.assign(new Error(message), { failure, name: 'MicError' });
}

function classify(error: unknown): MicFailure {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const name = 'name' in error ? String(error.name) : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-microphone';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'no-microphone';
  if (name === 'SecurityError') return 'insecure-context';
  if (name === 'OverconstrainedError') return 'no-microphone';
  return 'unknown';
}

export interface MicChunk {
  /** Base64 PCM at 16 kHz, ready to put on the wire. */
  readonly data: string;
  /** Bytes of raw PCM this chunk represents. */
  readonly bytes: number;
}

export interface MicRecorderOptions {
  /** Called for every chunk of 16 kHz PCM, as it is produced. */
  onChunk(chunk: MicChunk): void;
  /** Called with the frame's 0..1 loudness, for the live waveform. */
  onLevel(level: number): void;
}

export interface MicRecorder {
  /** Stops capturing and returns the whole take as raw PCM bytes. */
  stop(): Promise<Uint8Array>;
  /** Seconds of audio captured so far. */
  readonly seconds: number;
  /** Bytes captured so far. */
  readonly bytes: number;
}

/** True when this browser can stream audio at all. */
export function canStreamAudio(): boolean {
  const secure =
    typeof window === 'undefined' ||
    window.isSecureContext === true ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  return (
    secure &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorklet !== 'undefined'
  );
}

/**
 * Opens the microphone and starts producing PCM chunks.
 *
 * Rejects with a `MicError` carrying a `failure` the UI can branch on, so a
 * denied permission and an unsupported browser get different messages.
 */
export async function createMicRecorder(options: MicRecorderOptions): Promise<MicRecorder> {
  if (canStreamAudio() === false) {
    throw new MicFailureError('worklet-unsupported');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Echo cancellation and noise suppression are what make a laptop mic
        // usable for speech; autoGainControl keeps the level steady enough for
        // the energy coach to mean something.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: LIVE_AUDIO_FORMAT.channels,
      },
    });
  } catch (error) {
    throw classifyMicError(error);
  }

  const context = new AudioContext({ sampleRate: undefined });
  // A context created outside a user gesture can start suspended; without this
  // the worklet never runs and the session looks dead.
  if (context.state === 'suspended') await context.resume();

  let source: MediaStreamAudioSourceNode;
  try {
    source = context.createMediaStreamSource(stream);
  } catch (error) {
    await closeContext(context);
    stopStream(stream);
    throw classifyMicError(error);
  }

  let workletUrl: string | null = null;
  try {
    workletUrl = pcmWorkletUrl();
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    await closeContext(context);
    stopStream(stream);
    throw classifyMicError(error);
  }

  const resampler = new PcmResampler(context.sampleRate, LIVE_AUDIO_FORMAT.sampleRate);
  const node = new AudioWorkletNode(context, PCM_WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    // The worklet only forwards frames; no output is needed, and processing
    // zero channels would stop it from being scheduled at all.
    outputChannelCount: [1],
  });

  /** Everything captured, kept whole for the record-and-review fallback. */
  const take: Uint8Array[] = [];
  let takeBytes = 0;
  let pending: Int16Array[] = [];
  let pendingBytes = 0;
  const startedAtMs = Date.now();

  node.port.onmessage = (event: MessageEvent<{ frame?: Float32Array }>) => {
    const frame = event.data?.frame;
    if (frame === undefined) return;

    options.onLevel(rmsLevel(frame));

    const resampled = resampler.process(frame);
    if (resampled.length === 0) return;

    const pcm = floatToPcm16(resampled);
    pending.push(pcm);
    pendingBytes += pcm.byteLength;

    // Flush once there is a chunk's worth: fewer, bigger messages keep the
    // socket quiet and the per-message overhead off the critical path.
    if (pendingBytes < CHUNK_TARGET_BYTES) return;

    const chunk = concatInt16(pending);
    pending = [];
    pendingBytes = 0;

    take.push(new Uint8Array(chunk.buffer.slice(0)));
    takeBytes += chunk.byteLength;

    options.onChunk({ data: pcmToBase64(chunk), bytes: chunk.byteLength });
  };

  source.connect(node);
  // A silent gain stage to the destination. The worklet writes nothing to its
  // output, so nothing is audible, but the connection keeps the node scheduled -
  // a worklet nobody listens to is not guaranteed to run.
  const silentSink = context.createGain();
  silentSink.gain.value = 0;
  node.connect(silentSink);
  silentSink.connect(context.destination);

  return {
    get seconds() {
      return (Date.now() - startedAtMs) / 1000;
    },
    get bytes() {
      return takeBytes;
    },
    async stop() {
      node.port.onmessage = null;
      node.disconnect();
      silentSink.disconnect();
      source.disconnect();
      stopStream(stream);
      await closeContext(context);
      URL.revokeObjectURL(workletUrl ?? '');

      const total = new Uint8Array(takeBytes);
      let offset = 0;
      for (const part of take) {
        total.set(part, offset);
        offset += part.byteLength;
      }
      return total;
    },
  };
}

/** Bytes of PCM for `seconds` of audio, for size warnings before a send. */
export function pcmBytesFor(seconds: number): number {
  return Math.round(seconds * LIVE_AUDIO_FORMAT.sampleRate * LIVE_PCM_BYTES_PER_SAMPLE);
}

function concatInt16(parts: readonly Int16Array[]): Int16Array {
  if (parts.length === 1) return parts[0] ?? new Int16Array(0);
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Int16Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

async function closeContext(context: AudioContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // A context that will not close is not worth failing the session over.
  }
}

/** `MicError` raised from a known failure kind. */
export class MicFailureError extends Error implements MicError {
  readonly failure: MicFailure;

  constructor(failure: MicFailure, message?: string) {
    super(message ?? MESSAGES[failure]);
    this.name = 'MicError';
    this.failure = failure;
  }
}
