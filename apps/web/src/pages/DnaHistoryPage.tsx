import { Link } from 'react-router-dom';
import { computeDnaSyncScore, type DnaVersionSnapshot } from '@creatordna/shared';
import { Badge } from '../components/Badge';
import { Card, CardContent } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useDnaVersions } from '../hooks/useDnaLearning';
import { cn } from '../lib/cn';

/**
 * DNA version history.
 *
 * One row per version the profile has been through, newest first, with the
 * score that version earned and what caused it. The current version is marked
 * and links back to the live profile.
 *
 * The score is recomputed here from the stored snapshot rather than read from a
 * stored number: `computeDnaSyncScore` is pure, so the browser and the API
 * agree by construction, and a history page that re-derives its numbers cannot
 * drift from the ring on the My DNA screen.
 */
export function DnaHistoryPage() {
  const versions = useDnaVersions(30);

  if (versions.isPending === true) {
    return (
      <>
        <PageHeader title="DNA history" description="Reading your version history…" />
        <LoadingState label="Reading your DNA versions…" lines={6} />
      </>
    );
  }

  if (versions.isError === true) {
    return (
      <>
        <PageHeader title="DNA history" description="This history could not be read." />
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      </>
    );
  }

  const history = versions.data;
  if (history === undefined || history.versions.length === 0) {
    return (
      <>
        <PageHeader
          title="DNA history"
          description="Every version your Creator DNA has been through."
        />
        <EmptyState
          title="No versions recorded yet"
          description="A version is written whenever you accept a suggested DNA update. Edit your profile or accept a suggestion and it will show up here."
          action={
            <Link
              to="/dna"
              className="inline-flex h-10 items-center rounded-pill border border-line bg-surface px-4 text-body font-medium text-ink-900 hover:bg-peach-50"
            >
              Open My DNA
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="DNA history"
        description="Every version your Creator DNA has been through. Accepting a suggested update writes a new one and keeps the last."
        actions={<Badge tone="peach">{history.versions.length} versions</Badge>}
      />

      <ol className="space-y-3">
        {history.versions.map((snapshot) => (
          <li key={snapshot.version}>
            <VersionCard
              snapshot={snapshot}
              isCurrent={snapshot.version === history.currentVersion}
            />
          </li>
        ))}
      </ol>

      <p className="mt-6 text-caption text-ink-500">
        Looking for the live profile?{' '}
        <Link to="/dna" className="text-peach-700 underline underline-offset-4">
          Open My DNA
        </Link>
        .
      </p>
    </>
  );
}

function VersionCard({
  snapshot,
  isCurrent,
}: {
  snapshot: DnaVersionSnapshot;
  isCurrent: boolean;
}) {
  // Recomputed from the snapshot, never read from a stored number.
  const score = computeDnaSyncScore(snapshot.dna);
  const when = formatTimestamp(snapshot.savedAt);

  return (
    <Card className={cn(isCurrent === true && 'border-peach-300 bg-peach-50')}>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-body-lg font-semibold text-ink-900">Version {snapshot.version}</h2>
          {isCurrent === true ? (
            <Badge tone="success" compact>
              Current
            </Badge>
          ) : null}
          <span className="text-tiny text-ink-500">{when}</span>
        </div>

        <p className="mt-2 text-body text-ink-700">{snapshot.summary}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-caption sm:grid-cols-4">
          <Stat label="Sync score" value={`${score.score}`} />
          <Stat label="Complete" value={`${score.completeness}%`} />
          <Stat label="Consistent" value={`${score.consistency}%`} />
          <Stat label="Words" value={String(snapshot.dna.vocabulary.length)} />
        </dl>

        <p className="mt-3 text-tiny text-ink-500">
          Tone: {snapshot.dna.tone.join(', ') || 'not set'}
        </p>

        {score.inconsistencies.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {score.inconsistencies.map((issue) => (
              <li key={issue} className="text-tiny text-ink-500">
                • {issue}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}

/** "3 minutes ago" style, without pulling in a date library for one line. */
function formatTimestamp(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isFinite(then) === false) return 'unknown time';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
