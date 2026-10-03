import { useQuery } from '@tanstack/react-query';
import type { DnaSuggestion, DnaSuggestionField } from '@creatordna/shared';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card, CardContent, CardHeader } from '../Card';
import { EmptyState } from '../StateViews';
import { useToast } from '../../hooks/useToast';
import {
  useAcceptSuggestion,
  useDnaSuggestions,
  useGenerateSuggestions,
  useRejectSuggestion,
} from '../../hooks/useDnaLearning';
import { fetchSignals } from '../../lib/dnaLearning';
import { cn } from '../../lib/cn';

/** Human names for the fields a proposal may touch. */
const FIELD_LABELS: Record<DnaSuggestionField, string> = {
  vocabulary: 'Vocabulary',
  catchphrases: 'Catchphrases',
  tone: 'Tone',
  personality: 'Personality',
  dos: 'Always do',
  donts: 'Never do',
  audience: 'Audience',
  style: 'Style',
};

export interface SuggestedUpdatesProps {
  className?: string;
}

/**
 * "Suggested DNA updates".
 *
 * The panel exists to make one thing unmistakable: these are proposals, and
 * nothing changes until the creator says so. Every card carries its evidence and
 * its reason, because a suggestion nobody can check is a suggestion everyone
 * learns to dismiss - and a dismissed panel teaches the model nothing.
 */
export function SuggestedUpdates({ className }: SuggestedUpdatesProps) {
  const { push } = useToast();
  const suggestions = useDnaSuggestions('pending');
  const generate = useGenerateSuggestions();
  const accept = useAcceptSuggestion();
  const reject = useRejectSuggestion();

  // The evidence labels, so a proposal can show *what* it was reasoned from
  // rather than just how many signals backed it.
  const signals = useQuery({
    queryKey: ['dna', 'signals'],
    queryFn: () => fetchSignals(30),
    retry: false,
    staleTime: 60_000,
  });

  const labelFor = (id: string): string | null =>
    signals.data?.signals.find((signal) => signal.id === id)?.label ?? null;

  const busy = accept.isPending === true || reject.isPending === true;

  async function onAccept(suggestion: DnaSuggestion): Promise<void> {
    try {
      await accept.mutateAsync(suggestion.id);
      push({
        title: 'DNA updated',
        description: `${FIELD_LABELS[suggestion.field]} now reads: ${suggestion.value.join(', ')}`,
        tone: 'success',
      });
    } catch {
      push({
        title: 'Could not apply that update',
        description: 'Your profile was left unchanged. Try again in a moment.',
        tone: 'danger',
      });
    }
  }

  async function onReject(suggestion: DnaSuggestion): Promise<void> {
    try {
      await reject.mutateAsync(suggestion.id);
      push({ title: 'Suggestion dismissed', tone: 'neutral' });
    } catch {
      push({
        title: 'Could not dismiss that suggestion',
        description: 'Nothing was changed either way.',
        tone: 'danger',
      });
    }
  }

  async function onGenerate(): Promise<void> {
    try {
      const result = await generate.mutateAsync();
      if (result.skipped === true) {
        push({
          title: 'All caught up',
          description:
            result.reason === 'no-profile'
              ? 'Finish onboarding first and the loop has something to learn from.'
              : 'Nothing new has happened since the last review.',
          tone: 'neutral',
        });
        return;
      }
      push({
        title: result.suggestions.length === 0 ? 'Nothing to suggest yet' : 'New suggestions ready',
        description:
          result.suggestions.length === 0
            ? 'The loop looked at your recent choices and found nothing worth changing.'
            : `${result.suggestions.length} proposal(s) waiting for your call.`,
        tone: 'success',
      });
    } catch {
      push({
        title: 'Could not review your activity',
        description: 'Nothing was changed. Try again in a moment.',
        tone: 'danger',
      });
    }
  }

  const items = suggestions.data ?? [];

  return (
    <Card className={className}>
      <CardHeader
        title="Suggested DNA updates"
        description="Proposals from what you have actually chosen in the app. Nothing is applied until you accept it."
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={generate.isPending === true}
            onClick={() => void onGenerate()}
          >
            {generate.isPending === true ? 'Reviewing…' : 'Review my activity'}
          </Button>
        }
      />
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <EmptyState
            title="No suggestions right now"
            description="The loop reviews your hooks, remixes and Audience Mirror tips periodically. When it finds something worth changing, it shows up here for you to accept or dismiss."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((suggestion) => (
              <li key={suggestion.id}>
                <article className="rounded-card border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="peach" compact>
                      {suggestion.action === 'add' ? 'Add to' : 'Replace'} {FIELD_LABELS[suggestion.field]}
                    </Badge>
                    {suggestion.evidence.length > 0 ? (
                      <span className="text-tiny text-ink-500">
                        from {suggestion.evidence.length} recent{' '}
                        {suggestion.evidence.length === 1 ? 'choice' : 'choices'}
                      </span>
                    ) : null}
                  </div>

                  <ul className="mt-3 flex flex-wrap gap-2">
                    {suggestion.value.map((value) => (
                      <li
                        key={value}
                        className="rounded-pill bg-peach-100 px-3 py-1 text-caption font-medium text-peach-800"
                      >
                        {value}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 text-body text-ink-700">{suggestion.rationale}</p>

                  {suggestion.evidence.length > 0 ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-caption font-medium text-peach-700">
                        What this was based on
                      </summary>
                      <ul className="mt-2 space-y-1 border-l border-line pl-3">
                        {suggestion.evidence.map((id) => (
                          <li key={id} className="text-tiny text-ink-500">
                            {labelFor(id) ?? id}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy === true}
                      onClick={() => void onAccept(suggestion)}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === true}
                      onClick={() => void onReject(suggestion)}
                    >
                      Not for me
                    </Button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}

        <p className={cn('text-tiny text-ink-500')}>
          Accepting writes a new DNA version and keeps the old one in your history, so you can
          always see what changed and why.
        </p>
      </CardContent>
    </Card>
  );
}
