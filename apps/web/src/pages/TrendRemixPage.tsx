import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  HOOK_STYLE_LABELS,
  type RankedTrend,
  type TrendRemix,
  type TrendRemixRequest,
} from '@creatordna/shared';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { Chip } from '../components/Chip';
import { CopyButton } from '../components/CopyButton';
import { Disclosure } from '../components/Disclosure';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useRemixTrend, useTrendsForMe } from '../hooks/useTrends';
import { ApiError } from '../lib/api';
import { trackSignal } from '../lib/dnaLearning';
import { useUiStore } from '../store/useUiStore';

/**
 * Trend Remix: pick a trending format (or bring your own idea) and get it
 * rewritten to fit your DNA, with the structure it kept spelled out.
 */
export function TrendRemixPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { push } = useToast();
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);

  const trends = useTrendsForMe();
  const remix = useRemixTrend();

  const initialTrendId = searchParams.get('trendId') ?? '';
  const [selectedTrendId, setSelectedTrendId] = useState(initialTrendId);
  /**
   * Prefilled from the Audience Mirror when the creator chose "Revise": the
   * idea box starts with the hook they tested, and the mirror's per-segment tips
   * are listed beside it so the rewrite addresses them.
   */
  const [idea, setIdea] = useState(searchParams.get('idea') ?? '');
  const mirrorFeedback = useUiStore((state) => state.mirrorFeedback);
  const setMirrorFeedback = useUiStore((state) => state.setMirrorFeedback);

  const ranked = useMemo(() => trends.data?.trends ?? [], [trends.data]);
  const selectedTrend = useMemo<RankedTrend | null>(
    () => ranked.find((entry) => entry.trend.id === selectedTrendId) ?? null,
    [ranked, selectedTrendId],
  );

  const canSubmit =
    remix.isPending === false && (selectedTrendId.length > 0 || idea.trim().length > 0);

  const runRemix = useCallback(
    (request: TrendRemixRequest) => {
      remix.mutate(request, {
        onError: (error) => {
          push({
            title: 'Remix failed',
            description: error instanceof Error ? error.message : 'Try again in a moment.',
            tone: 'danger',
          });
        },
      });
    },
    [remix, push],
  );

  /**
   * A rewrite is a rejection of what the model produced. Recorded so the loop
   * can tell "this remix was wrong" from "this creator never saw it".
   */
  function recordRejection(): void {
    const data = remix.data;
    if (data === undefined) return;
    void trackSignal({
      kind: 'remix_rejected',
      label: data.hook,
      source: 'trend-remix',
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runRemix({
      trendId: selectedTrendId.length > 0 ? selectedTrendId : undefined,
      idea: idea.trim().length > 0 ? idea.trim() : undefined,
    });
  }

  /** "Use this" hands the remixed script to the Create screen. */
  function useThis(): void {
    const data = remix.data;
    if (data === undefined) return;
    setDraftIdea(`${data.hook}\n\n${data.script.map((beat) => beat.text).join('\n')}`);
    // "Use this" is an approval; the loop learns as much from what a creator
    // keeps as from what they throw away.
    void trackSignal({
      kind: 'remix_approved',
      label: data.hook,
      source: 'trend-remix',
    });
    push({ title: 'Remix sent to Create', description: 'Your script is waiting there.', tone: 'success' });
    navigate('/create');
  }

  return (
    <>
      <PageHeader
        title="Trend Remix"
        description="Keep the trend's recognizable structure; swap the topic, examples and CTA so it fits your niche, tone and audience."
        actions={<Badge tone="peach">Your DNA is injected</Badge>}
      />

      {mirrorFeedback.length > 0 ? (
        <Card className="mb-6 border-info-soft bg-info-soft" data-testid="mirror-feedback">
          <CardHeader
            title="Mirror feedback to address"
            description="The Audience Mirror flagged these. Fold them into the rewrite, then re-run the mirror."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  recordRejection();
                  setMirrorFeedback([]);
                }}
              >
                Dismiss
              </Button>
            }
          />
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-caption text-info-strong">
              {mirrorFeedback.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="1. Pick a trend" description="Ranked by how well each fits your DNA." />
            <CardContent>
              {trends.isPending === true ? (
                <LoadingState label="Ranking the catalogue…" lines={4} />
              ) : trends.isError === true ? (
                <TrendsError error={trends.error} onRetry={() => void trends.refetch()} />
              ) : ranked.length === 0 ? (
                <EmptyState
                  title="No trends yet"
                  description="Seed the catalogue, then it will be ranked against your DNA."
                />
              ) : (
                <ul className="space-y-2" aria-label="Trending formats">
                  {ranked.map((entry) => {
                    const active = entry.trend.id === selectedTrendId;
                    return (
                      <li key={entry.trend.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTrendId(active ? '' : entry.trend.id);
                            setIdea('');
                          }}
                          aria-pressed={active}
                          className={
                            active === true
                              ? 'w-full rounded-card border border-peach-300 bg-peach-50 px-4 py-3 text-left focus-visible:outline-none'
                              : 'w-full rounded-card border border-line bg-surface px-4 py-3 text-left hover:bg-peach-50 focus-visible:outline-none'
                          }
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-body font-medium text-ink-900">{entry.trend.title}</span>
                            <Badge tone={entry.relevance >= 70 ? 'success' : entry.relevance >= 45 ? 'peach' : 'neutral'}>
                              {entry.relevance}%
                            </Badge>
                          </span>
                          <span className="mt-1 block text-caption text-ink-500">{entry.trend.format}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="2. Or bring your own idea"
              description="No trend to preserve, so the remix is built from your idea alone."
            />
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-3" aria-label="Remix an idea">
                <label htmlFor="own-idea" className="block text-caption font-medium text-ink-900">
                  Your idea
                </label>
                <textarea
                  id="own-idea"
                  rows={3}
                  value={idea}
                  onChange={(event) => {
                    setIdea(event.target.value);
                    if (event.target.value.trim().length > 0) setSelectedTrendId('');
                  }}
                  placeholder="e.g. Explain binary search to a nervous interviewee"
                  className="w-full resize-y rounded-lg border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
                />
                <Button type="submit" disabled={!canSubmit} loading={remix.isPending} className="w-full">
                  {selectedTrendId.length > 0 ? 'Remix this trend' : 'Remix my idea'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {remix.isPending === true ? (
            <Card>
              <CardHeader title="Writing your version…" description="This takes a few seconds." />
              <CardContent>
                <LoadingState label="Generating your remix…" lines={6} />
              </CardContent>
            </Card>
          ) : remix.isError === true ? (
            <ErrorState
              error={remix.error}
              onRetry={() => {
                if (selectedTrendId.length > 0) runRemix({ trendId: selectedTrendId });
                else if (idea.trim().length > 0) runRemix({ idea: idea.trim() });
              }}
            />
          ) : remix.data === undefined ? (
            <EmptyState
              title="Pick a trend to remix"
              description="You will see the original structure next to your version, with what was kept and what changed."
            />
          ) : (
            <RemixResult
              remix={remix.data}
              trend={selectedTrend}
              onRegenerate={() => {
                if (selectedTrendId.length > 0) runRemix({ trendId: selectedTrendId });
                else if (idea.trim().length > 0) runRemix({ idea: idea.trim() });
              }}
              onUseThis={useThis}
              onOpenHookLab={() => {
                setDraftIdea(remix.data.hook);
                navigate('/hooks');
              }}
              regenerating={remix.isPending}
            />
          )}
        </div>
      </div>
    </>
  );
}

function RemixResult({
  remix,
  trend,
  onRegenerate,
  onUseThis,
  onOpenHookLab,
  regenerating,
}: {
  remix: TrendRemix;
  trend: RankedTrend | null;
  onRegenerate: () => void;
  onUseThis: () => void;
  onOpenHookLab: () => void;
  regenerating: boolean;
}) {
  const scriptText = remix.script.map((beat) => `${beat.scene}: ${beat.text}`).join('\n\n');

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Original trend"
            description={trend === null ? 'Free-form idea - no trend structure to preserve.' : trend.trend.format}
            action={<Badge tone="neutral">Structure</Badge>}
          />
          <CardContent className="space-y-3">
            <p className="text-body font-medium text-ink-900">
              {trend === null ? 'Your own idea' : trend.trend.title}
            </p>
            <p className="text-caption text-ink-500">
              {trend === null
                ? 'The remix is built from scratch, so nothing has to be preserved.'
                : trend.trend.description}
            </p>
            {trend === null ? null : (
              <p className="text-caption text-ink-500">
                Category: <span className="text-ink-700">{trend.trend.category}</span> · Relevance{' '}
                <span className="text-ink-700">{trend.relevance}%</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-peach-200 bg-peach-50">
          <CardHeader
            title="Your version"
            description="Same structure, your niche, examples and CTA."
            action={<Badge tone="peach">Your DNA</Badge>}
          />
          <CardContent className="space-y-3">
            <p className="text-body font-semibold text-ink-900">{remix.hook}</p>
            <ol className="list-decimal space-y-1 pl-5 text-caption text-ink-700">
              {remix.script.map((beat, index) => (
                <li key={`${beat.scene}-${index}`}>
                  <span className="font-medium text-ink-900">{beat.scene}:</span> {beat.text}
                </li>
              ))}
            </ol>
            <p className="text-caption font-medium text-peach-800">CTA: {remix.cta}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={onRegenerate} loading={regenerating}>
          Regenerate
        </Button>
        <Button variant="secondary" onClick={onUseThis}>
          Use this
        </Button>
        <CopyButton value={scriptText} label="Copy the whole script" />
      </div>

      <div className="space-y-3">
        <Disclosure title="Hook" meta="The first line" defaultOpen actions={<CopyButton value={remix.hook} label="Copy hook" />}>
          <p className="text-body text-ink-900">{remix.hook}</p>
        </Disclosure>

        <Disclosure title="Script" meta={`${remix.script.length} beats`} defaultOpen>
          <ol className="space-y-3">
            {remix.script.map((beat, index) => (
              <li key={`${beat.scene}-${index}`} className="rounded-lg bg-surface-muted px-4 py-3">
                <p className="text-tiny uppercase tracking-wide text-peach-700">{beat.scene}</p>
                <p className="mt-1 text-body text-ink-900">{beat.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-3">
            <CopyButton value={scriptText} label="Copy the script" />
          </div>
        </Disclosure>

        <Disclosure title="CTA" defaultOpen actions={<CopyButton value={remix.cta} label="Copy the call to action" />}>
          <p className="text-body text-ink-900">{remix.cta}</p>
        </Disclosure>

        <Disclosure title="Caption and hashtags" meta={`${remix.hashtags.length} tags`}>
          <p className="text-body text-ink-900">{remix.caption}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {remix.hashtags.map((tag) => (
              <li key={tag}>
                <Chip>{tag}</Chip>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={remix.caption} label="Copy the caption" />
            <CopyButton value={remix.hashtags.join(' ')} label="Copy the hashtags" />
          </div>
        </Disclosure>

        <Disclosure title="What was kept and what changed" meta="Audit trail">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-caption font-semibold uppercase tracking-wide text-success-strong">Kept</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-ink-700">
                {remix.whatWasKept.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-caption font-semibold uppercase tracking-wide text-peach-800">Changed</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-ink-700">
                {remix.whatWasChanged.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </Disclosure>
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-5">
          <h3 className="text-body font-semibold text-ink-900">Next: hook lab</h3>
          <p className="mt-1 text-caption text-ink-500">
            Want more openings for this script? Hook Lab writes them in six different styles.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenHookLab}>
              Open Hook Lab
            </Button>
            <span className="self-center text-caption text-ink-500">
              Styles: {Object.values(HOOK_STYLE_LABELS).join(', ')}
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/** A 404 here means "not onboarded yet", which is a state, not a failure. */
function TrendsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        title="Build your Creator DNA first"
        description="Trends are ranked against your niche, tone and audience, so the profile has to exist first."
      />
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}
