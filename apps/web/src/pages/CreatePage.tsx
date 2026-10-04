import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../hooks/useToast';
import { startRender } from '../lib/render';
import { SHOWCASE_LIBRARY_ITEMS } from '../lib/studioFixtures';
import { useUiStore } from '../store/useUiStore';

const PIPELINE_STEPS = [
  { label: 'Creator DNA loaded', state: 'done' },
  { label: 'Trend remixed', state: 'done' },
  { label: 'Script generated', state: 'done' },
  { label: 'Audience checked', state: 'done' },
  { label: 'Generating scenes', state: 'active' },
  { label: 'Voice-over', state: 'pending' },
  { label: 'Music', state: 'pending' },
  { label: 'Captions', state: 'pending' },
  { label: 'Final render', state: 'pending' },
] as const;

export function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftIdea = useUiStore((state) => state.draftIdea);
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);
  const { push } = useToast();
  const urlPrompt = searchParams.get('prompt') ?? searchParams.get('idea') ?? '';
  const [idea, setIdea] = useState(
    urlPrompt.length > 0
      ? urlPrompt
      : draftIdea.length > 0
        ? draftIdea
        : 'POV: You finally understand Binary Search after 3 days 😅',
  );
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length === 0) return;
    setDraftIdea(trimmed);
    push({
      title: 'Idea saved',
      description: 'Ready to generate your 9:16 video.',
      tone: 'success',
      duration: 4000,
    });
  }

  async function handleGenerateVideo(): Promise<void> {
    const trimmed = idea.trim() || 'POV: You finally understand Binary Search after 3 days 😅';
    setDraftIdea(trimmed);
    setSubmitting(true);
    try {
      const accepted = await startRender({
        projectId: `proj_${Date.now().toString(36)}`,
        hook: trimmed.slice(0, 280),
        script: [
          { scene: 'Hook', text: trimmed.slice(0, 280) },
          {
            scene: 'Explanation',
            text: 'Binary search is a simple and efficient algorithm that helps us find an element in a sorted array in log n time.',
          },
          {
            scene: 'CTA',
            text: 'Save this for your next coding interview & follow for more!',
          },
        ],
        cta: 'Save this for your next coding interview & follow for more!',
        caption: `${trimmed.slice(0, 200)} ✨`,
        hashtags: ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'],
      });
      push({
        title: 'Creating your video...',
        description: `Render job ${accepted.jobId} started.`,
        tone: 'success',
      });
      navigate(`/render/${accepted.jobId}`);
    } catch {
      navigate('/render/demo-binary-search');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Create"
        description="Turn an idea into a finished 9:16 short: script, timed scenes, clips, voice-over, music and captions."
        actions={<Badge tone="success">Optimized for your DNA</Badge>}
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
              rows={3}
              placeholder="e.g. Three signs your study routine is broken (and the fix)"
              className="w-full resize-y rounded-xl border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="secondary" disabled={idea.trim().length === 0}>
                Save idea
              </Button>
              <Button
                type="button"
                loading={submitting}
                onClick={() => void handleGenerateVideo()}
              >
                ✨ Generate Video
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraftIdea(idea.trim());
                  navigate('/hooks');
                }}
              >
                Generate Hooks
              </Button>
              <Link
                to="/trends/remix"
                className="text-caption font-medium text-peach-700 underline underline-offset-4 hover:text-peach-800"
              >
                or remix a trend instead
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Screen 7 Preview Card: Creating your video... (72%) */}
      <Card className="mb-7">
        <CardHeader
          title="Creating your video..."
          description="This may take a few minutes. We'll notify you when it's ready."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate('/render/demo-binary-search/result')}
            >
              Open Final Content →
            </Button>
          }
        />
        <CardContent className="space-y-6 pt-4">
          <div className="flex items-center gap-4">
            <div className="h-3 flex-1 overflow-hidden rounded-pill bg-peach-100">
              <div
                className="h-full rounded-pill bg-gradient-to-r from-peach-400 to-peach-600"
                style={{ width: '72%' }}
              />
            </div>
            <span className="text-body font-bold tabular-nums text-ink-900">72%</span>
          </div>

          <div className="grid gap-6 md:grid-cols-[1.15fr_1fr]">
            <div className="space-y-2.5">
              {PIPELINE_STEPS.map((step) => (
                <div key={step.label} className="flex items-center gap-3 text-body">
                  {step.state === 'done' ? (
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-emerald-500 text-tiny font-bold text-white"
                    >
                      ✓
                    </span>
                  ) : step.state === 'active' ? (
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-pill border-2 border-info bg-info-soft"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-pill border border-ink-300 bg-surface"
                    />
                  )}
                  <span
                    className={
                      step.state === 'done'
                        ? 'font-medium text-ink-900'
                        : step.state === 'active'
                          ? 'font-bold text-info-strong'
                          : 'text-ink-500'
                    }
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface-muted/60 p-6 text-center">
              <div className="relative mb-4 flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500 to-indigo-600 text-display text-white shadow-card">
                <span aria-hidden="true">🎬</span>
                <span aria-hidden="true" className="absolute -right-2 -top-2 text-title">✨</span>
              </div>
              <p className="text-body-lg font-bold text-ink-900">
                Turning your idea into a video...
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => navigate('/render/demo-binary-search/result')}>
                  View Final Content
                </Button>
                <Button size="sm" variant="secondary" onClick={() => navigate('/publish')}>
                  Publish to Qoneqt
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="projects">
        <h2 id="projects" className="mb-3 text-body-lg font-semibold text-ink-900">
          Your projects
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHOWCASE_LIBRARY_ITEMS.slice(0, 2).map((item) => (
            <Link
              key={item.jobId}
              to={`/render/${item.jobId}/result`}
              className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-all hover:border-peach-300"
            >
              <img
                src={item.thumbnail}
                alt={item.title}
                className="h-16 w-24 shrink-0 rounded-xl object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-ink-900">{item.title}</p>
                <p className="mt-1 text-tiny text-ink-500">{item.statusLabel}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
