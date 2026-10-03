import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useUiStore } from '../store/useUiStore';

export function CreatePage() {
  const draftIdea = useUiStore((state) => state.draftIdea);
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);
  const { push } = useToast();
  const [idea, setIdea] = useState(draftIdea);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length === 0) return;
    setDraftIdea(trimmed);
    push({
      title: 'Idea saved',
      description: 'Script generation arrives in the next phase.',
      tone: 'success',
      duration: 4000,
    });
  }

  return (
    <>
      <PageHeader
        title="Create"
        description="Turn an idea into a finished 9:16 short: script, timed scenes, clips, voice-over, music and captions."
        actions={<Badge tone="peach">Pipeline ready in Phase 5</Badge>}
      />

      <Card className="mb-6">
        <CardHeader
          title="What is the video about?"
          description="The more specific the idea, the better the first script."
        />
        <CardContent className="pt-5">
          <form onSubmit={onSubmit} className="space-y-3">
            <label htmlFor="create-idea" className="sr-only">
              Video idea
            </label>
            <textarea
              id="create-idea"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={4}
              placeholder="e.g. Three signs your study routine is broken (and the fix)"
              className="w-full resize-y rounded-lg border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={idea.trim().length === 0}>
                Save idea
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled
                title="Script generation is wired up in Phase 3"
              >
                Generate script
              </Button>
              <Link
                to="/trends"
                className="text-caption font-medium text-peach-700 underline underline-offset-4 hover:text-peach-800"
              >
                or remix a trend instead
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="projects">
        <h2 id="projects" className="mb-3 text-body-lg font-semibold text-ink-900">
          Your projects
        </h2>
        <EmptyState
          title="No projects yet"
          description="Approved ideas become projects. Each project keeps its script, scenes, assets and the finished MP4."
          action={
            <Button variant="secondary" onClick={() => setIdea('')}>
              Clear the idea box
            </Button>
          }
        />
      </section>
    </>
  );
}
