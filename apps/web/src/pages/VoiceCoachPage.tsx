import { useMemo, useState } from 'react';
import {
  LIVE_MAX_SESSION_SECONDS,
  liveSessionScriptSchema,
  type LiveSessionScript,
} from '@creatordna/shared';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/StateViews';
import { Waveform } from '../components/voiceCoach/Waveform';
import { ScriptTeleprompter } from '../components/voiceCoach/ScriptTeleprompter';
import { FeedbackFeed } from '../components/voiceCoach/FeedbackFeed';
import { SessionTimer } from '../components/voiceCoach/SessionTimer';
import { useVoiceCoachSession } from '../hooks/useVoiceCoachSession';

/**
 * Live Voice Coach.
 *
 * The whole feature on one screen: the script to read, the mic, the live tips,
 * the clock. Nothing here decides anything - every rule (session length, daily
 * cap, what a tip looks like) is enforced by the API and validated by the shared
 * schemas, so this page is a view of a session rather than a second source of
 * truth for it.
 */

const SAMPLE_SCRIPT = `POV: you finally understand binary search
The trick is the halving picture
Every comparison throws away half the list
So twenty sorted items take five guesses, not twenty
That is the whole idea - now go use it`;

export function VoiceCoachPage() {
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const coach = useVoiceCoachSession();

  const script: LiveSessionScript | null = useMemo(() => {
    const lines = scriptText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsed = liveSessionScriptSchema.safeParse(lines);
    return parsed.success ? parsed.data : null;
  }, [scriptText]);

  const scriptError =
    script === null
      ? 'Write at least one line, and keep it to 40 lines of 600 characters.'
      : null;

  const live = coach.phase === 'live' || coach.phase === 'connecting' || coach.phase === 'ending';
  const canStart = script !== null && coach.phase === 'idle';

  return (
    <>
      <PageHeader
        title="Live Voice Coach"
        description="Read your script out loud and get coached on pace, filler words, energy and tone match while you are still talking."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {coach.quota === null ? null : (
              <Badge tone={coach.quota.remainingToday === 0 ? 'danger' : 'neutral'}>
                {coach.quota.remainingToday} of {coach.quota.dailyCap} sessions left today
              </Badge>
            )}
            <Badge tone="peach">Max {LIVE_MAX_SESSION_SECONDS}s per take</Badge>
          </div>
        }
      />

      {coach.failure === null ? null : (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-danger-soft px-4 py-3"
        >
          <p className="text-body text-danger-strong">{coach.failure.message}</p>
          <div className="flex gap-2">
            {coach.offerFallback === true && script !== null ? (
              <Button
                size="sm"
                onClick={() => void coach.startFallback(script)}
                disabled={live}
              >
                Record instead
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={coach.reset}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Left: what to read, and the mic. */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Your script"
              description="One line per beat. The coach follows along as you read."
              action={
                coach.phase === 'idle' ? (
                  <span className="text-tiny text-ink-400">{script?.length ?? 0} lines</span>
                ) : null
              }
            />
            <CardContent>
              {coach.phase === 'idle' ? (
                <>
                  <label htmlFor="coach-script" className="sr-only">
                    Script to rehearse, one line per beat
                  </label>
                  <textarea
                    id="coach-script"
                    value={scriptText}
                    onChange={(event) => setScriptText(event.target.value)}
                    rows={8}
                    aria-invalid={scriptError === null ? undefined : true}
                    aria-describedby={scriptError === null ? undefined : 'coach-script-error'}
                    className="w-full rounded-card border border-line bg-surface px-3 py-2 text-body text-ink-900 placeholder:text-ink-300 focus:border-peach-400 focus:outline-none focus:ring-2 focus:ring-peach-200"
                    placeholder={"POV: you finally understand binary search\nThe trick is the halving picture"}
                  />
                  {scriptError === null ? null : (
                    <p id="coach-script-error" className="mt-2 text-caption text-danger-strong">
                      {scriptError}
                    </p>
                  )}
                </>
              ) : (
                <ScriptTeleprompter
                  script={script ?? []}
                  currentLine={coach.currentLine}
                  onSelectLine={coach.setCurrentLine}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-6">
              <Waveform level={coach.level} active={coach.phase === 'live'} />

              <div className="flex flex-wrap items-center justify-center gap-3">
                {coach.phase === 'idle' ? (
                  <>
                    <Button
                      size="lg"
                      iconOnly
                      aria-label="Start live coaching"
                      disabled={!canStart}
                      onClick={() => {
                        if (script !== null) void coach.start(script);
                      }}
                    >
                      <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect
                          x="9"
                          y="3"
                          width="6"
                          height="10"
                          rx="3"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canStart}
                      onClick={() => {
                        if (script !== null) void coach.startFallback(script);
                      }}
                    >
                      Record a take instead
                    </Button>
                  </>
                ) : null}

                {coach.recordingFallback === true ? (
                  <Button
                    size="lg"
                    variant="danger"
                    onClick={() => {
                      if (script !== null) void coach.submitFallback(script);
                    }}
                  >
                    Stop and review
                  </Button>
                ) : null}

                {coach.phase === 'live' && coach.recordingFallback === false ? (
                  <Button size="lg" onClick={() => void coach.stop()}>
                    End session
                  </Button>
                ) : null}

                {coach.phase === 'ending' ? <Button size="lg" loading>Wrapping up…</Button> : null}

                {coach.phase === 'ended' ? (
                  <Button size="lg" onClick={coach.reset}>
                    Coach me again
                  </Button>
                ) : null}
              </div>

              <SessionTimer
                elapsedSeconds={coach.elapsedSeconds}
                remainingSeconds={coach.remainingSeconds}
              />

              <p className="max-w-sm text-center text-caption text-ink-500">
                {coach.phase === 'idle'
                  ? 'Audio is streamed to the coach and never stored. A take runs at most five minutes.'
                  : coach.recordingFallback === true
                    ? 'Recording. Read the whole script, then stop - the coach reviews it in one go.'
                    : 'Reading? Keep going. The coach will speak up when something needs fixing.'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right: what the coach is saying. */}
        <div className="flex flex-col gap-6">
          <Card className="min-h-[18rem]">
            <CardHeader
              title="Live feedback"
              description="Pace, clarity, filler words, energy and tone match."
              action={
                coach.phase === 'live' ? (
                  <Badge tone="success">
                    <span aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-pill bg-success" />
                    Listening
                  </Badge>
              ) : null
              }
            />
            <CardContent>
              {live === false && coach.tips.length === 0 && coach.phase !== 'ended' ? (
                <EmptyState
                  title="Nothing yet"
                  description="Start a session and tips appear here as you read."
                />
              ) : (
                <FeedbackFeed tips={coach.tips} transcript={coach.transcript} />
              )}
            </CardContent>
          </Card>

          {coach.phase === 'ended' ? (
            <Card>
              <CardHeader
                title="Session summary"
                description={
                  coach.fallback === null
                    ? 'Saved to your coaching history.'
                    : coach.fallback.fallback === true
                      ? 'Reviewed after the take - the live coach was not available.'
                      : 'Reviewed after the take.'
                }
              />
              <CardContent>
                {coach.summary === null ? (
                  <EmptyState title="No summary" description="The session ended without notes." />
                ) : (
                  <SummaryView summary={coach.summary} />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Strengths, issues and tips from a finished session. */
function SummaryView({ summary }: { summary: NonNullable<ReturnType<typeof useVoiceCoachSession>['summary']> }) {
  return (
    <dl className="flex flex-col gap-4">
      <SummaryGroup label="What worked" items={summary.strengths} tone="success" />
      <SummaryGroup label="What to fix" items={summary.issues} tone="warning" />
      <SummaryGroup label="Next take" items={summary.tips} tone="info" />
      <div className="flex flex-wrap gap-4 border-t border-line pt-3 text-caption text-ink-500">
        <span>{summary.durationSeconds}s on the mic</span>
        <span>{summary.linesRead} lines read</span>
      </div>
    </dl>
  );
}

function SummaryGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'success' | 'warning' | 'info';
}) {
  if (items.length === 0) return null;

  const dot = { success: 'bg-success', warning: 'bg-warning', info: 'bg-info' }[tone];

  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-1">
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-body text-ink-700">
              <span aria-hidden="true" className={`mt-2 size-1.5 shrink-0 rounded-pill ${dot}`} />
              {item}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}
