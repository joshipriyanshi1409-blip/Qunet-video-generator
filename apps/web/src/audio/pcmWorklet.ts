/**
 * The AudioWorklet that captures microphone frames.
 *
 * The worklet only forwards frames - resampling and 16-bit packing happen on the
 * main thread with the pure helpers in `pcm.ts`. That is deliberate: the DSP here
 * is the part most likely to be wrong, and a worklet cannot be unit-tested, while
 * `PcmResampler` can. At 48 kHz a 128-sample quantum is ~2.7 ms of audio, so
 * ~375 messages a second - cheap enough that the main thread keeps up.
 *
 * The processor source is a string because `audioWorklet.addModule` needs a URL,
 * and a blob URL keeps this in one file with no extra build step or network
 * request (the in-app preview sandbox blocks those anyway).
 */

/** Processor name the worklet registers itself under. */
export const PCM_WORKLET_NAME = 'creatordna-pcm-capture';

export const PCM_WORKLET_SOURCE = `
class CreatorDnaPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel !== undefined && channel.length > 0) {
      // A copy, not the view: the buffer is reused by the next quantum, and it
      // is transferred so nothing is cloned on the way out.
      const frame = channel.slice();
      this.frames += 1;
      this.port.postMessage({ frame, index: this.frames }, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor('${PCM_WORKLET_NAME}', CreatorDnaPcmProcessor);
`;

/** Blob URL for the processor source, created once per page. */
export function pcmWorkletUrl(): string {
  return URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' }));
}
