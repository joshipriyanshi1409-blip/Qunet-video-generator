import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HOOK_STYLE_LABELS, type Hook, type HookStyle } from '@creatordna/shared';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { CopyButton } from '../components/CopyButton';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, LoadingState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useHooks } from '../hooks/useTrends';
import { trackSignal } from '../lib/dnaLearning';
import { useUiStore } from '../store/useUiStore';

/**
 * Hook Lab: six openings for one idea, each in a different style.
 *
 * The creator picks one, can rewrite it inline, and can ask for just that style
 * again without paying for the whole set.
 */
export function HookLabPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { push } = useToast();
  const draftIdea = useUiStore((state) => state.draftIdea);
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);

  const trendId = searchParams.get('trendId') ?? undefined;
  const [idea, setIdea] = useState(draftIdea);

  const hooks = useHooks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [regeneratingStyle, setRegeneratingStyle] = useState<HookStyle | null>(null);

  // A creator arriving from Remix has the hook in their draft; use it, but only
  // once, so an edit is never overwritten by the same value again.
  useEffect(() => {
    if (draftIdea.length > 0 && idea.length === 0) setIdea(draftIdea);
  }, [draftIdea, idea]);

  const list = hooks.data ?? [];

  const generate = useCallback(
    (regenerateStyle?: HookStyle) => {
      const trimmed = idea.trim();
      if (trimmed.length === 0) {
        push({ title: 'Add an idea first', description: 'A hook needs something to hook onto.', tone: 'warning' });
        return;
      }
      setDraftIdea(trimmed);
      if (regenerateStyle !== undefined) setRegeneratingStyle(regenerateStyle);
      hooks.mutate(
        { idea: trimmed, trendId, regenerateStyle },
        {
          onSuccess: (next) => {
            if (regenerateStyle === undefined) {
              setEdits({});
              setSelectedId(null);
              return;
            }
            // Swap just that style in place so the creator keeps the others.
            const replaced = next[0];
            if (replaced !== undefined) {
              setEdits((current) => ({ ...current, [replaced.id]: replaced.text }));
            }
            push({ title: `${HOOK_STYLE_LABELS[regenerateStyle]} hook rewritten`, tone: 'success' });
          },
          onError: (error) => {
            push({
              title: 'Could not write hooks',
              description: error instanceof Error ? error.message : 'Try again in a moment.',
              tone: 'danger',
            });
          },
          onSettled: () => setRegeneratingStyle(null),
        },
      );
    },
    [hooks, idea, push, setDraftIdea, trendId],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    generate();
  }

  /** "Use this" carries the chosen hook into Create. */
  function useSelected(): void {
    const chosen = list.find((hook) => hook.id === selectedId);
    if (chosen === undefined) return;
    setDraftIdea(edits[chosen.id] ?? chosen.text);
    // A chosen hook is the strongest signal the studio gets: the creator read
    // six options and picked this one. Recorded before navigating away.
    void trackSignal({
      kind: 'hook_chosen',
      label: edits[chosen.id] ?? chosen.text,
      source: 'hook-lab',
    });
    push({ title: 'Hook sent to Create', tone: 'success' });
    navigate('/create');
  }

  return (
    <>
      <PageHeader
        title="Hook Lab"
        description="Six openings for one idea, each in a different style. Pick one, edit it, or ask for a single style again."
        actions={<Badge tone="peach">Your DNA is injected</Badge>}
      />

      <Card className="mb-6">
        <CardHeader title="What is the video about?" description="One sentence is plenty." />
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3" aria-label="Generate hooks">
            <label htmlFor="hook-idea" className="block text-caption font-medium text-ink-900">
              Your idea
            </label>
            <textarea
              id="hook-idea"
              rows={3}
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="e.g. Explain binary search to someone who has never coded before"
              className="w-full resize-y rounded-lg border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={idea.trim().length === 0}
                loading={hooks.isPending === true && regeneratingStyle === null}
              >
                {list.length === 0 ? 'Write hooks' : 'Rewrite all styles'}
              </Button>
              {selectedId === null ? null : (
                <Button variant="secondary" onClick={useSelected}>
                  Use this hook
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {hooks.isPending === true ? (
        <Card>
          <CardContent>
            <LoadingState label="Writing hooks…" lines={5} />
          </CardContent>
        </Card>
      ) : hooks.isError === true ? (
        <ErrorState
          error={hooks.error}
          onRetry={() => {
            if (idea.trim().length > 0) generate();
          }}
        />
      ) : list.length === 0 ? (
        <EmptyHooks />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Generated hooks">
          {list.map((hook) => (
            <li key={hook.id}>
              <HookCard
                hook={hook}
                text={edits[hook.id] ?? hook.text}
                selected={hook.id === selectedId}
                regenerating={regeneratingStyle === hook.style}
                onSelect={() => setSelectedId(hook.id === selectedId ? null : hook.id)}
                onEdit={(text) => setEdits((current) => ({ ...current, [hook.id]: text }))}
                onRegenerate={() => generate(hook.style)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function HookCard({
  hook,
  text,
  selected,
  regenerating,
  onSelect,
  onEdit,
  onRegenerate,
}: {
  hook: Hook;
  text: string;
  selected: boolean;
  regenerating: boolean;
  onSelect: () => void;
  onEdit: (text: string) => void;
  onRegenerate: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card
      className={
        selected === true
          ? 'h-full border-peach-300 bg-peach-50 shadow-card-hover'
          : 'h-full border-line bg-surface'
      }
    >
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="peach">{HOOK_STYLE_LABELS[hook.style]}</Badge>
            {selected === true ? <Badge tone="success">Selected</Badge> : null}
          </span>
        }
        description={`Style: ${hook.style}`}
        action={
          <label className="flex items-center gap-2 text-caption text-ink-700">
            <input
              type="radio"
              name="selected-hook"
              checked={selected}
              onChange={onSelect}
              className="size-4 accent-peach-500"
            />
            Use
          </label>
        }
      />
      <CardContent className="space-y-3">
        {editing === true ? (
          <textarea
            aria-label={`Edit the ${HOOK_STYLE_LABELS[hook.style]} hook`}
            value={text}
            onChange={(event) => onEdit(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg border border-peach-300 bg-surface px-3 py-2 text-body text-ink-900 focus:outline-none"
          />
        ) : (
          <p className="text-body font-medium text-ink-900">{text}</p>
        )}

        <p className="text-caption text-ink-500">Why it works: {hook.whyItWorks}</p>

        <div className="flex flex-wrap gap-2">
          <CopyButton value={text} label={`Copy the ${HOOK_STYLE_LABELS[hook.style]} hook`} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
          >
            {editing === true ? 'Done' : 'Edit'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRegenerate} loading={regenerating}>
            Regenerate this style
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyHooks() {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-5 text-center">
        <h3 className="text-body-lg font-semibold text-ink-900">No hooks yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-caption text-ink-500">
          Describe your idea above and Hook Lab writes six openings in different styles - question,
          bold claim, POV, story, contrarian and curiosity gap.
        </p>
      </CardContent>
    </Card>
  );
}
