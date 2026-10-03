import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, QueryBoundary } from '../components/StateViews';
import { RelevanceBadge } from '../components/RelevanceBadge';
import { SkeletonCard } from '../components/Skeleton';
import { useHealth } from '../hooks/useHealth';
import { useDnaProfile } from '../hooks/useDna';
import { useTrendsForMe } from '../hooks/useTrends';
import { useUiStore } from '../store/useUiStore';
import { ApiError } from '../lib/api';
import type { HealthCheckStatus, HealthResponse, RankedTrend } from '@creatordna/shared';

/**
 * Quick actions on the prompt box. Each one carries the typed idea with it, so
 * "Trend Remix" and "Hook Lab" start from what the creator just wrote.
 */
const quickActions = [
  {
    label: 'Trend Remix',
    to: '/trends/remix',
    hint: 'Rewrite a trending format in your voice',
  },
  {
    label: 'Hook Lab',
    to: '/hooks',
    hint: 'Six openings in six different styles',
  },
  {
    label: 'Analyze',
    to: '/dna',
    hint: 'See your DNA sync score and gaps',
  },
  {
    label: 'Content ideas',
    to: '/create',
    hint: 'Turn the idea into a 9:16 short',
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);
  const health = useHealth();
  const dna = useDnaProfile();
  const [idea, setIdea] = useState('');

  // A creator without a DNA profile cannot use the studio yet - say so once,
  // at the top, instead of failing quietly in every later screen.
  const needsOnboarding = dna.isError === true && isNotFound(dna.error);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length === 0) return;
    setDraftIdea(trimmed);
    navigate('/create');
  }

  /** Quick actions carry whatever is typed, so nothing has to be retyped. */
  function goToQuickAction(to: string): void {
    const trimmed = idea.trim();
    if (trimmed.length > 0) setDraftIdea(trimmed);
    navigate(to);
  }

  return (
    <>
      <PageHeader
        title="What should we make today?"
        description="CreatorDNA learns who you are, then turns any idea or trend into a 9:16 short that sounds like you."
      />

      {needsOnboarding === true ? (
        <Card className="mb-6 border-peach-300 bg-peach-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
            <div className="min-w-0">
              <h2 className="text-body font-semibold text-peach-800">Build your Creator DNA first</h2>
              <p className="mt-1 text-caption text-peach-700">
                Five short questions, then every script, hook and caption is written in your voice.
              </p>
            </div>
            <Button type="button" onClick={() => navigate('/onboarding')}>
              Start onboarding
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-3">
            <label htmlFor="idea" className="block text-body font-medium text-ink-900">
              Your idea
            </label>
            <textarea
              id="idea"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={3}
              placeholder="e.g. Explain binary search to someone who has never coded before"
              className="w-full resize-y rounded-lg border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={idea.trim().length === 0}>
                Start creating
              </Button>
              <span className="text-caption text-ink-500">
                Script, voice-over, video, music and captions in one pipeline.
              </span>
            </div>
          </form>

          <nav aria-label="Quick actions" className="mt-4 border-t border-line pt-4">
            <ul className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <li key={action.to}>
                  <button
                    type="button"
                    onClick={() => goToQuickAction(action.to)}
                    aria-describedby={`quick-action-hint-${action.to}`}
                    className="rounded-pill border border-line bg-surface-muted px-3.5 py-1.5 text-caption font-medium text-ink-700 transition-colors duration-150 hover:border-peach-300 hover:bg-peach-100 hover:text-peach-800 focus-visible:outline-none"
                  >
                    {action.label}
                    {/* The hint is the accessible name for assistive tech; the
                        visual affordance is the chip itself. */}
                    <span id={`quick-action-hint-${action.to}`} className="sr-only">
                      {action.hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </CardContent>
      </Card>

      <section aria-labelledby="api-health" className="mb-6">
        <h2 id="api-health" className="mb-3 text-body-lg font-semibold text-ink-900">
          API status
        </h2>
        <Card>
          <CardHeader
            title="Live health check"
            description="Fetched from the CreatorDNA API through the Vite dev proxy."
            action={<ApiHealthBadge />}
          />
          <CardContent>
            <QueryBoundary<HealthResponse>
              query={health}
              isEmpty={(data) => Object.keys(data.checks).length === 0}
              emptyTitle="No checks reported"
              emptyDescription="The API responded but did not report any dependency checks."
            >
              {(data) => (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Service" value={data.service} />
                  <Stat label="Version" value={data.version} />
                  <Stat label="Environment" value={data.environment} />
                  <Stat label="Uptime" value={`${data.uptimeSeconds}s`} />
                  {Object.entries(data.checks).map(([name, status]) => (
                    <div key={name}>
                      <dt className="text-tiny uppercase tracking-wide text-ink-500">{name}</dt>
                      <dd className="mt-1">
                        <Badge tone={checkTone(status)}>{status.replace('_', ' ')}</Badge>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </QueryBoundary>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="trending">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="trending" className="text-body-lg font-semibold text-ink-900">
            Trending for you
          </h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/trends/remix')}>
            See all and remix
          </Button>
        </div>
        <TrendingForYou />
      </section>
    </>
  );
}

/**
 * The ranked catalogue, as a horizontal carousel.
 *
 * Each card carries its relevance badge because that is the whole point of the
 * screen: the creator should see *why* a trend was surfaced before they tap it.
 */
function TrendingForYou() {
  const navigate = useNavigate();
  const trends = useTrendsForMe();

  if (trends.isPending === true) {
    return (
      <div className="flex gap-4 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 3 }, (_unused, index) => (
          <SkeletonCard key={index} className="w-[280px] shrink-0" />
        ))}
      </div>
    );
  }

  if (trends.isError === true) {
    // A creator who has not onboarded yet is not an error: invite them in.
    if (trends.error instanceof ApiError && trends.error.status === 404) {
      return (
        <EmptyState
          title="Build your Creator DNA first"
          description="Trends are ranked against your niche, tone and audience. Five short questions, then formats worth remixing show up here."
          action={
            <Button onClick={() => navigate('/onboarding')}>Start onboarding</Button>
          }
        />
      );
    }
    return (
      <ErrorState error={trends.error} onRetry={() => void trends.refetch()} />
    );
  }

  const ranked = trends.data?.trends ?? [];
  if (ranked.length === 0) {
    return (
      <EmptyState
        title="No trends matched your DNA yet"
        description="Once your niche and audience are set, CreatorDNA surfaces formats worth remixing - and rewrites them to sound like you."
        action={
          <Button variant="secondary" onClick={() => navigate('/trends/remix')}>
            Browse trends
          </Button>
        }
      />
    );
  }

  return (
    <>
      {trends.data?.personalizationLimited === true ? (
        <p className="mb-3 text-caption text-ink-500">
          Ranked by popularity only - add your Creator DNA to make these personal.
        </p>
      ) : null}
      <ul
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2"
        aria-label="Trending formats ranked for you"
      >
        {ranked.map((entry) => (
          <li key={entry.trend.id} className="w-[280px] shrink-0 snap-start">
            <TrendCard entry={entry} onRemix={() => navigate(`/trends/remix?trendId=${entry.trend.id}`)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function TrendCard({ entry, onRemix }: { entry: RankedTrend; onRemix: () => void }) {
  return (
    <Card interactive className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col pt-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-body font-semibold text-ink-900">{entry.trend.title}</h3>
          <RelevanceBadge value={entry.relevance} className="shrink-0" />
        </div>
        <p className="mt-2 line-clamp-2 text-caption text-ink-500">{entry.trend.format}</p>
        {entry.reasons.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-tiny text-ink-500">
            {entry.reasons.slice(0, 2).map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto pt-4">
          <Button size="sm" onClick={onRemix} className="w-full">
            Remix this
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** True when the API answered "no DNA yet" rather than a real failure. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tiny uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1 truncate text-body font-medium text-ink-900" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ApiHealthBadge() {
  const health = useHealth();
  if (health.isPending === true) return <Badge tone="warning">checking</Badge>;
  if (health.isError === true) return <Badge tone="danger">offline</Badge>;
  return <Badge tone="success">online</Badge>;
}

function checkTone(status: HealthCheckStatus): BadgeTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'error':
      return 'danger';
    case 'not_configured':
      return 'warning';
    case 'disabled':
    default:
      return 'neutral';
  }
}
