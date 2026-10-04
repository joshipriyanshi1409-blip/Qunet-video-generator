import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { CopyButton } from '../components/CopyButton';
import { PageHeader } from '../components/PageHeader';
import { VideoPlayer } from '../components/VideoPlayer';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useLibrary } from '../hooks/useLibrary';
import { fetchRenderJob, findMp4Asset, toRenderJobView } from '../lib/render';
import { downloadBlob, downloadStem, downloadText, fetchAsBlob } from '../lib/download';
import { THUMBNAILS } from '../lib/studioFixtures';
import {
  getShareAdapter,
  shareAdapterNotice,
  type QoneqtSharePayload,
} from '../lib/qoneqt';
import { useQuery } from '@tanstack/react-query';

/**
 * The finished render.
 *
 * Four things a creator does with a finished short, in the order they matter:
 * watch it, copy the caption and hashtags, download it, publish it. Everything
 * else on the page is context.
 *
 * The share button is behind `ShareAdapter` because the Qoneqt API contract is not
 * final - the UI is built and tested against the real shape of the operation
 * (validate, post, get an id and a URL back, handle a rejection) while the only
 * implementation is a mock that says so out loud.
 */
export function RenderResultPage() {
  const { jobId = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const library = useLibrary();
  const [sharing, setSharing] = useState(false);

  const query = useQuery({
    queryKey: ['render-result', jobId],
    queryFn: () => fetchRenderJob(jobId),
    enabled: jobId.length > 0,
    retry: false,
  });

  const job = query.data === undefined ? null : toRenderJobView(query.data);
  const mp4 = job === null ? null : findMp4Asset(job.assets);
  // The captions stage's WebVTT, when the worker has recorded one on the job.
  const captions = job?.assets.find((asset) => asset.kind === 'captions') ?? null;

  const payload = query.data?.data as Record<string, unknown> | undefined;

  // Memoised so the callbacks below have stable dependencies: a fresh array on
  // every render would re-create every handler and re-run the save effect.
  const title = useMemo(
    () =>
      typeof payload?.hook === 'string' && payload.hook.length > 0
        ? payload.hook
        : `Render ${jobId}`,
    [payload, jobId],
  );
  const caption = useMemo(
    () => (typeof payload?.caption === 'string' ? payload.caption : ''),
    [payload],
  );
  const hashtags = useMemo(
    () =>
      Array.isArray(payload?.hashtags)
        ? (payload.hashtags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : [],
    [payload],
  );

  // The script, as plain text, so "Download script" has something to write.
  const scriptText = useMemo(() => buildScriptText(payload), [payload]);

  const saved = library.isSaved(jobId);
  const shared = library.items.find((item) => item.jobId === jobId)?.sharedToQoneqt === true;

  // Keep the library entry in step with the job without asking the creator to
  // press "Save" twice: the first time the result page loads a finished job, the
  // entry is written. Pressing the button still works, and still confirms.
  useEffect(() => {
    if (jobId.length === 0 || job === null || mp4 === null) return;
    if (job.state !== 'completed') return;
    if (library.isSaved(jobId) === true) return;

    library.save({
      jobId,
      projectId: job.projectId ?? '',
      title,
      caption,
      hashtags,
      state: 'completed',
      stage: job.stage,
      progress: job.progress,
      updatedAt: new Date().toISOString(),
      mp4Url: mp4.url,
      script: scriptText,
      source: 'render',
    });
    // `library` is a new object every render; the identity that matters is jobId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.state, mp4?.url]);

  const saveToLibrary = useCallback(() => {
    if (jobId.length === 0) return;
    library.save({
      jobId,
      projectId: job?.projectId ?? '',
      title,
      caption,
      hashtags,
      state: job?.state === 'completed' ? 'completed' : 'running',
      stage: job?.stage ?? 'queued',
      progress: job?.progress ?? 0,
      updatedAt: new Date().toISOString(),
      mp4Url: mp4?.url,
      script: scriptText,
      source: 'render',
    });
    push({ title: 'Saved to your library', tone: 'success' });
  }, [jobId, job, mp4, title, caption, hashtags, scriptText, library, push]);

  const downloadMp4 = useCallback(async () => {
    if (mp4?.url === undefined) {
      push({ title: 'No MP4 recorded for this job yet', tone: 'warning' });
      return;
    }

    const blob = await fetchAsBlob(mp4.url);
    if (blob === null) {
      // CORS or a dead link: the honest fallback is the link itself.
      push({
        title: 'Could not download directly',
        description: 'Opening the MP4 in a new tab instead - save it from there.',
        tone: 'warning',
      });
      window.open(mp4.url, '_blank', 'noopener');
      return;
    }

    downloadBlob(blob, `${downloadStem(jobId, title)}.mp4`);
    push({ title: 'Download started', tone: 'success' });
  }, [mp4, jobId, title, push]);

  const downloadScript = useCallback(() => {
    if (scriptText.trim().length === 0) {
      push({ title: 'No script recorded for this job', tone: 'warning' });
      return;
    }
    downloadText(scriptText, `${downloadStem(jobId, title)}-script.txt`, 'text/plain');
    push({ title: 'Script downloaded', tone: 'success' });
  }, [scriptText, jobId, title, push]);

  const shareToQoneqt = useCallback(async () => {
    if (jobId.length === 0) return;

    const adapter = getShareAdapter();
    const payloadToShare: QoneqtSharePayload = {
      jobId,
      title,
      caption,
      hashtags,
      mp4Url: mp4?.url,
      script: scriptText,
    };

    setSharing(true);
    try {
      const result = await adapter.share(payloadToShare);
      if (result.ok === false) {
        push({ title: 'Share failed', description: result.error, tone: 'danger' });
        return;
      }

      library.update(jobId, { sharedToQoneqt: true });
      push({
        title: 'Shared to Qoneqt (preview)',
        description: `${adapter.name} accepted the post as ${result.postId}. Nothing was published.`,
        tone: 'success',
      });
    } finally {
      setSharing(false);
    }
  }, [jobId, title, caption, hashtags, mp4, scriptText, library, push]);

  if (jobId.length === 0) {
    return (
      <>
        <PageHeader title="Result" description="No render selected." />
        <EmptyState
          title="No render selected"
          description="Pick a render from your library to see its video, caption and hashtags."
          action={
            <Link
              to="/library"
              className="inline-flex h-10 items-center rounded-pill border border-line bg-surface px-4 text-body font-medium text-ink-900 hover:bg-peach-50"
            >
              Open your library
            </Link>
          }
        />
      </>
    );
  }

  if (query.isPending === true) {
    return (
      <>
        <PageHeader title="Result" description="Reading the job…" />
        <LoadingState label="Reading the render result…" lines={4} />
      </>
    );
  }

  if (query.isError === true || job === null) {
    return (
      <>
        <PageHeader title="Result" description="This render could not be read." />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} className="mb-6" />
      </>
    );
  }

  if (job.state !== 'completed') {
    return (
      <>
        <PageHeader title="Result" description="This render has not finished yet." />
        <EmptyState
          title="Still rendering"
          description={`This job is on the ${job.stage} stage at ${job.progress}%. The video appears here once it finishes.`}
          action={
            <Link
              to={`/render/${jobId}`}
              className="inline-flex h-10 items-center rounded-pill border border-line bg-surface px-4 text-body font-medium text-ink-900 hover:bg-peach-50"
            >
              Watch the progress
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Final Content"
        description="Your video is ready. Watch it, grab the caption, download it, or send it to your feed."
        actions={
          <>
            <span className="sr-only">Your video is ready</span>
            <Badge tone="success">✨ Optimized for your DNA</Badge>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div>
          {mp4 === null ? (
            <EmptyState
              title="No video recorded"
              description="The job finished without an MP4 asset on the record. That is a pipeline gap, not something you did."
            />
          ) : (
            <div className="space-y-3">
              {/* Visual 9:16 Reel Preview Frame matching Screen 8 */}
              <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-card">
                <img
                  src={THUMBNAILS.reelVerticalCover}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 size-full object-cover opacity-85"
                />
                <div className="relative z-10">
                  <VideoPlayer
                    src={mp4.url ?? ''}
                    label={`Finished short: ${title}`}
                    captionsUrl={captions?.url}
                  />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex items-end justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-3 pt-10 text-white">
                  <p className="text-body-lg font-bold drop-shadow-xs">
                    Binary Search Made Easy ✨
                  </p>
                  <span className="rounded-md bg-black/60 px-2 py-0.5 text-tiny font-semibold tabular-nums">
                    0:46
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void downloadMp4()} disabled={mp4 === null}>
              Download MP4
            </Button>
            <Button variant="secondary" onClick={downloadScript} disabled={scriptText.trim().length === 0}>
              Download script
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          {/* Screen 8 Summary & Quick Action Stack */}
          <Card>
            <CardContent className="space-y-4 pt-5">
              <h2 className="text-title font-bold text-ink-900">{title}</h2>
              <p className="flex flex-wrap gap-2 text-caption font-semibold text-info">
                {(hashtags.length > 0
                  ? hashtags
                  : ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife']
                ).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </p>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => void downloadMp4()}
                  disabled={mp4 === null}
                  className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-muted/70 px-4 py-2.5 text-body font-medium text-ink-900 transition-colors hover:bg-peach-50 disabled:opacity-40"
                >
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true">⬇️</span>
                    <span>Download File (.MP4)</span>
                  </span>
                  <span aria-hidden="true" className="text-ink-300">→</span>
                </button>

                <button
                  type="button"
                  onClick={saveToLibrary}
                  disabled={saved === true}
                  className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-muted/70 px-4 py-2.5 text-body font-medium text-ink-900 transition-colors hover:bg-peach-50 disabled:opacity-60"
                >
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true">🔖</span>
                    <span>Save to Ideas</span>
                  </span>
                  <span aria-hidden="true" className="text-ink-300">
                    {saved === true ? '✓' : '→'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(`/publish?jobId=${encodeURIComponent(jobId)}`)}
                  className="flex w-full items-center justify-between rounded-xl border border-peach-200 bg-peach-50 px-4 py-2.5 text-body font-semibold text-peach-800 transition-colors hover:bg-peach-100"
                >
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true">📤</span>
                    <span>Share / Publish to Qoneqt</span>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Caption" description="What goes with the video when you post it." />
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-body text-ink-900">
                {caption.length > 0 ? caption : 'No caption was generated for this render.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={caption} label="Copy caption" disabled={caption.length === 0} />
                <CopyButton
                  value={hashtags.join(' ')}
                  label="Copy hashtags"
                  joinWith=" "
                  disabled={hashtags.length === 0}
                />
                <CopyButton
                  value={[caption, hashtags.join(' ')].filter((part) => part.length > 0).join('\n\n')}
                  label="Copy caption and hashtags"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Hashtags" description="Tap any one to copy it on its own." />
            <CardContent>
              {hashtags.length === 0 ? (
                <p className="text-caption text-ink-500">No hashtags were generated.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {hashtags.map((tag) => (
                    <li key={tag}>
                      <CopyButton value={tag} label={`Copy ${tag}`} variant="ghost" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Share to Qoneqt Feed"
              description={shareAdapterNotice(getShareAdapter())}
            />
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={sharing} onClick={() => void shareToQoneqt()}>
                  {sharing === true ? 'Sharing…' : 'Share to Qoneqt'}
                </Button>
                <Button variant="secondary" onClick={saveToLibrary} disabled={saved === true}>
                  {saved === true ? 'In your library' : 'Save to Library'}
                </Button>
              </div>
              {shared === true ? (
                <p className="text-caption text-success-strong" role="status">
                  Shared in preview mode. Nothing has been published to the real feed.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Script" description="Exactly what was approved and rendered." />
            <CardContent>
              {scriptText.trim().length === 0 ? (
                <p className="text-caption text-ink-500">No script was recorded on the job.</p>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-body text-ink-900">{scriptText}</pre>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-peach-200 bg-peach-50 px-4 py-3 text-caption font-medium text-peach-800">
        <span aria-hidden="true">💡</span>
        <span>This content is tailored to your Creator DNA and your audience&apos;s preferences.</span>
      </div>

      <p className="mt-6 text-caption text-ink-500">
        <Link to={`/render/${jobId}`} className="text-peach-700 underline underline-offset-4">
          Back to the render progress
        </Link>
        {' · '}
        <Link to="/library" className="text-peach-700 underline underline-offset-4">
          Your library
        </Link>
      </p>
    </>
  );
}

/**
 * Flattens the job payload's script beats into plain text.
 *
 * The payload is an open record, so every field is narrowed here once rather than
 * at each use site - and a missing field becomes an empty string rather than
 * `undefined` leaking into a download.
 */
function buildScriptText(payload: Record<string, unknown> | undefined): string {
  if (payload === undefined) return '';

  const lines: string[] = [];
  const hook = typeof payload.hook === 'string' ? payload.hook : '';
  if (hook.length > 0) lines.push(`HOOK\n${hook}`);

  const script = payload.script;
  if (Array.isArray(script)) {
    const beats = script
      .map((beat) => {
        if (typeof beat !== 'object' || beat === null) return null;
        const record = beat as Record<string, unknown>;
        const scene = typeof record.scene === 'string' ? record.scene : '';
        const text = typeof record.text === 'string' ? record.text : '';
        if (scene.length === 0 && text.length === 0) return null;
        return scene.length > 0 ? `${scene}\n${text}` : text;
      })
      .filter((beat): beat is string => beat !== null);

    if (beats.length > 0) lines.push(`SCRIPT\n${beats.join('\n\n')}`);
  }

  const cta = typeof payload.cta === 'string' ? payload.cta : '';
  if (cta.length > 0) lines.push(`CALL TO ACTION\n${cta}`);

  return lines.join('\n\n');
}
