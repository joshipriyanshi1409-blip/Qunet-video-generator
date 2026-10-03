import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LIVE_DAILY_SESSION_CAP,
  LIVE_MAX_SESSION_SECONDS,
  LIVE_WS_CLOSE,
  type CoachTip,
  type LiveClientMessage,
  type LiveFeedbackResponse,
  type LiveQuotaResponse,
  type LiveSessionScript,
  type LiveSessionSummary,
} from '@creatordna/shared';
import {
  VoiceCoachSocket,
  fetchCoachQuota,
  submitFallbackTake,
} from '../lib/voiceCoachClient';
import { canStreamAudio, createMicRecorder, type MicError, type MicRecorder } from '../audio/recorder';
import { playPcmAudio } from '../audio/playback';

/**
 * One Live Voice Coach session, from the browser's side.
 *
 * The hook owns the state machine and nothing else: no markup, no styling. Two
 * ways to be coached live here -
 *
 *   live      - stream PCM over the socket, get tips while still talking.
 *   fallback  - record the whole take, send it once, read the notes after.
 *
 * The fallback is not an error path bolted on the side. It runs when the Live API
 * is unavailable, and it is also offered up front, because some creators would
 * rather do one clean take than be interrupted mid-sentence.
 */

export type CoachPhase = 'idle' | 'requesting-mic' | 'connecting' | 'live' | 'ending' | 'ended';

export type CoachFailureKind = 'mic' | 'socket' | 'server' | 'quota' | 'live-unavailable';

export interface CoachFailure {
  kind: CoachFailureKind;
  message: string;
}

export interface UseVoiceCoachSessionResult {
  phase: CoachPhase;
  /** Live tips, newest last. */
  tips: CoachTip[];
  /** Latest interim transcript, or a status line from the coach. */
  transcript: string;
  /** 0..1 microphone loudness, for the waveform. */
  level: number;
  /** Seconds elapsed in this session. */
  elapsedSeconds: number;
  /** Seconds left before the per-session maximum. */
  remainingSeconds: number;
  /** Line the creator is on, highlighted in the teleprompter. */
  currentLine: number;
  setCurrentLine(index: number): void;
  /** Sessions left today, or null before the quota is read. */
  quota: LiveQuotaResponse | null;
  /** Set when the session ended normally. */
  summary: LiveSessionSummary | null;
  /** Result of a record-and-review take. */
  fallback: LiveFeedbackResponse | null;
  /** True while a fallback take is being recorded. */
  recordingFallback: boolean;
  failure: CoachFailure | null;
  /** True when the live path is unavailable and the fallback should be offered. */
  offerFallback: boolean;
  /** Starts a live coaching session. */
  start(script: LiveSessionScript, projectId?: string): Promise<void>;
  /** Ends the session and asks for the summary. */
  stop(): Promise<void>;
  /** Starts recording a take for post-recording feedback. */
  startFallback(script: LiveSessionScript, projectId?: string): Promise<void>;
  /** Sends the recorded take for feedback. */
  submitFallback(script: LiveSessionScript, projectId?: string): Promise<void>;
  /** Clears everything and returns to idle. */
  reset(): void;
}

/** How long to wait for the API's summary before showing what we have. */
const WRAP_UP_GRACE_MS = 8000;

const TICK_MS = 250;

export function useVoiceCoachSession(): UseVoiceCoachSessionResult {
  const [phase, setPhase] = useState<CoachPhase>('idle');
  const [tips, setTips] = useState<CoachTip[]>([]);
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentLine, setCurrentLine] = useState(0);
  const [quota, setQuota] = useState<LiveQuotaResponse | null>(null);
  const [summary, setSummary] = useState<LiveSessionSummary | null>(null);
  const [fallback, setFallback] = useState<LiveFeedbackResponse | null>(null);
  const [recordingFallback, setRecordingFallback] = useState(false);
  const [failure, setFailure] = useState<CoachFailure | null>(null);
  const [offerFallback, setOfferFallback] = useState(false);

  const socketRef = useRef<VoiceCoachSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const startedAtRef = useRef(0);
  /** Resolved when the API's `ended` message lands, so `stop()` can await it. */
  const wrapUpRef = useRef<(() => void) | null>(null);

  /** Reads the daily allowance once, so the UI can say what is left. */
  useEffect(() => {
    let cancelled = false;
    void fetchCoachQuota()
      .then((value) => {
        if (!cancelled) setQuota(value);
      })
      .catch(() => {
        // Quota is a nicety, not a gate: the server enforces it on connect.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Frees everything on unmount, so navigating away never orphans a session. */
  useEffect(
    () => () => {
      socketRef.current?.dispose();
      socketRef.current = null;
      void recorderRef.current?.stop().catch(() => undefined);
      recorderRef.current = null;
    },
    [],
  );

  /** Session clock. */
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((Date.now() - startedAtRef.current) / 1000);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  const remainingSeconds = Math.max(0, LIVE_MAX_SESSION_SECONDS - elapsedSeconds);

  /** Releases the microphone. Safe to call twice. */
  const releaseMic = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder === null) return;
    void recorder.stop().catch(() => undefined);
  }, []);

  const fail = useCallback((kind: CoachFailureKind, message: string) => {
    setFailure({ kind, message });
  }, []);

  const start = useCallback(
    async (script: LiveSessionScript, projectId?: string): Promise<void> => {
      setFailure(null);
      setSummary(null);
      setFallback(null);
      setTips([]);
      setTranscript('');
      setElapsedSeconds(0);
      setCurrentLine(0);

      if (canStreamAudio() === false) {
        setOfferFallback(true);
        fail(
          'live-unavailable',
          'This browser cannot stream audio in real time. Record a take instead and read the notes afterwards.',
        );
        return;
      }

      setPhase('requesting-mic');

      let recorder: MicRecorder;
      try {
        recorder = await createMicRecorder({
          onChunk: (chunk) => {
            socketRef.current?.send({ type: 'audio', data: chunk.data });
          },
          onLevel: setLevel,
        });
      } catch (error) {
        releaseMic();
        setPhase('idle');
        fail('mic', (error as MicError).message);
        return;
      }

      recorderRef.current = recorder;
      setPhase('connecting');

      const socket = new VoiceCoachSocket({
        onMessage: (message) => {
          switch (message.type) {
            case 'ready':
              startedAtRef.current = Date.now();
              setPhase('live');
              break;

            case 'tip':
              setTips((current) => [...current, message.tip].slice(-50));
              break;

            case 'transcript':
              setTranscript(message.text);
              break;

            case 'audio':
              // Spoken feedback. Played, never rendered as text: the tip that
              // came with it is already in the feed for anyone who cannot hear.
              void playPcmAudio(message.data, message.mimeType);
              break;

            case 'warning':
              setTranscript(message.message);
              break;

            case 'ended':
              setSummary(message.summary);
              setPhase('ended');
              releaseMic();
              wrapUpRef.current?.();
              wrapUpRef.current = null;
              break;

            case 'error':
              fail('server', message.error.message);
              break;

            default:
              break;
          }
        },

        onClose: ({ code, willReconnect }) => {
          if (willReconnect) {
            setTranscript('Reconnecting…');
            return;
          }

          if (code === LIVE_WS_CLOSE.quota) {
            releaseMic();
            setPhase('idle');
            fail(
              'quota',
              `That is your ${LIVE_DAILY_SESSION_CAP} coaching sessions for today. Come back tomorrow.`,
            );
            return;
          }

          if (code === LIVE_WS_CLOSE.timeLimit) {
            setTranscript(`That was the ${LIVE_MAX_SESSION_SECONDS}-second maximum for one take.`);
            return;
          }

          if (code === LIVE_WS_CLOSE.liveUnavailable) {
            releaseMic();
            setOfferFallback(true);
            setPhase('idle');
            fail(
              'live-unavailable',
              'The live coach is unavailable right now. Record a take instead and read the notes afterwards.',
            );
            return;
          }

          // Any other close is a network drop the retries could not fix.
          releaseMic();
          setOfferFallback(true);
          setPhase('idle');
          fail('socket', 'The connection to the coach dropped. Record a take instead, or try again.');
        },
      });

      socketRef.current = socket;

      try {
        await socket.connect({ type: 'start', script, projectId });
      } catch {
        releaseMic();
        socketRef.current = null;
        setOfferFallback(true);
        setPhase('idle');
        fail('socket', 'The coach could not be reached. Record a take instead, or try again.');
      }
    },
    [fail, releaseMic],
  );

  /** Ends the session and waits for the summary. */
  const stop = useCallback(async (): Promise<void> => {
    const socket = socketRef.current;
    if (socket === null) return;

    setPhase('ending');
    socket.end();

    const landed = new Promise<void>((resolve) => {
      wrapUpRef.current = resolve;
      // A slow wrap-up must not hang the button forever.
      window.setTimeout(resolve, WRAP_UP_GRACE_MS);
    });

    await landed;
    setPhase((current) => (current === 'ending' ? 'ended' : current));
    releaseMic();
  }, [releaseMic]);

  /** Starts recording a take for post-recording feedback. */
  const startFallback = useCallback(
    async (script: LiveSessionScript, projectId?: string): Promise<void> => {
      void script;
      void projectId;
      setFailure(null);
      setSummary(null);
      setFallback(null);
      setTips([]);
      setTranscript('');
      setElapsedSeconds(0);
      setCurrentLine(0);

      if (canStreamAudio() === false) {
        fail('mic', 'Recording needs a microphone and a secure connection.');
        return;
      }

      setPhase('requesting-mic');

      let recorder: MicRecorder;
      try {
        recorder = await createMicRecorder({
          onChunk: () => {
            // Nothing is streamed: the whole take goes up in one request.
          },
          onLevel: setLevel,
        });
      } catch (error) {
        setPhase('idle');
        fail('mic', (error as MicError).message);
        return;
      }

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setPhase('live');
      setRecordingFallback(true);
    },
    [fail],
  );

  /** Sends the recorded take for feedback. */
  const submitFallback = useCallback(
    async (script: LiveSessionScript, projectId?: string): Promise<void> => {
      const recorder = recorderRef.current;
      if (recorder === null) return;

      setPhase('ending');
      setRecordingFallback(false);

      let pcm: Uint8Array;
      try {
        pcm = await recorder.stop();
      } catch {
        recorderRef.current = null;
        setPhase('idle');
        fail('mic', 'The recording could not be read back.');
        return;
      }
      recorderRef.current = null;

      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

      try {
        const result = await submitFallbackTake({ script, projectId, audio: pcm, durationSeconds });
        setFallback(result);
        setSummary(result.summary);
        setTips(result.tips);
        setTranscript(result.fallback ? 'Reviewed after the take.' : '');
        setPhase('ended');
      } catch (error) {
        setPhase('idle');
        fail('server', error instanceof Error ? error.message : 'The take could not be reviewed.');
      }
    },
    [fail],
  );

  const reset = useCallback(() => {
    socketRef.current?.dispose();
    socketRef.current = null;
    releaseMic();
    wrapUpRef.current?.();
    wrapUpRef.current = null;
    setPhase('idle');
    setTips([]);
    setTranscript('');
    setLevel(0);
    setElapsedSeconds(0);
    setCurrentLine(0);
    setSummary(null);
    setFallback(null);
    setRecordingFallback(false);
    setFailure(null);
    setOfferFallback(false);
  }, [releaseMic]);

  return {
    phase,
    tips,
    transcript,
    level,
    elapsedSeconds,
    remainingSeconds,
    currentLine,
    setCurrentLine: (index: number) => {
      setCurrentLine(index);
      socketRef.current?.send({ type: 'line', index } satisfies LiveClientMessage);
    },
    quota,
    summary,
    fallback,
    recordingFallback,
    failure,
    offerFallback,
    start,
    stop,
    startFallback,
    submitFallback,
    reset,
  };
}
