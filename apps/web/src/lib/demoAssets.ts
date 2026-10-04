/**
 * Assets the demo deployment ships with.
 *
 * On the public showcase deployments (Vercel, GitHub Pages) there is no API and
 * no worker: `handleDemoFallback` answers for the backend so the studio is
 * navigable, and the render job it fabricates reports an MP4. That MP4 has to be
 * a *real, playable file that is actually on the host* - a path the API would
 * have served in development (`/api/v1/render-assets/...`) resolves to the SPA's
 * `index.html` on a static host, so the video element fails and the only thing a
 * visitor sees is "This video could not be played".
 *
 * The URL is built from `import.meta.env.BASE_URL` because GitHub Pages serves
 * the app from `/<repo>/`, where a root-relative `/demo/...` would 404.
 */

/** Path of the bundled demo render, relative to the app's base. */
export const DEMO_VIDEO_PATH = 'demo/creatordna-demo.mp4';

/** One frame of the demo render, shown while the video loads. */
export const DEMO_POSTER_PATH = 'demo/creatordna-demo-poster.jpg';

/** Absolute-in-the-app URL of the bundled demo render. */
export function demoVideoUrl(): string {
  return fromBase(DEMO_VIDEO_PATH);
}

/** Absolute-in-the-app URL of the demo render's poster frame. */
export function demoPosterUrl(): string {
  return fromBase(DEMO_POSTER_PATH);
}

function fromBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path}`;
}
