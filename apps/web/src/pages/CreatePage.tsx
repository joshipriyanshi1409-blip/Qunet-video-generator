import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CONTENT_FORMATS,
  CONTENT_FORMATS_BY_CATEGORY,
  type ContentFormatCategory,
  type ContentFormatRecipe,
} from '@creatordna/shared';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader, CardFooter } from '../components/Card';
import { Chip } from '../components/Chip';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useUiStore } from '../store/useUiStore';
import { useDnaProfile } from '../hooks/useDna';
import { startRender } from '../lib/render';
import type { RenderCreateRequest } from '@creatordna/shared';

/** Format category display names. */
const CATEGORY_LABELS: Record<ContentFormatCategory, string> = {
  storytelling: 'Storytelling',
  education: 'Education & Knowledge',
  entertainment: 'Entertainment',
  lifestyle: 'Lifestyle',
  technology: 'Technology',
  business: 'Business & Finance',
  creative: 'Creative',
  wellness: 'Wellness',
};

const PACING_LABELS: Record<string, string> = {
  slow: 'Slow & immersive',
  moderate: 'Moderate pace',
  fast: 'Fast & dynamic',
  'very-fast': 'Very fast & chaotic',
};

/**
 * The Create page — full video creation pipeline.
 *
 * Connected to the backend render pipeline. The creator:
 * 1. Enters an idea
 * 2. Selects a content format (AI recommended or manual)
 * 3. Provides hook, script beats, and CTA
 * 4. Submits to the render pipeline
 *
 * The page manages a multi-step form with real validation and
 * connects to the WebSocket-powered progress screen on submit.
 */
export function CreatePage() {
  const navigate = useNavigate();
  const draftIdea = useUiStore((state) => state.draftIdea);
  const setDraftIdea = useUiStore((state) => state.setDraftIdea);
  const { push } = useToast();
  const dna = useDnaProfile();

  // Form state
  const [idea, setIdea] = useState(draftIdea);
  const [step, setStep] = useState<'idea' | 'format' | 'script' | 'submit'>('idea');
  const [formatMode, setFormatMode] = useState<'ai-recommended' | 'manual'>('ai-recommended');
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const [hook, setHook] = useState('');
  const [scriptBeats, setScriptBeats] = useState<Array<{ scene: string; text: string }>>([
    { scene: 'Hook', text: '' },
    { scene: 'Body', text: '' },
    { scene: 'CTA', text: '' },
  ]);
  const [cta, setCta] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // AI format recommendations
  const [recommendations, setRecommendations] = useState<
    Array<{ formatId: string; formatName: string; score: number; reason: string }>
  >([]);

  // Load DNA to inform recommendations
  useEffect(() => {
    if (draftIdea.length > 0 && idea.length === 0) setIdea(draftIdea);
  }, [draftIdea, idea]);

  // Generate AI recommendations based on topic + DNA
  const generateRecommendations = useCallback(() => {
    const topicLower = idea.toLowerCase();
    const dnaProfile = dna.data?.dna;

    // Score formats based on topic analysis
    const scored = CONTENT_FORMATS.map((format) => {
      let score = 50;

      // Category matching
      if (topicLower.includes('story') || topicLower.includes('narrative')) {
        if (format.category === 'storytelling') score += 20;
      }
      if (topicLower.includes('explain') || topicLower.includes('how') || topicLower.includes('tutorial')) {
        if (format.category === 'education') score += 20;
      }
      if (topicLower.includes('ai') || topicLower.includes('tech') || topicLower.includes('code')) {
        if (format.category === 'technology') score += 20;
      }
      if (topicLower.includes('money') || topicLower.includes('business') || topicLower.includes('finance')) {
        if (format.category === 'business') score += 20;
      }
      if (topicLower.includes('funny') || topicLower.includes('meme') || topicLower.includes('satisfying')) {
        if (format.category === 'entertainment') score += 20;
      }

      // DNA format alignment
      if (dnaProfile !== undefined) {
        const formatMap: Record<string, string[]> = {
          'talking-head': ['storytime', 'confession-stories', 'fitness'],
          'b-roll-voiceover': ['mini-documentaries', 'true-crime', 'history'],
          'screen-recording': ['tutorials', 'tech-explainers', 'gaming'],
          tutorial: ['tutorials', 'tech-explainers', 'life-hacks'],
          storytime: ['storytime', 'reddit-stories', 'confession-stories'],
          listicle: ['interesting-facts', 'did-you-know', 'hidden-facts'],
        };
        const matching = formatMap[dnaProfile.format] ?? [];
        if (matching.includes(format.id)) score += 15;
      }

      return {
        formatId: format.id,
        formatName: format.name,
        score: Math.min(98, score),
        reason: getRecommendationReason(format, topicLower),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    setRecommendations(scored.slice(0, 3));

    // Auto-select top recommendation
    const top = scored[0];
    if (top !== undefined) {
      setSelectedFormatId(top.formatId);
    }
  }, [idea, dna.data]);

  // Generate recommendations when idea changes and we're on format step
  useEffect(() => {
    if (step === 'format' && idea.trim().length > 0 && recommendations.length === 0) {
      generateRecommendations();
    }
  }, [step, idea, recommendations.length, generateRecommendations]);

  const selectedFormat = useMemo<ContentFormatRecipe | null>(
    () => CONTENT_FORMATS.find((f) => f.id === selectedFormatId) ?? null,
    [selectedFormatId],
  );

  function handleIdeaSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = idea.trim();
    if (trimmed.length === 0) return;
    setDraftIdea(trimmed);
    setStep('format');
  }

  function handleFormatSubmit(): void {
    if (selectedFormat === null) {
      push({ title: 'Select a format', description: 'Pick a content format for your video.', tone: 'warning' });
      return;
    }
    // Pre-fill script beats based on format structure
    if (scriptBeats.every((b) => b.text.length === 0)) {
      const beats = selectedFormat.structure.slice(0, 6).map((s) => ({
        scene: s.label,
        text: '',
      }));
      setScriptBeats(beats.length > 0 ? beats : [{ scene: 'Hook', text: '' }, { scene: 'Body', text: '' }, { scene: 'CTA', text: '' }]);
    }
    setStep('script');
  }

  function goToSubmit(): void {
    const validBeats = scriptBeats.filter((b) => b.text.trim().length > 0);
    if (validBeats.length === 0) {
      push({ title: 'Add script content', description: 'Write at least one scene.', tone: 'warning' });
      return;
    }
    setStep('submit');
  }

  async function handleRenderSubmit(): Promise<void> {
    if (selectedFormat === null) return;

    const validBeats = scriptBeats.filter((b) => b.text.trim().length > 0);
    if (validBeats.length === 0) {
      push({ title: 'Script is empty', tone: 'warning' });
      return;
    }

    setSubmitting(true);

    const renderPayload: RenderCreateRequest = {
      projectId: `proj-${Date.now()}`,
      hook: hook.trim().length > 0 ? hook.trim() : validBeats[0]?.text.trim() ?? idea.trim(),
      script: validBeats.map((b) => ({ scene: b.scene, text: b.text.trim() })),
      cta: cta.trim().length > 0 ? cta.trim() : 'Follow for more',
      caption: caption.trim().length > 0 ? caption.trim() : undefined,
      hashtags: hashtags.filter((t) => t.length > 0),
      dnaVersion: dna.data?.dna.dnaVersion,
      contentFormatId: selectedFormat?.id,
    };

    try {
      const job = await startRender(renderPayload);
      push({
        title: 'Render started!',
        description: `Job ${job.jobId} is ${job.state}. Following the progress...`,
        tone: 'success',
      });
      navigate(`/render/${job.jobId}`);
    } catch (error) {
      push({
        title: 'Could not start render',
        description: error instanceof Error ? error.message : 'Check that the API is running and Redis is available.',
        tone: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Create"
        description="Turn an idea into a finished 9:16 short: script, timed scenes, clips, voice-over, music and captions."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="peach">Step {stepIndex(step)} of 4</Badge>
            {dna.data !== undefined ? (
              <Badge tone="success">DNA loaded</Badge>
            ) : (
              <Badge tone="neutral">No DNA</Badge>
            )}
          </div>
        }
      />

      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {(['idea', 'format', 'script', 'submit'] as const).map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              // Only allow going back to completed steps
              if (i < stepIndex(step)) setStep(s);
            }}
            className={`flex items-center gap-2 rounded-pill px-3 py-1.5 text-caption font-medium transition-colors ${
              s === step
                ? 'bg-peach-100 text-peach-800 border border-peach-300'
                : i < stepIndex(step)
                  ? 'bg-surface-muted text-ink-700 border border-line hover:bg-peach-50 cursor-pointer'
                  : 'bg-surface-muted text-ink-300 border border-line'
            }`}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-peach-200 text-tiny font-bold text-peach-800">
              {i + 1}
            </span>
            {stepLabel(s)}
          </button>
        ))}
      </div>

      {/* Step 1: Idea */}
      {step === 'idea' ? (
        <Card className="mb-6">
          <CardHeader
            title="What is the video about?"
            description="The more specific the idea, the better the output. Include the topic, angle, and target audience if you can."
          />
          <CardContent className="pt-5">
            <form onSubmit={handleIdeaSubmit} className="space-y-3">
              <label htmlFor="create-idea" className="sr-only">
                Video idea
              </label>
              <textarea
                id="create-idea"
                value={idea}
                onChange={(event) => setIdea(event.target.value)}
                rows={4}
                placeholder="e.g. Explain why AI agents are changing software development — for beginner developers who are curious but overwhelmed"
                className="w-full resize-y rounded-lg border border-line bg-surface-muted px-4 py-3 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={idea.trim().length === 0}>
                  Continue to format selection
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
      ) : null}

      {/* Step 2: Format Selection */}
      {step === 'format' ? (
        <div className="space-y-6">
          <Card className="mb-4">
            <CardHeader
              title="Choose your content format"
              description={`Your idea: "${idea.trim().slice(0, 100)}${idea.trim().length > 100 ? '...' : ''}"`}
            />
            <CardContent className="pt-5">
              <div className="mb-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormatMode('ai-recommended')}
                  className={`rounded-pill px-4 py-2 text-caption font-medium border transition-colors ${
                    formatMode === 'ai-recommended'
                      ? 'bg-peach-100 border-peach-300 text-peach-800'
                      : 'bg-surface border-line text-ink-700 hover:bg-peach-50'
                  }`}
                >
                  ✨ AI Recommended
                </button>
                <button
                  type="button"
                  onClick={() => setFormatMode('manual')}
                  className={`rounded-pill px-4 py-2 text-caption font-medium border transition-colors ${
                    formatMode === 'manual'
                      ? 'bg-peach-100 border-peach-300 text-peach-800'
                      : 'bg-surface border-line text-ink-700 hover:bg-peach-50'
                  }`}
                >
                  Browse all 50 formats
                </button>
              </div>

              {formatMode === 'ai-recommended' ? (
                <div className="space-y-3">
                  {recommendations.length === 0 ? (
                    <LoadingState label="Analyzing best formats for your idea..." lines={3} />
                  ) : (
                    <ul className="space-y-3">
                      {recommendations.map((rec, i) => (
                        <li key={rec.formatId}>
                          <button
                            type="button"
                            onClick={() => setSelectedFormatId(rec.formatId)}
                            className={`w-full rounded-lg border p-4 text-left transition-colors ${
                              selectedFormatId === rec.formatId
                                ? 'border-peach-300 bg-peach-50'
                                : 'border-line bg-surface hover:border-peach-200 hover:bg-peach-50/50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="flex size-6 items-center justify-center rounded-full bg-peach-200 text-tiny font-bold text-peach-800">
                                    {i + 1}
                                  </span>
                                  <span className="text-body font-semibold text-ink-900">{rec.formatName}</span>
                                </div>
                                <p className="mt-1 ml-8 text-caption text-ink-500">{rec.reason}</p>
                              </div>
                              <Badge tone={rec.score >= 70 ? 'success' : rec.score >= 50 ? 'peach' : 'neutral'}>
                                {rec.score}% match
                              </Badge>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <FormatBrowser selectedId={selectedFormatId} onSelect={setSelectedFormatId} />
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={handleFormatSubmit} disabled={selectedFormat === null}>
                  Continue to script
                </Button>
                <Button variant="ghost" onClick={() => setStep('idea')}>
                  ← Back
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Format details card */}
          {selectedFormat !== null ? (
            <Card className="border-peach-200 bg-peach-50/50">
              <CardHeader
                title={selectedFormat.name}
                description={selectedFormat.description}
                action={<Badge tone="peach">{CATEGORY_LABELS[selectedFormat.category]}</Badge>}
              />
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-tiny uppercase tracking-wide text-ink-500">Pacing</p>
                    <p className="text-caption font-medium text-ink-700">{PACING_LABELS[selectedFormat.pacing]}</p>
                  </div>
                  <div>
                    <p className="text-tiny uppercase tracking-wide text-ink-500">Duration</p>
                    <p className="text-caption font-medium text-ink-700">
                      {selectedFormat.recommendedDuration.min}-{selectedFormat.recommendedDuration.max}s (default {selectedFormat.recommendedDuration.default}s)
                    </p>
                  </div>
                  <div>
                    <p className="text-tiny uppercase tracking-wide text-ink-500">Structure</p>
                    <ol className="mt-1 list-decimal pl-4 text-caption text-ink-700">
                      {selectedFormat.structure.map((s) => (
                        <li key={s.label}>{s.label}</li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-tiny uppercase tracking-wide text-ink-500">Style</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Chip>{selectedFormat.visualStyle}</Chip>
                      <Chip>{selectedFormat.narrationStyle}</Chip>
                      <Chip>{selectedFormat.captionStyle}</Chip>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Step 3: Script */}
      {step === 'script' ? (
        <Card className="mb-6">
          <CardHeader
            title="Write your script"
            description={
              selectedFormat !== null
                ? `Follow the ${selectedFormat.name} structure: ${selectedFormat.structure.map((s) => s.label).join(' → ')}`
                : 'Write each scene of your video.'
            }
          />
          <CardContent className="space-y-4 pt-5">
            <div>
              <label htmlFor="hook" className="mb-1 block text-caption font-medium text-ink-700">
                Hook (first line viewers see)
              </label>
              <input
                id="hook"
                value={hook}
                onChange={(event) => setHook(event.target.value)}
                maxLength={300}
                placeholder="e.g. Here's why AI agents are about to change everything..."
                className="w-full rounded-lg border border-line bg-surface-muted px-4 py-2.5 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
              />
            </div>

            <div className="space-y-3">
              <p className="text-caption font-medium text-ink-700">Script scenes</p>
              {scriptBeats.map((beat, index) => (
                <div key={index} className="flex gap-3">
                  <div className="w-32 shrink-0">
                    <input
                      value={beat.scene}
                      onChange={(event) => {
                        const next = [...scriptBeats];
                        next[index] = { ...beat, scene: event.target.value };
                        setScriptBeats(next);
                      }}
                      placeholder="Scene label"
                      className="w-full rounded-lg border border-line bg-surface-muted px-3 py-2 text-caption text-ink-900 placeholder:text-ink-300"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <textarea
                      value={beat.text}
                      onChange={(event) => {
                        const next = [...scriptBeats];
                        next[index] = { ...beat, text: event.target.value };
                        setScriptBeats(next);
                      }}
                      rows={2}
                      placeholder={`What happens in "${beat.scene}"...`}
                      className="w-full resize-y rounded-lg border border-line bg-surface-muted px-3 py-2 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
                    />
                  </div>
                  {scriptBeats.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setScriptBeats(scriptBeats.filter((_, i) => i !== index))}
                      className="mt-1 shrink-0 text-ink-300 hover:text-danger-500"
                      aria-label={`Remove scene ${index + 1}`}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setScriptBeats([...scriptBeats, { scene: `Scene ${scriptBeats.length + 1}`, text: '' }])}
                className="text-caption font-medium text-peach-700 hover:text-peach-800 hover:underline"
              >
                + Add scene
              </button>
            </div>

            <div>
              <label htmlFor="cta" className="mb-1 block text-caption font-medium text-ink-700">
                Call to action
              </label>
              <input
                id="cta"
                value={cta}
                onChange={(event) => setCta(event.target.value)}
                maxLength={300}
                placeholder="e.g. Follow for more AI insights"
                className="w-full rounded-lg border border-line bg-surface-muted px-4 py-2.5 text-body text-ink-900 placeholder:text-ink-300 focus:bg-surface"
              />
            </div>

            <details className="rounded-lg border border-line bg-surface-muted p-3">
              <summary className="cursor-pointer text-caption font-medium text-ink-700">
                Advanced: caption and hashtags
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="caption" className="mb-1 block text-tiny text-ink-500">
                    Post caption
                  </label>
                  <textarea
                    id="caption"
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={3}
                    maxLength={600}
                    placeholder="What goes with the video when you post it..."
                    className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-body text-ink-900 placeholder:text-ink-300"
                  />
                </div>
                <div>
                  <label htmlFor="hashtags" className="mb-1 block text-tiny text-ink-500">
                    Hashtags (comma separated)
                  </label>
                  <input
                    id="hashtags"
                    value={hashtags.join(', ')}
                    onChange={(event) =>
                      setHashtags(
                        event.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter((t) => t.length > 0),
                      )
                    }
                    placeholder="#ai #tech #development"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-body text-ink-900 placeholder:text-ink-300"
                  />
                </div>
              </div>
            </details>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={goToSubmit}>
                Preview & render
              </Button>
              <Button variant="ghost" onClick={() => setStep('format')}>
                ← Back
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Step 4: Review & Submit */}
      {step === 'submit' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Review your video"
              description="Check everything before starting the render pipeline."
            />
            <CardContent className="space-y-4 pt-5">
              <ReviewSection label="Idea" value={idea.trim()} />
              {selectedFormat !== null ? (
                <ReviewSection label="Format" value={`${selectedFormat.name} (${selectedFormat.category})`} />
              ) : null}
              {hook.trim().length > 0 ? (
                <ReviewSection label="Hook" value={hook.trim()} />
              ) : null}
              <ReviewSection
                label={`Script (${scriptBeats.filter((b) => b.text.trim().length > 0).length} scenes)`}
                value={scriptBeats
                  .filter((b) => b.text.trim().length > 0)
                  .map((b) => `${b.scene}: ${b.text.trim().slice(0, 80)}${b.text.trim().length > 80 ? '...' : ''}`)
                  .join('\n')}
              />
              {cta.trim().length > 0 ? (
                <ReviewSection label="CTA" value={cta.trim()} />
              ) : null}
              {caption.trim().length > 0 ? (
                <ReviewSection label="Caption" value={caption.trim()} />
              ) : null}
              {hashtags.length > 0 ? (
                <div>
                  <p className="text-tiny uppercase tracking-wide text-ink-500">Hashtags</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {hashtags.map((tag) => (
                      <Chip key={tag}>{tag}</Chip>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-peach-200 bg-peach-50 p-4">
                <p className="text-caption font-medium text-peach-800">
                  {dna.data !== undefined
                    ? `✅ Your Creator DNA will be injected into every stage (v${dna.data.dna.dnaVersion})`
                    : '⚠️ No Creator DNA found — the video will be generated without your personal style. Complete onboarding to add your DNA.'}
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void handleRenderSubmit()} loading={submitting}>
                  🎬 Start rendering
                </Button>
                <Button variant="ghost" onClick={() => setStep('script')}>
                  ← Edit script
                </Button>
              </div>
              <p className="text-caption text-ink-500">
                The pipeline runs in the background with live progress. Each stage can be retried independently.
              </p>
            </CardFooter>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function stepIndex(step: string): number {
  const map: Record<string, number> = { idea: 1, format: 2, script: 3, submit: 4 };
  return map[step] ?? 1;
}

function stepLabel(step: string): string {
  const map: Record<string, string> = { idea: 'Idea', format: 'Format', script: 'Script', submit: 'Render' };
  return map[step] ?? step;
}

function ReviewSection({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <p className="text-tiny uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-body text-ink-900">{value}</p>
    </div>
  );
}

function FormatBrowser({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [activeCategory, setActiveCategory] = useState<ContentFormatCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const categories = Object.keys(CONTENT_FORMATS_BY_CATEGORY) as ContentFormatCategory[];

  const filteredFormats = useMemo(() => {
    let formats = CONTENT_FORMATS;
    if (activeCategory !== 'all') {
      formats = formats.filter((f) => f.category === activeCategory);
    }
    if (search.trim().length > 0) {
      const lower = search.toLowerCase();
      formats = formats.filter(
        (f) =>
          f.name.toLowerCase().includes(lower) ||
          f.description.toLowerCase().includes(lower) ||
          f.category.toLowerCase().includes(lower),
      );
    }
    return formats;
  }, [activeCategory, search]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search 50 formats..."
        className="w-full rounded-pill border border-line bg-surface px-4 py-2 text-body text-ink-900 placeholder:text-ink-300"
      />
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`rounded-pill px-3 py-1 text-tiny font-medium border transition-colors ${
            activeCategory === 'all' ? 'bg-peach-100 border-peach-300 text-peach-800' : 'border-line bg-surface text-ink-600 hover:bg-peach-50'
          }`}
        >
          All ({CONTENT_FORMATS.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`rounded-pill px-3 py-1 text-tiny font-medium border transition-colors ${
              activeCategory === cat ? 'bg-peach-100 border-peach-300 text-peach-800' : 'border-line bg-surface text-ink-600 hover:bg-peach-50'
            }`}
          >
            {CATEGORY_LABELS[cat]} ({CONTENT_FORMATS_BY_CATEGORY[cat]?.length ?? 0})
          </button>
        ))}
      </div>
      <div className="grid gap-2 max-h-80 overflow-y-auto pr-1 sm:grid-cols-2">
        {filteredFormats.map((format) => (
          <button
            key={format.id}
            type="button"
            onClick={() => onSelect(format.id)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              selectedId === format.id
                ? 'border-peach-300 bg-peach-50'
                : 'border-line bg-surface hover:border-peach-200 hover:bg-peach-50/30'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-semibold text-ink-900">{format.name}</span>
              {selectedId === format.id ? <Badge tone="success" compact>Selected</Badge> : null}
            </div>
            <p className="mt-0.5 line-clamp-2 text-tiny text-ink-500">{format.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function getRecommendationReason(format: ContentFormatRecipe, topicLower: string): string {
  if (topicLower.includes('ai') || topicLower.includes('agent') || topicLower.includes('software')) {
    if (format.id === 'mini-documentaries') return 'Perfect for deep-diving into how AI agents work';
    if (format.id === 'ai-content') return 'Directly covers AI topics with the right audience';
    if (format.id === 'tech-explainers') return 'Great for explaining technical concepts clearly';
  }
  if (topicLower.includes('story') || topicLower.includes('narrative')) {
    return 'Matches the narrative structure of your idea';
  }
  if (topicLower.includes('explain') || topicLower.includes('how') || topicLower.includes('tutorial')) {
    return 'Educational format fits your learning-focused topic';
  }
  return `Good fit with ${format.pacing} pacing for ${format.category} content`;
}
