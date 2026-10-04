import { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  type AudienceAgeRange,
  type ContentFormat,
  type CreatorDna,
  type DnaUpdateRequest,
} from '@creatordna/shared';
import { Button } from '../components/Button';
import { Card, CardContent, CardFooter, CardHeader } from '../components/Card';
import { Chip } from '../components/Chip';
import { SuggestedUpdates } from '../components/dna/SuggestedUpdates';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { ProgressRing } from '../components/ProgressRing';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useToast } from '../hooks/useToast';
import { useDnaProfile, useUpdateDna } from '../hooks/useDna';
import { motionTokens } from '../theme/tokens';
import { cn } from '../lib/cn';

const AGE_LABELS: Readonly<Record<AudienceAgeRange, string>> = {
  '13-17': '13-17',
  '18-24': '18-24',
  '25-34': '25-34',
  '35-44': '35-44',
  '45-54': '45-54',
  '55+': '55+',
};

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

/**
 * My DNA: the creator's persistent profile.
 *
 * The sync ring blends completeness (how much is filled in) and consistency
 * (whether the sample posts agree with the declared vocabulary), both computed
 * by `computeDnaSyncScore` in `@creatordna/shared` so the browser and the API
 * always agree.
 */
export function MyDNAPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const query = useDnaProfile();
  const update = useUpdateDna();
  const [editing, setEditing] = useState(false);

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="My DNA" description="Loading your profile…" />
        <LoadingState lines={5} />
      </>
    );
  }

  if (query.isError) {
    const error = query.error;
    const notOnboarded =
      typeof error === 'object' && error !== null && 'status' in error && error.status === 404;

    if (notOnboarded) {
      return (
        <>
          <PageHeader title="My DNA" description="One persistent profile, injected into every prompt." />
          <Card>
            <CardContent className="py-10">
              <EmptyState
                title="No Creator DNA yet"
                description="Answer five short questions and we will turn them into a profile that every script, hook and caption is written against."
                action={
                  <Button type="button" onClick={() => navigate('/onboarding')}>
                    Start onboarding
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </>
      );
    }

    return (
      <>
        <PageHeader title="My DNA" />
        <ErrorState error={error} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const profile = query.data;
  if (profile === undefined) {
    return (
      <>
        <PageHeader title="My DNA" />
        <LoadingState lines={4} />
      </>
    );
  }

  const { dna, score } = profile;

  return (
    <>
      <PageHeader
        title="Your Creator DNA"
        description="This is what makes your content, your content. Based on your inputs, previous posts and preferences."
        actions={
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit DNA
          </Button>
        }
      />

      {/* --- Screen 2 Hero Row: Multi-Segment DNA Sync Ring + Trend Remix Card --- */}
      <div className="mb-6 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:items-center">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: motionTokens.slow, ease: motionTokens.ease }}
              className="relative flex items-center justify-center"
            >
              {/* Multi-color decorative halo around the accessible ProgressRing */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute size-[148px] -rotate-90"
                viewBox="0 0 148 148"
              >
                <circle cx="74" cy="74" r="66" fill="none" stroke="#2e9e63" strokeWidth="6" strokeDasharray="100 320" strokeLinecap="round" />
                <circle cx="74" cy="74" r="66" fill="none" stroke="#ff7f55" strokeWidth="6" strokeDasharray="110 320" strokeDashoffset="-105" strokeLinecap="round" />
                <circle cx="74" cy="74" r="66" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeDasharray="95 320" strokeDashoffset="-220" strokeLinecap="round" />
                <circle cx="74" cy="74" r="66" fill="none" stroke="#3b7dd8" strokeWidth="6" strokeDasharray="85 320" strokeDashoffset="-320" strokeLinecap="round" />
              </svg>
              <ProgressRing value={score.score} label="DNA sync" size={132} thickness={11} />
            </motion.div>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h2 className="text-title font-semibold text-ink-900">DNA sync {score.score}%</h2>
              <p className="mt-1 text-body text-ink-500">
                {score.score === 100
                  ? 'Your profile is complete and consistent - every prompt uses it.'
                  : 'Complete your profile so every prompt sounds like you.'}
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Complete" value={`${score.completeness}%`} />
                <Metric label="Consistent" value={`${score.consistency}%`} />
                <Metric label="Version" value={String(dna.dnaVersion)} />
                <Metric label="Context" value={`${profile.contextTokens} tok`} />
              </dl>

              {score.missingFields.length > 0 ? (
                <p className="mt-4 text-caption text-ink-500">
                  <span className="font-medium text-ink-700">Still missing: </span>
                  {score.missingFields.join(', ')}.
                </p>
              ) : null}

              {score.inconsistencies.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {score.inconsistencies.map((issue) => (
                    <li key={issue} className="text-caption text-warning-strong">
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col justify-between border-peach-200 bg-gradient-to-br from-surface to-peach-50/70">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-xl bg-info-soft text-body-lg text-info-strong"
              >
                ✨
              </span>
              <h3 className="text-body-lg font-bold text-ink-900">Trend Remix</h3>
            </div>
            <p className="mt-3 text-body text-ink-700">
              Based on your inputs, previous posts and preferences.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('/trends/remix')}>
                Explore Trends
              </Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('/dna/history')}>
                Version history
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- 3 Pillar Summary Cards: Content (94%) / Audience (88%) / Style (90%) --- */}
      <ul className="mb-6 grid gap-4 sm:grid-cols-3">
        <li>
          <Card className="h-full">
            <CardHeader
              title="Content"
              description="What you make and how."
              action={
                <span className="rounded-pill bg-info-soft px-2.5 py-0.5 text-caption font-bold text-info-strong">
                  (94%)
                </span>
              }
            />
            <CardContent>
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-info-soft/50 px-3 py-2">
                <span aria-hidden="true">👤</span>
                <span className="text-caption font-semibold text-ink-900">{dna.niche}</span>
              </div>
              <DefinitionList
                rows={[
                  { label: 'Niche', value: dna.niche },
                  { label: 'Format', value: FORMAT_LABELS[dna.format] },
                  {
                    label: 'Vocabulary',
                    value: dna.vocabulary.length > 0 ? dna.vocabulary.join(', ') : '—',
                  },
                  {
                    label: 'Catchphrases',
                    value: dna.catchphrases.length > 0 ? dna.catchphrases.join(', ') : '—',
                  },
                ]}
              />
            </CardContent>
          </Card>
        </li>

        <li>
          <Card className="h-full">
            <CardHeader
              title="Audience"
              description="Who you are talking to."
              action={
                <span className="rounded-pill bg-success-soft px-2.5 py-0.5 text-caption font-bold text-success-strong">
                  (88%)
                </span>
              }
            />
            <CardContent>
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-success-soft/50 px-3 py-2">
                <span aria-hidden="true">👥</span>
                <span className="text-caption font-semibold text-ink-900">
                  {AGE_LABELS[dna.audienceAgeRange]}
                </span>
              </div>
              <DefinitionList
                rows={[
                  {
                    label: 'Segments',
                    value: dna.audience.length > 0 ? dna.audience.join(', ') : '—',
                  },
                  { label: 'Age range', value: AGE_LABELS[dna.audienceAgeRange] },
                  { label: 'Type', value: dna.audienceType },
                ]}
              />
            </CardContent>
          </Card>
        </li>

        <li>
          <Card className="h-full">
            <CardHeader
              title="Style"
              description="Pacing, personality, rules."
              action={
                <span className="rounded-pill bg-peach-100 px-2.5 py-0.5 text-caption font-bold text-peach-800">
                  (90%)
                </span>
              }
            />
            <CardContent>
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-peach-50 px-3 py-2">
                <span aria-hidden="true">☀️</span>
                <span className="text-caption font-semibold text-ink-900">{dna.style}</span>
              </div>
              <DefinitionList
                rows={[
                  { label: 'Style', value: dna.style },
                  {
                    label: 'Personality',
                    value: dna.personality.length > 0 ? dna.personality.join(', ') : '—',
                  },
                  { label: 'Always', value: dna.dos.length > 0 ? dna.dos.join(', ') : '—' },
                  { label: 'Never', value: dna.donts.length > 0 ? dna.donts.join(', ') : '—' },
                ]}
              />
            </CardContent>
          </Card>
        </li>
      </ul>

      {/* --- Screen 2: Based on your previous content (4 stats row) --- */}
      <section aria-labelledby="previous-content-stats" className="mb-6">
        <h3 id="previous-content-stats" className="mb-3 text-body font-bold text-ink-900">
          Based on your previous content
        </h3>
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-body-lg">🎬</span>
              <span className="text-title font-bold text-ink-900">12</span>
            </div>
            <p className="mt-1.5 text-tiny text-ink-500">Reels/Videos posts analyzed</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-body-lg">💡</span>
              <span className="text-title font-bold text-ink-900">8</span>
            </div>
            <p className="mt-1.5 text-tiny text-ink-500">Preferred hooks</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-body-lg">🔄</span>
              <span className="text-title font-bold text-ink-900">4</span>
            </div>
            <p className="mt-1.5 text-tiny text-ink-500">Recurring topics</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-body-lg">🎯</span>
              <span className="text-title font-bold text-ink-900">High</span>
            </div>
            <p className="mt-1.5 text-tiny text-ink-500">Engagement with educational content</p>
          </div>
        </div>
      </section>

      <div className="mb-6 flex items-center justify-center gap-2 rounded-2xl border border-peach-200 bg-peach-50 px-4 py-3 text-caption font-medium text-peach-800">
        <span aria-hidden="true">💡</span>
        <span>Your DNA helps us create content that truly feels like you!</span>
        <span aria-hidden="true">🤍</span>
      </div>

      {/* --- your content style --------------------------------------------- */}
      <Card className="mb-6">
        <CardHeader
          title="Your Content Style"
          description="The shortlist every prompt is written against."
        />
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StyleTile label="Tone" values={dna.tone} />
            <StyleTile label="Format" values={[FORMAT_LABELS[dna.format]]} />
            <StyleTile label="Niche" values={[dna.niche]} />
            <StyleTile label="Personality" values={dna.personality} />
          </ul>
        </CardContent>
        <CardFooter>
          <p className="text-tiny text-ink-500">
            Injected context is {profile.contextTokens} tokens - it stays small so it never crowds out
            your idea.
          </p>
        </CardFooter>
      </Card>

      {/* --- sample posts ---------------------------------------------------- */}
      {dna.samplePosts.length > 0 ? (
        <Card className="mb-6">
          <CardHeader
            title="Sample posts"
            description={`${dna.samplePosts.length} post(s) the extractor learned your rhythm from.`}
          />
          <CardContent>
            <ul className="space-y-3">
              {dna.samplePosts.map((post, index) => (
                <li
                  key={`${index}-${post.text.slice(0, 24)}`}
                  className="rounded-md border border-line bg-surface-muted px-4 py-3"
                >
                  <p className="text-body text-ink-700">{post.text}</p>
                  {post.url === undefined ? null : (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-block text-tiny text-peach-700 underline underline-offset-4"
                    >
                      {post.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* --- the learning loop ---------------------------------------------- */}
      {/* Proposals from the creator's own choices. Sits above the history link
          because "should I change anything?" is the question this page now
          answers, and the answer is only useful next to the suggestions. */}
      <div className="mb-6">
        <SuggestedUpdates />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0">
            <p className="text-body font-semibold text-ink-900">Ready to create?</p>
            <p className="mt-1 text-caption text-ink-500">
              Your DNA is now part of every generation. Start with an idea or a trend.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => navigate('/dna/history')}>
              Version history
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/onboarding')}>
              Re-run onboarding
            </Button>
            <Button type="button" onClick={() => navigate('/create')}>
              Create a video
            </Button>
          </div>
        </CardContent>
      </Card>

      {editing === true ? (
        <EditDnaModal
          dna={dna}
          pending={update.isPending}
          onClose={() => setEditing(false)}
          onSave={async (patch) => {
            try {
              await update.mutateAsync(patch);
              setEditing(false);
              push({ title: 'DNA updated', description: 'Your profile was saved.', tone: 'success' });
            } catch {
              push({
                title: 'Could not save',
                description: 'Please try again in a moment.',
                tone: 'danger',
              });
            }
          }}
        />
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
      <dt className="text-tiny uppercase tracking-wider text-ink-300">{label}</dt>
      <dd className="mt-0.5 text-body font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function DefinitionList({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-tiny uppercase tracking-wider text-ink-300">{row.label}</dt>
          <dd className="mt-0.5 text-body text-ink-700">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StyleTile({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <li className="rounded-md border border-line bg-surface-muted p-4">
      <p className="text-tiny uppercase tracking-wider text-ink-300">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.length === 0 ? (
          <span className="text-caption text-ink-300">—</span>
        ) : (
          values.map((value) => (
            <Chip key={value} selected>
              {value}
            </Chip>
          ))
        )}
      </div>
    </li>
  );
}

/** Modal for editing the DNA. Only the fields the creator can reason about. */
function EditDnaModal({
  dna,
  pending,
  onClose,
  onSave,
}: {
  dna: CreatorDna;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: DnaUpdateRequest) => Promise<void>;
}) {
  const [niche, setNiche] = useState(dna.niche);
  const [style, setStyle] = useState(dna.style);
  const [tone, setTone] = useState(dna.tone.join(', '));
  const [audience, setAudience] = useState(dna.audience.join(', '));
  const [personality, setPersonality] = useState(dna.personality.join(', '));
  const [vocabulary, setVocabulary] = useState(dna.vocabulary.join(', '));
  const [catchphrases, setCatchphrases] = useState(dna.catchphrases.join(', '));
  const [dos, setDos] = useState(dna.dos.join(', '));
  const [donts, setDonts] = useState(dna.donts.join(', '));

  function split(value: string): string[] {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit your DNA"
      description="Changes are versioned, so you can always see what changed."
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={pending}
            onClick={() =>
              void onSave({
                niche: niche.trim(),
                style: style.trim(),
                tone: split(tone),
                audience: split(audience),
                personality: split(personality),
                vocabulary: split(vocabulary),
                catchphrases: split(catchphrases),
                dos: split(dos),
                donts: split(donts),
              })
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextArea
          id="edit-niche"
          label="Niche"
          value={niche}
          onChange={setNiche}
          rows={1}
        />
        <TextArea
          id="edit-style"
          label="Style"
          value={style}
          onChange={setStyle}
          rows={3}
        />
        <TextArea
          id="edit-tone"
          label="Tone (comma separated)"
          value={tone}
          onChange={setTone}
          rows={1}
        />
        <TextArea
          id="edit-audience"
          label="Audience segments (comma separated)"
          value={audience}
          onChange={setAudience}
          rows={2}
        />
        <TextArea
          id="edit-personality"
          label="Personality (comma separated)"
          value={personality}
          onChange={setPersonality}
          rows={1}
        />
        <TextArea
          id="edit-vocabulary"
          label="Vocabulary (comma separated)"
          value={vocabulary}
          onChange={setVocabulary}
          rows={2}
        />
        <TextArea
          id="edit-catchphrases"
          label="Catchphrases (comma separated)"
          value={catchphrases}
          onChange={setCatchphrases}
          rows={1}
        />
        <TextArea
          id="edit-dos"
          label="Always do (comma separated)"
          value={dos}
          onChange={setDos}
          rows={2}
        />
        <TextArea
          id="edit-donts"
          label="Never do (comma separated)"
          value={donts}
          onChange={setDonts}
          rows={2}
        />
      </div>
    </Modal>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  rows,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-caption font-medium text-ink-700">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink-900',
          'outline-none transition-colors duration-150 placeholder:text-ink-300',
          'focus:border-peach-300 focus:ring-2 focus:ring-peach-100',
        )}
      />
    </div>
  );
}
