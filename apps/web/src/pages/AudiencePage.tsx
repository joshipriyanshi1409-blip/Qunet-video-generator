import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  INTEREST_TO_REACTION,
  type AudienceMirrorResult,
  type InterestLevel,
  type ReactionLevel,
} from '@creatordna/shared';
import { Badge, ReactionBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardFooter, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useApproveProject, useImproveCopy, useMirrorContent } from '../hooks/useAudience';
import { useToast } from '../hooks/useToast';
import { ApiError } from '../lib/api';
import { trackSignal } from '../lib/dnaLearning';
import { useUiStore } from '../store/useUiStore';

/**
 * Audience Mirror + the approval gate.
 *
 * The screen is the whole Phase 5 loop in one place: mirror the content, read
 * the per-segment verdicts, improve the weakest line, then approve (which
 * enqueues the render) or revise (which goes back to Trend Remix carrying the
 * feedback with it).
 */

/** A per-segment verdict card. The avatar is generated, never a real face. */
function SegmentCard({
  segmentName,
  interest,
  reason,
  tip,
  onUseTip,
  selected,
}: {
  segmentName: string;
  interest: InterestLevel;
  reason: string;
  tip: string;
  onUseTip(tip: string): void;
  selected: boolean;
}) {
  // `interest` is capitalised on the wire; `ReactionBadge` speaks lowercase.
  const level: ReactionLevel = INTEREST_TO_REACTION[interest];
  const initials = segmentName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

  return (
    <Card className="h-full" data-selected={selected === true ? 'true' : undefined}>
      <CardHeader
        title={
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-peach-100 text-tiny font-semibold uppercase text-peach-800"
            >
              {initials.length > 0 ? initials : '?'}
            </span>
            <span className="min-w-0">{segmentName}</span>
          </span>
        }
        action={<ReactionBadge level={level} />}
      />
      <CardContent className="space-y-3">
        <div>
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-ink-500">Why</h4>
          <p className="mt-1 text-caption text-ink-700">{reason}</p>
        </div>
        <div>
          <h4 className="text-tiny font-semibold uppercase tracking-wide text-ink-500">
            Improve it
          </h4>
          <p className="mt-1 text-caption text-ink-700">{tip}</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onUseTip(tip)}
          aria-label={`Use the tip for ${segmentName}`}
        >
          Use this tip
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AudiencePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { push } = useToast();
  const setMirrorFeedback = useUiStore((state) => state.setMirrorFeedback);

  const mirror = useMirrorContent();
  const improve = useImproveCopy();
  const approve = useApproveProject();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [result, setResult] = useState<AudienceMirrorResult | null>(null);
  /** The tip the creator picked to improve against, if any. */
  const [selectedTip, setSelectedTip] = useState<string | null>(null);

  /**
   * Content to test.
   *
   * Arrives prefilled from Trend Remix (`?hook=`, `?cta=`, `?content=`,
   * `&projectId=`) so the creator does not paste it twice, but it is always
   * editable - a mirror is only worth running against what you actually intend
   * to publish.
   */
  const initial = useMemo(() => {
    const trendId = searchParams.get('trendId');
    return {
      content: searchParams.get('content') ?? searchParams.get('hook') ?? '',
      hook: searchParams.get('hook') ?? '',
      cta: searchParams.get('cta') ?? '',
      projectId: searchParams.get('projectId'),
      trendId: trendId === null || trendId.length === 0 ? undefined : trendId,
    };
  }, [searchParams]);

  const [draft, setDraft] = useState({
    content: initial.content,
    hook: initial.hook,
    cta: initial.cta,
  });
  const [seed, setSeed] = useState(initial);

  // A changed query (e.g. arriving from a different remix) re-seeds the form.
  if (seed !== initial) {
    setSeed(initial);
    setDraft({ content: initial.content, hook: initial.hook, cta: initial.cta });
    setProjectId(initial.projectId);
    setResult(null);
  }

  const busy = mirror.isPending === true || improve.isPending === true || approve.isPending === true;
  const canMirror = busy === false && draft.hook.trim().length > 0 && draft.cta.trim().length > 0;

  function runMirror(): void {
    if (!canMirror) return;
    mirror.mutate(
      {
        content: draft.content.trim().length > 0 ? draft.content.trim() : draft.hook.trim(),
        hook: draft.hook.trim(),
        cta: draft.cta.trim(),
        ...(projectId === null ? {} : { projectId }),
        ...(initial.trendId === undefined ? {} : { trendId: initial.trendId }),
      },
      {
        onSuccess: (data) => {
          setProjectId(data.project.id);
          setResult(data.mirror);
        },
        onError: (error) => {
          push({
            title: 'Mirror failed',
            description: error instanceof Error ? error.message : 'Try again in a moment.',
            tone: 'danger',
          });
        },
      },
    );
  }

  /** Applies the improved line to the form and the mirror result to the cards. */
  const applyImprovement = useCallback(
    (data: { improved: { hook: string; cta: string }; mirror?: AudienceMirrorResult }) => {
      setDraft((current) => ({ ...current, hook: data.improved.hook, cta: data.improved.cta }));
      if (data.mirror !== undefined) setResult(data.mirror);
    },
    [],
  );

  function runImprove(target: 'hook' | 'cta'): void {
    if (projectId === null) return;
    improve.mutate(
      {
        projectId,
        target,
        feedback: selectedTip === null ? [] : [selectedTip],
      },
      {
        onSuccess: (data) => {
          applyImprovement(data);
          push({
            title: `${target === 'hook' ? 'Hook' : 'CTA'} improved`,
            description: 'The mirror was re-run on the new line below.',
            tone: 'success',
          });
        },
        onError: (error) => {
          push({
            title: 'Improve failed',
            description: error instanceof Error ? error.message : 'Try again in a moment.',
            tone: 'danger',
          });
        },
      },
    );
  }

  /**
   * Approve: enqueue the render and go to the job screen.
   *
   * The job carries the approved script exactly as shown, so what gets rendered
   * is what the creator saw.
   */
  function runApprove(): void {
    if (projectId === null) return;
    const script = (mirror.data?.project ?? improve.data?.project)
      ?.versions.at(-1)
      ?.script;

    approve.mutate(
      {
        projectId,
        payload: {
          projectId,
          hook: draft.hook.trim(),
          cta: draft.cta.trim(),
          script:
            script !== undefined && script.length > 0
              ? script
              : [
                  { scene: 'Hook', text: draft.hook.trim() },
                  { scene: 'CTA', text: draft.cta.trim() },
                ],
          hashtags: [],
        },
      },
      {
        onSuccess: (data) => {
          push({
            title: 'Approved - render queued',
            description: `Job ${data.job.jobId} is ${data.job.state}.`,
            tone: 'success',
          });
          navigate(`/render/${data.job.jobId}`);
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.status === 503
              ? 'The job queue is not running, so nothing can be rendered yet.'
              : error instanceof Error
                ? error.message
                : 'Try again in a moment.';
          push({ title: 'Could not approve', description: message, tone: 'danger' });
        },
      },
    );
  }

  /**
   * Revise: back to Trend Remix with the mirror feedback attached and prefilled,
   * so the rewrite starts from what the mirror actually said.
   */
  function revise(): void {
    const tips =
      result?.predictions.map(
        (prediction) => `${prediction.segmentName}: ${prediction.tip}`,
      ) ?? [];
    setMirrorFeedback(tips);
    const params = new URLSearchParams();
    params.set('idea', `${draft.hook.trim()}\n\n${draft.content.trim()}`);
    if (initial.trendId !== undefined) params.set('trendId', initial.trendId);
    navigate(`/trends/remix?${params.toString()}`);
  }

  return (
    <>
      <PageHeader
        title="Audience Mirror"
        description="Before you publish: how each segment is likely to react, why, and what to change."
        actions={<Badge tone="peach">Your DNA is injected</Badge>}
      />

      <Card className="mb-6">
        <CardHeader
          title="Content under test"
          description="Prefilled from your remix. Edit it if what you plan to publish differs."
        />
        <CardContent className="space-y-4">
          <div>
            <label
              htmlFor="mirror-hook"
              className="block text-tiny font-semibold uppercase tracking-wide text-ink-500"
            >
              Hook
            </label>
            <input
              id="mirror-hook"
              value={draft.hook}
              onChange={(event) => setDraft((current) => ({ ...current, hook: event.target.value }))}
              maxLength={300}
              className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-body text-ink-900 focus-visible:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="mirror-cta"
              className="block text-tiny font-semibold uppercase tracking-wide text-ink-500"
            >
              Call to action
            </label>
            <input
              id="mirror-cta"
              value={draft.cta}
              onChange={(event) => setDraft((current) => ({ ...current, cta: event.target.value }))}
              maxLength={300}
              className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-body text-ink-900 focus-visible:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="mirror-content"
              className="block text-tiny font-semibold uppercase tracking-wide text-ink-500"
            >
              Full content (optional)
            </label>
            <textarea
              id="mirror-content"
              value={draft.content}
              onChange={(event) =>
                setDraft((current) => ({ ...current, content: event.target.value }))
              }
              rows={4}
              maxLength={4000}
              className="mt-1 w-full rounded-card border border-line bg-surface px-3 py-2 text-body text-ink-900 focus-visible:outline-none"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={runMirror} disabled={!canMirror} loading={mirror.isPending === true}>
            {result === null ? 'Run the mirror' : 'Run it again'}
          </Button>
          <p className="text-caption text-ink-500">
            {result === null
              ? 'Each run spends one model call and records a version on the project.'
              : 'Running again records another version, so you can compare.'}
          </p>
        </CardFooter>
      </Card>

      {mirror.isPending === true ? <LoadingState label="Reading your audience…" lines={5} /> : null}

      {mirror.isPending === false && mirror.isError === true ? (
        <ErrorState error={mirror.error} onRetry={runMirror} className="mb-6" />
      ) : null}

      {result === null && mirror.isPending === false && mirror.isError === false ? (
        <EmptyState
          className="mb-6"
          title="No mirror yet"
          description="Run the mirror to see how each of your DNA audience segments is likely to react."
        />
      ) : null}

      {result === null ? null : (
        <>
          <ul className="mb-6 grid gap-4 lg:grid-cols-3" aria-label="Predicted segment reactions">
            {result.predictions.map((prediction) => (
              <li key={prediction.segmentName}>
                <SegmentCard
                  segmentName={prediction.segmentName}
                  interest={prediction.interest}
                  reason={prediction.reason}
                  tip={prediction.tip}
                  selected={selectedTip === prediction.tip}
                  onUseTip={(tip) => {
                    setSelectedTip((current) => (current === tip ? null : tip));
                    // Applying a tip is the creator acting on the mirror's
                    // advice, which is exactly the evidence the loop wants.
                    void trackSignal({ kind: 'audience_tip_applied', label: tip, source: 'audience-mirror' });
                  }}
                />
              </li>
            ))}
          </ul>

          <Card className="mb-6 border-info-soft bg-info-soft">
            <CardHeader
              title="AI insight"
              description={result.overallInsight}
              action={<Badge tone="info">Cross-segment</Badge>}
            />
            <CardContent>
              <p className="text-caption font-medium text-info-strong">{result.disclaimer}</p>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader
              title="Improve your CTA"
              description="A rewrite that fixes the weakest segment without losing the strongest one."
              action={<Badge tone="warning">Suggested</Badge>}
            />
            <CardContent className="space-y-4">
              <p className="text-body-lg font-medium text-ink-900" aria-live="polite">
                {result.improvedCta}
              </p>
              <p className="text-caption text-ink-500">
                {selectedTip === null
                  ? 'Pick a tip above to steer the rewrite, or improve without one.'
                  : `Steering with: “${selectedTip}”`}
              </p>
            </CardContent>
            <CardFooter>
              <Button
                onClick={() => runImprove('cta')}
                loading={improve.isPending === true}
                disabled={busy}
              >
                Improve the CTA
              </Button>
              <Button
                variant="secondary"
                onClick={() => runImprove('hook')}
                loading={improve.isPending === true}
                disabled={busy}
              >
                Improve the hook
              </Button>
              <p className="text-caption text-ink-500">
                The mirror is re-run on the rewritten line so you can see the segment move.
              </p>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              title="Ready?"
              description="Approve locks this version and queues the render. Revise sends the feedback back to Trend Remix."
            />
            <CardFooter>
              <Button onClick={runApprove} loading={approve.isPending === true} disabled={busy}>
                Approve and render
              </Button>
              <Button variant="secondary" onClick={revise} disabled={busy}>
                Revise in Trend Remix
              </Button>
            </CardFooter>
          </Card>
        </>
      )}
    </>
  );
}
