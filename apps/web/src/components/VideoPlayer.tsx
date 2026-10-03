import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface VideoPlayerProps {
  /** Storage URL of the MP4. */
  src: string;
  /** Accessible description of what is on screen. */
  label: string;
  /** Optional poster shown before playback. */
  poster?: string;
  /** WebVTT caption track, when the job has recorded one. */
  captionsUrl?: string;
  className?: string;
}

/**
 * The finished video.
 *
 * A real `<video controls>` - the browser's own controls are the most accessible
 * ones available, and replacing them with a custom skin is how you lose keyboard
 * support and screen-reader labels. The 9:16 frame is enforced with
 * `aspect-ratio` so the layout does not jump while the metadata loads, and the
 * caption track is attached when the job has one.
 *
 * Errors are surfaced rather than swallowed: a `<video>` that cannot play shows
 * nothing by default, which reads as a broken page rather than a broken file.
 */
export function VideoPlayer({ src, label, poster, captionsUrl, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed === true) {
    return (
      <div
        role="alert"
        className={cn(
          'flex aspect-[9/16] max-h-[70vh] w-full flex-col items-center justify-center gap-3 rounded-card border border-danger-soft bg-danger-soft px-6 text-center',
          className,
        )}
      >
        <p className="text-body font-semibold text-danger-strong">This video could not be played</p>
        <p className="text-caption text-danger-strong/90">
          The file may still be processing, or the link has expired.
        </p>
        <a
          href={src}
          className="text-caption font-medium text-danger-strong underline underline-offset-4"
        >
          Open the MP4 directly
        </a>
      </div>
    );
  }

  return (
    /*
     * `media-has-caption` is disabled on purpose: the pipeline's captions stage
     * produces a WebVTT file, but the worker does not record it on the job
     * document yet, so there is no URL to point a <track> at. When
     * `captionsUrl` is present the track is rendered below instead, and this
     * comment can go.
     */
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      controls
      preload="metadata"
      playsInline
      aria-label={label}
      onError={() => setFailed(true)}
      className={cn(
        'aspect-[9/16] max-h-[70vh] w-full rounded-card border border-line bg-ink-900 object-contain',
        className,
      )}
    >
      {captionsUrl === undefined ? null : (
        <track kind="captions" srcLang="en" label="English captions" src={captionsUrl} default />
      )}
    </video>
  );
}
