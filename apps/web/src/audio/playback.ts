import { LIVE_AUDIO_FORMAT, LIVE_PCM_BYTES_PER_SAMPLE } from '@creatordna/shared';

/**
 * Plays back the coach's spoken feedback.
 *
 * The Live API answers with raw PCM, which no `<audio>` element will play on its
 * own, so it is wrapped in a minimal RIFF/WAVE header first. The format is fixed
 * by the shared contract, so the header is a constant with two numbers filled in.
 */

const WAV_HEADER_BYTES = 44;

/**
 * Builds a WAV file around raw 16-bit PCM.
 *
 * Exported for tests: this is the one place the format is spelled out, and a
 * wrong header means the coach silently says nothing.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate: number = LIVE_AUDIO_FORMAT.sampleRate): Uint8Array {
  const bytesPerSample = LIVE_PCM_BYTES_PER_SAMPLE;
  const channels = LIVE_AUDIO_FORMAT.channels;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = pcm.byteLength;

  const wav = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(wav.buffer);

  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

/**
 * Decodes base64 PCM and plays it.
 *
 * Resolves when playback finishes or is interrupted; never rejects, because a
 * coach that cannot speak must not break the session that is still running.
 */
export async function playPcmAudio(data: string, mimeType: string): Promise<void> {
  const binary = atob(data);
  const pcm = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pcm[index] = binary.charCodeAt(index);
  }

  // `mimeType` is honoured when it names a rate we can build a header for; the
  // shared format is the fallback.
  const rate = /rate=(\d+)/.exec(mimeType);
  const sampleRate = rate === null ? LIVE_AUDIO_FORMAT.sampleRate : Number(rate[1]);

  const wav = pcmToWav(pcm, Number.isFinite(sampleRate) ? sampleRate : LIVE_AUDIO_FORMAT.sampleRate);
  // `wav` is freshly allocated with no offset, so its buffer is exactly the file.
  const url = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));

  try {
    const audio = new Audio(url);
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
  } catch {
    // Autoplay can still refuse; the text version of the tip is already on screen.
  } finally {
    // A tick of delay so the element has picked the blob up before it goes.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
