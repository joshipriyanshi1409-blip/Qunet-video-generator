import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { EmptyState, ErrorState, QueryBoundary } from '../components/StateViews';
import { RelevanceBadge } from '../components/RelevanceBadge';
import { SkeletonCard } from '../components/Skeleton';
import { useHealth } from '../hooks/useHealth';
import { useDnaProfile } from '../hooks/useDna';
import { useTrendsForMe } from '../hooks/useTrends';
import { useUiStore } from '../store/useUiStore';
import { ApiError } from '../lib/api';
import { THUMBNAILS } from '../lib/studioFixtures';
import { cn } from '../lib/cn';
import type { HealthCheckStatus, HealthResponse, RankedTrend } from '@creatordna/shared';

const CREATION_MODES = [
  { id: 'trend', label: 'Trend', icon: '🔥', defaultPrompt: 'POV: You finally understand Binary Search after 3 days' },
  { id: 'photo', label: 'Photo', icon: '📷', defaultPrompt: 'My CSE study desk setup and coding routine' },
  { id: 'video', label: 'Video', icon: '🎬', defaultPrompt: 'Explain binary search to someone who has never coded before' },
  { id: 'reference', label: 'Reference', icon: '📄', defaultPrompt: 'DSA cheat sheet: time complexity made simple' },
  { id: 'link', label: 'Link', icon: '🔗', defaultPrompt: 'Breakdown of today’s top LeetCode daily challenge' },
  { id: 'idea', label: 'Idea', icon: '💡', defaultPrompt: 'A day in my life as a CSE student' },
] as const;

/**
 * Quick actions on the Home dashboard. Each carries the typed idea with it so
 * "Trend Remix" and "Hook Lab" start from what the creator just wrote.
 */
const quickActions = [
  {
    label: 'Trend Remix',
    subtitle: 'Turn trending into your style',
    to: '/trends/remix',
    hint: 'Rewrite a trending format in your voice',
    iconBg: 'bg-peach-100 text-peach-700',
    icon: '🔥',
  },
  {
    label: 'Hook Lab',
    subtitle: 'Write hooks that get attention',
    to: '/hooks',
    hint: 'Six openings in six different styles',
    iconBg: 'bg-purple-100 text-purple-700',
    icon: '🔗',
  },
  {
    label: 'Analyze',
    subtitle: 'Improve your past content',
    to: '/dna',
    hint: 'See your DNA sync score and gaps',
    iconBg: 'bg-info-soft text-info-strong',
    icon: '📊',
  },
  {
    label: 'Content ideas',
    subtitle: 'Never run out of ideas',
    to: '/create',
    hint: 'Turn the idea into a 9:16 short',
    iconBg: 'bg-warning-soft text-warning-strong',
    icon: '💡',
  },
];

const continueCreatingItems = [
  {
    id: 'cont-1',
    title: 'POV: You finally... Binary Search',
    badge: 'Trend Remix',
    badgeClass: 'bg-peach-100 text-peach-800 border-peach-200',
    thumbnail: THUMBNAILS.binarySearchDesk,
    to: '/trends/remix?trendId=trend_pov_finally',
  },
  {
    id: 'cont-2',
    title: 'Day in my life...',
    badge: 'Create',
    badgeClass: 'bg-info-soft text-info-strong border-info/20',
    thumbnail: THUMBNAILS.cseStudentLife,
    to: '/create',
  },
  {
    id: 'cont-3',
    title: 'Study Vlog',
    badge: 'Edit',
    badgeClass: 'bg-success-soft text-success-strong border-success/20',
    thumbnail: THUMBNAILS.studyTipsDesk,
    to: '/render/demo-binary-search/result',
  },
];

export function HomePage() {
  const navigate = useNavigate();
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);
  const health = useHealth();
  const dna = useDnaProfile();
  const [idea, setIdea] = useState('');
  const [activeMode, setActiveMode] = useState<string>('trend');

  const needsOnboarding = dna.isError === true && isNotFound(dna.error);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length === 0) return;
    setDraftIdea(trimmed);
    navigate('/create');
  }

  function handleGenerateClick(): void {
    const trimmed = idea.trim() || 'POV: You finally understand Binary Search after 3 days';
    setDraftIdea(trimmed);
    navigate('/create');
  }

  function goToQuickAction(to: string): void {
    const trimmed = idea.trim();
    if (trimmed.length > 0) setDraftIdea(trimmed);
    navigate(to);
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-display font-bold tracking-tight text-ink-900">
          Good evening, Devanshi! <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-1 text-body text-ink-500">
          Your ideas. Your voice. Our AI studio.
        </p>
      </header>

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

      {/* Main Prompt Card (Screen 1) */}
      <Card className="mb-7 border-peach-200/80 bg-surface shadow-card">
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <label htmlFor="idea" className="block text-body-lg font-semibold text-ink-900">
              What do you want to create today?
            </label>
            <span className="sr-only">Your idea</span>

            <div className="relative flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-4 text-ink-300"
              >
                <svg className="size-5" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>

              <input
                id="idea"
                aria-label="Your idea"
                type="text"
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                placeholder="Make a reel about..."
                className="h-13 w-full rounded-pill border border-line bg-surface-muted/70 pl-12 pr-14 text-body text-ink-900 placeholder:text-ink-300 focus:border-peach-400 focus:bg-surface focus:outline-none"
              />

              <button
                type="submit"
                aria-label="Start creating"
                disabled={idea.trim().length === 0}
                className="absolute right-2 flex size-9 items-center justify-center rounded-pill bg-peach-500 text-white shadow-xs transition-all hover:bg-peach-600 disabled:opacity-40"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {/* Source / Format Pills Row */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {CREATION_MODES.map((mode) => {
                const isSelected = activeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setActiveMode(mode.id);
                      if (idea.trim().length === 0) {
                        setIdea(mode.defaultPrompt);
                      }
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 text-caption font-medium transition-all duration-150',
                      isSelected
                        ? 'border-peach-300 bg-peach-100 text-peach-800 shadow-2xs'
                        : 'border-line bg-surface text-ink-700 hover:border-peach-200 hover:bg-peach-50',
                    )}
                  >
                    <span aria-hidden="true">{mode.icon}</span>
                    <span>{mode.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Primary Dark Navy Generate Button */}
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={handleGenerateClick}
                className="inline-flex h-11 items-center gap-2 rounded-pill bg-[#1e2433] px-8 text-body font-semibold text-white shadow-card transition-all hover:bg-[#2a3246] active:scale-[0.99]"
              >
                <span aria-hidden="true" className="text-amber-300">✨</span>
                <span>+ Generate</span>
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Quick Actions Section (Screen 1) */}
      <section aria-labelledby="quick-actions-heading" className="mb-7">
        <div className="mb-3">
          <h2 id="quick-actions-heading" className="text-body-lg font-bold text-ink-900">
            Quick Actions
          </h2>
          <p className="text-caption text-ink-500">Tools to make your content smarter</p>
        </div>

        <nav aria-label="Quick actions">
          <ul className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {quickActions.map((action) => (
              <li key={action.to}>
                <button
                  type="button"
                  onClick={() => goToQuickAction(action.to)}
                  aria-describedby={`quick-action-hint-${action.to}`}
                  className="flex h-full w-full flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-peach-300 hover:shadow-card-hover"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-9 items-center justify-center rounded-xl text-body',
                        action.iconBg,
                      )}
                    >
                      {action.icon}
                    </span>
                    <span className="text-body font-semibold text-ink-900">{action.label}</span>
                  </div>
                  <p className="mt-2.5 text-caption text-ink-500">{action.subtitle}</p>
                  <span id={`quick-action-hint-${action.to}`} className="sr-only">
                    {action.hint}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      {/* Continue Creating Section (Screen 1) */}
      <section aria-labelledby="continue-creating-heading" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="continue-creating-heading" className="text-body-lg font-bold text-ink-900">
            Continue Creating
          </h2>
          <Link
            to="/library"
            className="text-caption font-semibold text-info hover:underline"
          >
            See all →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {continueCreatingItems.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              className="group flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-peach-300 hover:shadow-card-hover"
            >
              <img
                src={item.thumbnail}
                alt={item.title}
                className="h-16 w-20 shrink-0 rounded-xl object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption font-semibold text-ink-900 group-hover:text-peach-700">
                  {item.title}
                </p>
                <span
                  className={cn(
                    'mt-2 inline-flex items-center rounded-pill border px-2.5 py-0.5 text-tiny font-semibold',
                    item.badgeClass,
                  )}
                >
                  {item.badge}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="trending" className="mb-8">
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
    </>
  );
}

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
