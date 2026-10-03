import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  audienceAgeRangeSchema,
  audienceTypeSchema,
  contentFormatSchema,
  type AudienceAgeRange,
  type AudienceType,
  type ContentFormat,
  type DnaOnboardingInput,
} from '@creatordna/shared';
import { Button } from '../components/Button';
import { Card, CardContent, CardFooter } from '../components/Card';
import { Chip } from '../components/Chip';
import { PageHeader } from '../components/PageHeader';
import { ProgressRing } from '../components/ProgressRing';
import { useToast } from '../hooks/useToast';
import { useExtractDna } from '../hooks/useDna';
import { motionTokens } from '../theme/tokens';
import { cn } from '../lib/cn';

/** Tone presets. Creators can always add their own words. */
const TONE_PRESETS = [
  'direct',
  'warm',
  'playful',
  'authoritative',
  'wry',
  'encouraging',
  'no-nonsense',
  'storyteller',
  'technical',
  'calm',
  'energetic',
  'blunt',
] as const;

const AUDIENCE_AGES = audienceAgeRangeSchema.options;
const AUDIENCE_TYPES = audienceTypeSchema.options;

const FORMAT_LABELS: Readonly<Record<ContentFormat, string>> = {
  'talking-head': 'Talking head',
  'b-roll-voiceover': 'B-roll + voiceover',
  'screen-recording': 'Screen recording',
  whiteboard: 'Whiteboard',
  listicle: 'Listicle',
  storytime: 'Storytime',
  tutorial: 'Tutorial',
  other: 'Something else',
};

const FORMATS = contentFormatSchema.options;

const STEPS = [
  { id: 'niche', title: 'Your niche', description: 'What do you make content about?' },
  { id: 'audience', title: 'Your audience', description: 'Who are you talking to?' },
  { id: 'tone', title: 'Your tone', description: 'How does it sound when you write?' },
  { id: 'format', title: 'Your format', description: 'How is it usually shot?' },
  { id: 'samples', title: 'Sample posts', description: 'Optional - the strongest signal we can get.' },
] as const;

const MAX_SAMPLE_POSTS = 10;

interface SampleRow {
  id: string;
  text: string;
  url: string;
}

/**
 * Onboarding wizard: five steps, one screen at a time, with a progress ring and
 * Motion transitions between steps. The final step hands everything to
 * `POST /dna/extract`.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const extract = useExtractDna();

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const [niche, setNiche] = useState('');
  const [audienceAgeRange, setAudienceAgeRange] = useState<AudienceAgeRange>('25-34');
  const [audienceType, setAudienceType] = useState<AudienceType>('beginners');
  const [audienceDescription, setAudienceDescription] = useState('');
  const [tone, setTone] = useState<string[]>([]);
  const [customTone, setCustomTone] = useState('');
  const [format, setFormat] = useState<ContentFormat>('talking-head');
  const [samples, setSamples] = useState<SampleRow[]>([
    { id: 'sample-0', text: '', url: '' },
  ]);

  const step = STEPS[stepIndex] ?? STEPS[0];
  const isLastStep = stepIndex === STEPS.length - 1;
  const progress = Math.round(((stepIndex + (isLastStep ? 1 : 0)) / STEPS.length) * 100);

  const filledSamples = useMemo(
    () =>
      samples
        .map((row) => ({
          text: row.text.trim(),
          url: row.url.trim().length > 0 ? row.url.trim() : undefined,
        }))
        .filter((row) => row.text.length > 0),
    [samples],
  );

  const stepError = useMemo(() => validateStep(step.id, {
    niche,
    tone,
    filledSamples,
  }), [step.id, niche, tone, filledSamples]);

  function goNext() {
    if (stepError !== null) return;
    if (isLastStep) {
      void submit();
      return;
    }
    setDirection(1);
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setDirection(-1);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  async function submit() {
    const input: DnaOnboardingInput = {
      niche: niche.trim(),
      audienceAgeRange,
      audienceType,
      audienceDescription: audienceDescription.trim().length > 0 ? audienceDescription.trim() : undefined,
      tone,
      format,
      samplePosts: filledSamples,
    };

    try {
      await extract.mutateAsync(input);
      push({
        title: 'Creator DNA saved',
        description: 'Every prompt from now on uses your profile.',
        tone: 'success',
      });
      navigate('/dna');
    } catch {
      push({
        title: 'Could not build your DNA',
        description: 'The model did not return a usable profile. Please try again.',
        tone: 'danger',
      });
    }
  }

  function toggleTone(word: string) {
    setTone((current) =>
      current.includes(word)
        ? current.filter((value) => value !== word)
        : current.length >= 6
          ? current
          : [...current, word],
    );
  }

  function addCustomTone() {
    const word = customTone.trim().toLowerCase();
    if (word.length === 0 || tone.includes(word) || tone.length >= 6) return;
    setTone((current) => [...current, word]);
    setCustomTone('');
  }

  function updateSample(id: string, patch: Partial<SampleRow>) {
    setSamples((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <>
      <PageHeader
        title="Build your Creator DNA"
        description="Five short steps. This profile is injected into every script, hook and caption we generate for you."
      />

      <div className="mb-6 flex items-center gap-5">
        <ProgressRing value={progress} label="Onboarding progress" size={72} thickness={7} />
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wider text-ink-300">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {STEPS.map((entry, index) => (
              <li
                key={entry.id}
                aria-current={index === stepIndex ? 'step' : undefined}
                className={cn(
                  'text-caption',
                  index === stepIndex
                    ? 'font-semibold text-peach-700'
                    : index < stepIndex
                      ? 'text-ink-500'
                      : 'text-ink-300',
                )}
              >
                {index < stepIndex ? '✓ ' : ''}
                {entry.title}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Card>
        <CardContent>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
            >
              <h2 className="text-body-lg font-semibold text-ink-900">{step.title}</h2>
              <p className="mb-5 mt-1 text-caption text-ink-500">{step.description}</p>
              {step.id === 'niche' ? (
                <div>
                  <label htmlFor="niche" className="mb-1.5 block text-caption font-medium text-ink-700">
                    Niche
                  </label>
                  <input
                    id="niche"
                    value={niche}
                    onChange={(event) => setNiche(event.target.value)}
                    placeholder="e.g. DSA interview prep for career switchers"
                    maxLength={120}
                    className="h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
                  />
                  <p className="mt-2 text-tiny text-ink-500">
                    Be specific. "Fitness" is vague; "home workouts for new parents" is a niche.
                  </p>
                </div>
              ) : null}

              {step.id === 'audience' ? (
                <div className="space-y-6">
                  <fieldset>
                    <legend className="mb-2 text-caption font-medium text-ink-700">
                      Age range
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {AUDIENCE_AGES.map((value) => (
                        <ChoiceChip
                          key={value}
                          selected={audienceAgeRange === value}
                          onSelect={() => setAudienceAgeRange(value)}
                        >
                          {value}
                        </ChoiceChip>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="mb-2 text-caption font-medium text-ink-700">
                      Who are they to you?
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {AUDIENCE_TYPES.map((value) => (
                        <ChoiceChip
                          key={value}
                          selected={audienceType === value}
                          onSelect={() => setAudienceType(value)}
                        >
                          {value}
                        </ChoiceChip>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <label
                      htmlFor="audience-description"
                      className="mb-1.5 block text-caption font-medium text-ink-700"
                    >
                      Describe them (optional)
                    </label>
                    <input
                      id="audience-description"
                      value={audienceDescription}
                      onChange={(event) => setAudienceDescription(event.target.value)}
                      placeholder="e.g. engineers who freeze in interviews"
                      maxLength={120}
                      className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
                    />
                  </div>
                </div>
              ) : null}

              {step.id === 'tone' ? (
                <div className="space-y-5">
                  <div>
                    <p className="mb-2 text-caption font-medium text-ink-700">
                      Pick up to 6 words that sound like you
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TONE_PRESETS.map((word) => (
                        <ChoiceChip
                          key={word}
                          selected={tone.includes(word)}
                          onSelect={() => toggleTone(word)}
                        >
                          {word}
                        </ChoiceChip>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[220px] flex-1">
                      <label
                        htmlFor="custom-tone"
                        className="mb-1.5 block text-caption font-medium text-ink-700"
                      >
                        Add your own word
                      </label>
                      <input
                        id="custom-tone"
                        value={customTone}
                        onChange={(event) => setCustomTone(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addCustomTone();
                          }
                        }}
                        placeholder="e.g. sardonic"
                        maxLength={40}
                        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
                      />
                    </div>
                    <Button type="button" variant="secondary" onClick={addCustomTone}>
                      Add word
                    </Button>
                  </div>

                  {tone.length > 0 ? (
                    <div>
                      <p className="mb-2 text-tiny uppercase tracking-wider text-ink-300">
                        Your tone ({tone.length}/6)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {tone.map((word) => (
                          <Chip
                            key={word}
                            selected
                            onRemove={() => toggleTone(word)}
                            removeLabel="Remove tone word"
                          >
                            {word}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step.id === 'format' ? (
                <fieldset>
                  <legend className="mb-2 text-caption font-medium text-ink-700">
                    Usual format
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {FORMATS.map((value) => (
                      <ChoiceCard
                        key={value}
                        selected={format === value}
                        onSelect={() => setFormat(value)}
                      >
                        {FORMAT_LABELS[value]}
                      </ChoiceCard>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {step.id === 'samples' ? (
                <div className="space-y-4">
                  <p className="text-caption text-ink-500">
                    Paste up to {MAX_SAMPLE_POSTS} posts you have written - captions, tweets, newsletter
                    intros. The extractor mirrors their rhythm in your profile.
                  </p>

                  {samples.map((row, index) => (
                    <div key={row.id} className="rounded-md border border-line bg-surface-muted p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-caption font-semibold text-ink-700">
                          Post {index + 1}
                        </span>
                        {samples.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSamples((rows) => rows.filter((entry) => entry.id !== row.id))
                            }
                            className="text-tiny text-ink-500 underline underline-offset-4 hover:text-danger"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <textarea
                        value={row.text}
                        onChange={(event) => updateSample(row.id, { text: event.target.value })}
                        rows={4}
                        maxLength={4000}
                        aria-label={`Sample post ${index + 1}`}
                        placeholder="Paste a post you wrote…"
                        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
                      />
                      <input
                        value={row.url}
                        onChange={(event) => updateSample(row.id, { url: event.target.value })}
                        aria-label={`Sample post ${index + 1} link`}
                        placeholder="Link (optional)"
                        className="mt-2 h-9 w-full rounded-md border border-line bg-surface px-3 text-caption text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-peach-300 focus:ring-2 focus:ring-peach-100"
                      />
                    </div>
                  ))}

                  {samples.length < MAX_SAMPLE_POSTS ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setSamples((rows) => [
                          ...rows,
                          { id: `sample-${rows.length}-${Date.now()}`, text: '', url: '' },
                        ])
                      }
                    >
                      Add another post
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </CardContent>

        <CardFooter className="justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={stepIndex === 0}>
            Back
          </Button>

          <div className="flex items-center gap-3">
            {stepError === null ? null : (
              <span role="alert" className="text-tiny text-danger">
                {stepError}
              </span>
            )}
            <Button type="button" onClick={goNext} loading={extract.isPending} disabled={stepError !== null}>
              {isLastStep ? 'Build my DNA' : 'Continue'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </>
  );
}

interface StepValues {
  niche: string;
  tone: readonly string[];
  filledSamples: readonly { text: string }[];
}

/** Inline validation per step, so the wizard never blocks a valid answer. */
function validateStep(stepId: string, values: StepValues): string | null {
  switch (stepId) {
    case 'niche':
      return values.niche.trim().length >= 2 ? null : 'Tell us your niche (at least 2 characters).';
    case 'tone':
      return values.tone.length > 0 ? null : 'Pick at least one tone word.';
    case 'samples':
      return values.filledSamples.length > MAX_SAMPLE_POSTS
        ? `Keep it to ${MAX_SAMPLE_POSTS} posts or fewer.`
        : null;
    default:
      return null;
  }
}

function ChoiceChip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'rounded-pill border px-3 py-1.5 text-caption transition-colors duration-150',
        selected === true
          ? 'border-peach-300 bg-peach-100 text-peach-800'
          : 'border-line bg-surface text-ink-700 hover:bg-peach-50',
      )}
    >
      {children}
    </button>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'rounded-md border px-4 py-3 text-left text-body transition-colors duration-150',
        selected === true
          ? 'border-peach-300 bg-peach-50 text-peach-800'
          : 'border-line bg-surface text-ink-700 hover:bg-peach-50',
      )}
    >
      {children}
    </button>
  );
}

/** Kept so the form submit handler type stays narrow. */
export type OnboardingSubmitEvent = FormEvent<HTMLFormElement>;
