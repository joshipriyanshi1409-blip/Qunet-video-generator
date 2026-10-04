# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Complete documentation set** - root `README.md`, per-folder READMEs for the six
  packages plus `infra`, and a `docs/` folder covering architecture, the Firestore
  schema, the REST API, WebSocket events, local setup, deployment and an FAQ.
- **GitHub meta files** - bug report and feature request issue templates, a pull
  request template, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, an MIT `LICENSE`, and
  this changelog.
- **GitHub Pages deployment** - `.github/workflows/deploy.yml` builds `apps/web`
  and publishes `apps/web/dist` on every push to `main`, or on demand with
  `workflow_dispatch`.
- **Deployment docs** - how the Pages workflow runs, how to trigger it manually,
  the one-time "Settings -> Pages -> Source -> GitHub Actions" step, and the Cloud
  Run prerequisites.
- **`infra/firebase/.firebaserc`** - `staging` and `production` project aliases.
- **Demo seed script** - `pnpm --filter @creatordna/api seed:demo` builds a demo
  creator with a complete DNA profile, warms the render cache, and runs one real
  render to produce the golden video.

- **`apps/web/public/demo/creatordna-demo.mp4`** - a 46-second 9:16 demo render
  (plus its poster frame and the script that generates both, in
  `apps/web/scripts/`), so the showcase deployments have a real video to play.

### Changed

- **Firebase Hosting is configured** - `infra/firebase/firebase.json` now hosts
  `apps/web/dist`, rewrites `/api/**`, `/ws/**` and `/health` to the Cloud Run API,
  and applies asset caching plus security headers.
- **The API env schema gained** `DEMO_CACHE_DIR`, `RENDER_COMPOSER` and
  `FFMPEG_PATH`; the worker gained `DEMO_MODE` and `DEMO_CACHE_DIR`.
- **`tsconfig.json` widened in `apps/api` and `apps/worker`** to include
  `scripts/**/*.ts`, so the seed and scaling scripts are type-checked.

### Fixed

- **A finished render on the showcase deployments could not be played.** The demo
  backend reported an MP4 at `/api/v1/render-assets/demo.mp4`, a path only the API
  serves - so on Vercel or Pages the player fell through to "This video could not
  be played". Demo jobs now reference the bundled
  `public/demo/creatordna-demo.mp4`, and the demo render is simulated on a clock
  so a started job finishes instead of sitting at 0%.
- **`GET /api/v1/jobs/:jobId` had no demo backend route.** The progress screen
  (and therefore the render journey) failed with "The API returned an unexpected
  shape" the moment a job was started. The route is now answered, and its
  response is validated against `jobStatusResponseSchema` in the test suite.
- **`seed:demo` was missing from `apps/api/package.json`** although the README
  referenced it. It is now a real script.
- **Pre-existing type errors in `apps/api/scripts/smoke.ts`** and
  `apps/worker/scripts/scaleWorker.ts`, surfaced by the widened `include`.

### Known gaps

- `startRender()` in `apps/web/src/lib/render.ts` has no caller, and
  `CreatePage.tsx` is still a placeholder, so onboarding -> published video cannot
  complete end to end.
- The queue-depth autoscaler (`scale:worker`) has no Cloud Scheduler job invoking
  it, so it is a script rather than an autoscaler.
- The CD workflow has never been executed - no GCP project is committed to this
  repo.
- No media adapter has been exercised against a live Google API.
