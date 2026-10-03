import {
  coachTipSchema,
  type CoachTip,
  type LiveSessionScript,
} from '@creatordna/shared';
import type {
  LiveSessionEvent,
  LiveSessionHandle,
  LiveSessionOptions,
  LiveSessionProvider,
} from './types.js';

/**
 * DEV ONLY - a deterministic live coach.
 *
 * `AI_STUB_CLIENT=true` wires this in instead of the Gemini adapter, so the
 * whole Phase 6 flow (mic -> worklet -> socket -> tips -> summary) can be demoed
 * and smoke-tested with no API key and no network. It never invents a profile:
 * every tip it emits is derived from the script it was handed.
 *
 * TODO(phase-6): delete this file once a real `GEMINI_LIVE_MODEL` is configured.
 */

/** Tip templates, one per coaching dimension, all derived from the script. */
const TIP_TEMPLATES: Readonly<Record<CoachTip['kind'], string>> = {
  pace: 'Steady pace so far - hold that through the last two lines.',
  clarity: 'Land the last word of each line; you are trailing off on the ends.',
  filler: 'You said "um" twice on line {{line}}. Take a breath instead.',
  energy: 'Lift your energy on the hook - that is the part that has to stop the scroll.',
  tone: 'That matches your tone. Keep the directness, drop the hedging.',
};

export interface StubLiveProviderOptions {
  /** Milliseconds between tips. Keeps the dev demo watchable. */
  tipIntervalMs?: number;
  /** How many chunks to count before the first tip. */
  chunksPerTip?: number;
}

/**
 * Builds a provider that coaches on a timer.
 *
 * The tip kind rotates through all five so the feedback feed shows every badge
 * in dev, and the message interpolates the line number so it is visibly tied to
 * the script rather than canned.
 */
export function createStubLiveProvider(
  options: StubLiveProviderOptions = {},
): LiveSessionProvider {
  const tipIntervalMs = options.tipIntervalMs ?? 4000;
  const chunksPerTip = options.chunksPerTip ?? 8;

  return {
    name: 'stub-live',
    available: true,

    // Not `async`: a stub has nothing to await, and claiming otherwise would
    // only satisfy a lint rule.
    open(sessionOptions: LiveSessionOptions): Promise<LiveSessionHandle> {
      const queue: LiveSessionEvent[] = [];
      const kinds = Object.keys(TIP_TEMPLATES) as CoachTip['kind'][];
      const script: LiveSessionScript = sessionOptions.script;

      let chunks = 0;
      let tipIndex = 0;
      let closed = false;
      let notify: (() => void) | null = null;
      /**
       * Every pending timer, not just the last one.
       *
       * A single `timer` variable looks like enough until two independent
       * schedules write to it: the second overwrites the first, and `close()`
       * then cancels one chain while the other keeps rescheduling itself for as
       * long as the process lives.
       */
      const timers = new Set<NodeJS.Timeout>();

      function wake(): void {
        const resolve = notify;
        notify = null;
        resolve?.();
      }

      function emit(event: LiveSessionEvent): void {
        if (closed) return;
        queue.push(event);
        wake();
      }

      /** Cancels every pending schedule without marking the handle closed. */
      function stopSchedules(): void {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      }

      function schedule(ms: number, run: () => void): void {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (closed) return;
          run();
        }, ms);
        timers.add(timer);
      }

      function scheduleTip(): void {
        if (closed) return;
        schedule(tipIntervalMs, () => {
          const kind = kinds[tipIndex % kinds.length] ?? 'pace';
          tipIndex += 1;
          const line = (tipIndex % Math.max(1, script.length)) + 1;
          const tip = coachTipSchema.parse({
            kind,
            severity: kind === 'tone' || kind === 'pace' ? 'good' : 'info',
            message: TIP_TEMPLATES[kind].replace('{{line}}', String(line)),
            atSeconds: Math.round((tipIndex * tipIntervalMs) / 1000),
          });
          emit({ kind: 'tip', tip });
          emit({ kind: 'transcript', text: `…reading line ${line}…`, final: false });
          scheduleTip();
        });
      }

      // The stub "speaks" its tips too, so the playback path is exercised in dev.
      function scheduleAudio(): void {
        if (closed) return;
        schedule(tipIntervalMs * 2, () => {
          emit({
            kind: 'audio',
            // 240 bytes of 16-bit PCM at 16 kHz is ~7.5ms of silence - enough to
            // prove the decode-and-play path without making a sound.
            data: Buffer.alloc(240).toString('base64'),
            mimeType: 'audio/pcm;rate=24000',
          });
          scheduleAudio();
        });
      }

      // Start the session with a short delay so the creator is already reading.
      schedule(tipIntervalMs, () => {
        scheduleTip();
        scheduleAudio();
      });

      const handle: LiveSessionHandle = {
        sendAudio() {
          chunks += 1;
          // A transcript every few chunks, so the live view looks alive.
          if (chunks % chunksPerTip === 0) {
            emit({ kind: 'transcript', text: '…', final: false });
          }
        },

        endAudioStream() {
          emit({ kind: 'transcript', text: '[microphone muted]', final: true });
        },

        sendText(text: string) {
          // "Wrap up" is the closing turn; answer it with the summary-shaped text
          // the service turns into a saved summary.
          if (/wrap|summar|finish|end/i.test(text)) {
            // Stop the running schedules first. A real model goes quiet when it
            // is asked to wrap up, and one that kept talking would push the
            // service's quiet window out forever, so every wrap-up would time
            // out instead of returning the answer.
            stopSchedules();
            emit({
              kind: 'text',
              text: JSON.stringify({
                strengths: ['Steady pace across the whole take.'],
                issues: ['Filler words clustered in the first two lines.'],
                tips: ['Take a breath before line one instead of filling it.'],
              }),
            });
          } else {
            emit({ kind: 'text', text: `Noted: ${text.slice(0, 80)}` });
          }
        },

        async next(): Promise<LiveSessionEvent> {
          for (;;) {
            const event = queue.shift();
            if (event !== undefined) return event;
            if (closed) return { kind: 'closed' };
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          }
        },

        close(): Promise<void> {
          if (closed) return Promise.resolve();
          closed = true;
          for (const timer of timers) clearTimeout(timer);
          timers.clear();
          queue.push({ kind: 'closed' });
          wake();
          return Promise.resolve();
        },
      };

      return Promise.resolve(handle);
    },
  };
}
