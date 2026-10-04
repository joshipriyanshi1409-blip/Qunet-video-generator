import {
  computeDnaSyncScore,
  buildDnaContext,
  creatorDnaSchema,
  type CreatorDna,
  type Hook,
  type HookStyle,
  type JobStatusResponse,
  type RankedTrend,
  type RenderAsset,
  type RenderStage,
} from '@creatordna/shared';
import { DEMO_VIDEO_PATH, demoVideoUrl } from './demoAssets';

const DEMO_DNA_STORAGE_KEY = 'creatordna.demo.dna.v1';
const DEMO_JOBS_STORAGE_KEY = 'creatordna.demo.jobs.v1';

const DEFAULT_DEMO_DNA: CreatorDna = creatorDnaSchema.parse({
  niche: 'Tech (CSE)',
  audienceAgeRange: '18-24',
  audienceType: 'students',
  tone: ['friendly', 'educational'],
  audience: ['Students (18-24)', 'Beginner Coders', 'Working Developers'],
  style: 'Friendly - Educational',
  personality: ['relatable', 'encouraging'],
  format: 'talking-head',
  vocabulary: ['binary search', 'log n', 'sorted array', 'DSA'],
  catchphrases: [
    'Binary search in 30 seconds',
    'Binary Search Made Easy',
  ],
  dos: ['use practical examples', 'relatable student stories'],
  donts: ['dry theory dumps', 'skip visual walkthroughs'],
  samplePosts: [
    { text: 'POV: You finally understand Binary Search after 3 days. Binary Search Made Easy!' },
    { text: 'A day in my life as a CSE student prepping for coding interviews.' },
  ],
  dnaVersion: 3,
});

function readDemoDna(): CreatorDna {
  try {
    const raw = window.localStorage.getItem(DEMO_DNA_STORAGE_KEY);
    if (raw !== null) {
      const parsed = creatorDnaSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_DEMO_DNA;
}

function writeDemoDna(dna: CreatorDna): CreatorDna {
  const validated = creatorDnaSchema.parse(dna);
  try {
    window.localStorage.setItem(DEMO_DNA_STORAGE_KEY, JSON.stringify(validated));
  } catch {
    // ignore storage errors
  }
  return validated;
}

function buildDemoProfile(dna: CreatorDna) {
  const score = computeDnaSyncScore(dna);
  const ctx = buildDnaContext({ uid: 'local-creator', dna, history: [] });
  return {
    dna,
    score: {
      ...score,
      score: score.score > 0 ? score.score : 87,
    },
    context: ctx.text,
    contextTokens: ctx.tokens,
  };
}

const DEMO_RANKED_TRENDS: RankedTrend[] = [
  {
    trend: {
      id: 'trend_pov_finally',
      title: 'POV: You finally understand Binary Search after 3 days 😅',
      format: 'POV: you finally understand {concept} after {time}',
      description: 'Relatable coding breakthrough moment with a visual walkthrough of the algorithm.',
      category: 'tech',
      popularityScore: 96,
    },
    relevance: 94,
    reasons: ['Matches your Tech (CSE) niche', 'High resonance with Students (18-24)'],
    cached: false,
  },
  {
    trend: {
      id: 'trend_cse_day_in_life',
      title: 'A day in my life as a CSE student',
      format: 'A day in my life as a {role}: {three_scenes}',
      description: 'Fast-paced study + coding routine showing authentic student life.',
      category: 'education',
      popularityScore: 91,
    },
    relevance: 90,
    reasons: ['Fits Friendly - Educational style', 'Strong student engagement'],
    cached: false,
  },
  {
    trend: {
      id: 'trend_study_tips',
      title: 'Study tips that actually work',
      format: '3 {topic} tips that actually work (and why)',
      description: 'Actionable study and coding habits backed by real exam prep experience.',
      category: 'education',
      popularityScore: 88,
    },
    relevance: 88,
    reasons: ['Practical educational format', 'Clear takeaway for beginners'],
    cached: false,
  },
];

/**
 * The demo render's clock.
 *
 * A showcase deployment has no worker, so a job document would otherwise sit
 * frozen wherever it was first written. So a *started* demo job is simulated on
 * a fixed timeline measured from `data.demoStartedAt`: the progress screen shows
 * the pipeline actually moving, and about fifteen seconds later the job is
 * finished, with an MP4 asset on it.
 *
 * It is derived from the clock rather than from a `setTimeout`, so a reload
 * halfway through picks the job up exactly where it should be, and a tab left
 * open costs nothing.
 */
interface DemoRenderStep {
  /** Milliseconds after the job was started. */
  atMs: number;
  stage: RenderStage;
  progress: number;
}

export const DEMO_RENDER_STEPS: readonly DemoRenderStep[] = [
  { atMs: 0, stage: 'queued', progress: 0 },
  { atMs: 900, stage: 'script', progress: 6 },
  { atMs: 3_000, stage: 'storyboard', progress: 18 },
  { atMs: 5_200, stage: 'assets', progress: 38 },
  { atMs: 7_400, stage: 'voice', progress: 56 },
  { atMs: 9_000, stage: 'music', progress: 68 },
  { atMs: 10_600, stage: 'captions', progress: 80 },
  { atMs: 12_000, stage: 'compose', progress: 90 },
  { atMs: 13_400, stage: 'qc', progress: 97 },
  { atMs: 15_000, stage: 'completed', progress: 100 },
];

/** How long a simulated render runs, in milliseconds. */
export const DEMO_RENDER_TOTAL_MS = 15_000;

/**
 * The asset a finished demo render reports.
 *
 * It points at the MP4 the web app ships in `public/`, not at the API's asset
 * mount: on a static host nothing serves `/api/v1/render-assets/...`, so the
 * player would report a broken file on a job that claims to be finished.
 */
function demoRenderAssets(): RenderAsset[] {
  return [
    {
      kind: 'mp4',
      storagePath: DEMO_VIDEO_PATH,
      url: demoVideoUrl(),
      mimeType: 'video/mp4',
    },
  ];
}

/** When a demo job's simulated render started, or null when it is not simulated. */
function demoStartedAt(job: JobStatusResponse): number | null {
  const startedAt = job.data.demoStartedAt;
  return typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : null;
}

/**
 * One job document as it looks at `now`.
 *
 * A job that is already terminal, or that was never started on the timeline (the
 * seeded showcase job), is returned untouched: the simulation must never reopen
 * a finished render.
 */
function simulateDemoJob(job: JobStatusResponse, now: number): JobStatusResponse {
  const startedAt = demoStartedAt(job);
  if (startedAt === null) return job;
  if (job.state === 'completed' || job.state === 'failed') return job;

  const elapsedMs = Math.max(0, now - startedAt);
  let step: DemoRenderStep = DEMO_RENDER_STEPS[0]!;
  for (const candidate of DEMO_RENDER_STEPS) {
    if (candidate.atMs <= elapsedMs) step = candidate;
  }

  const finished = step.stage === 'completed';
  return {
    ...job,
    // `queued` is the only stage the queue has not picked up yet; everything
    // after it is a running job.
    state: finished ? 'completed' : step.stage === 'queued' ? 'waiting' : 'active',
    stage: step.stage,
    progress: step.progress,
    // A finished job has run at least once, whichever way the demo got here.
    attemptsMade: finished ? Math.max(1, job.attemptsMade) : job.attemptsMade,
    assets: finished ? demoRenderAssets() : job.assets,
  };
}

/**
 * Reads one demo job, simulated to `now`.
 *
 * An id the demo backend never wrote falls back to the seeded showcase job, the
 * same way `/render/:id` always has. On a deployment with no API there is no
 * such thing as a job that "does not exist", and a hand-typed URL is better
 * answered with something playable than with an error the visitor cannot act on.
 */
function readDemoJob(jobId: string, now: number): JobStatusResponse {
  const jobs = readDemoJobs();
  const stored = jobs[jobId] ?? jobs['demo-binary-search']!;
  return { ...simulateDemoJob(stored, now), jobId };
}

function buildDefaultJobs(): Record<string, JobStatusResponse> {
  return {
    'demo-binary-search': {
      jobId: 'demo-binary-search',
      name: 'render-video',
      state: 'completed',
      progress: 100,
      attemptsMade: 1,
      failedReason: null,
      returnvalue: null,
      data: {
        projectId: 'proj_demo_1',
        hook: 'POV: You finally understand Binary Search after 3 days 😅',
        caption: 'Binary Search Made Easy ✨ Finally clicked after 3 days of practice!',
        hashtags: ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'],
        cta: 'Save this for your next coding interview & follow for more!',
        script: [
          {
            scene: 'Hook',
            text: 'POV: You finally understand Binary Search after 3 days 😅',
          },
          {
            scene: 'Core Idea',
            text: 'Binary search is a simple and efficient algorithm that helps us find an element in sorted array in log n time.',
          },
          {
            scene: 'CTA',
            text: 'Save this for your next coding interview & follow for more!',
          },
        ],
      },
      stage: 'completed',
      assets: demoRenderAssets(),
      error: null,
    },
  };
}

function readDemoJobs(): Record<string, JobStatusResponse> {
  try {
    const raw = window.localStorage.getItem(DEMO_JOBS_STORAGE_KEY);
    if (raw !== null) {
      return { ...buildDefaultJobs(), ...(JSON.parse(raw) as Record<string, JobStatusResponse>) };
    }
  } catch {
    // ignore
  }
  return buildDefaultJobs();
}

function writeDemoJob(job: JobStatusResponse): void {
  try {
    const all = readDemoJobs();
    all[job.jobId] = job;
    window.localStorage.setItem(DEMO_JOBS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function handleDemoFallback(
  path: string,
  method: string,
  body?: unknown,
): unknown {
  const dna = readDemoDna();
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  if (path === '/health') {
    return {
      status: 'ok',
      service: 'creatordna-api',
      version: '0.1.0',
      environment: 'development',
      uptimeSeconds: 128,
      timestamp: new Date().toISOString(),
      checks: {
        redis: 'ok',
        firebase: 'ok',
      },
    };
  }

  if (path === '/api/v1/dna' && method === 'GET') {
    return buildDemoProfile(dna);
  }

  if (path === '/api/v1/dna' && method === 'PUT') {
    const updated = writeDemoDna({
      ...dna,
      ...(record as Partial<CreatorDna>),
      dnaVersion: dna.dnaVersion + 1,
      updatedAt: new Date().toISOString(),
    });
    return buildDemoProfile(updated);
  }

  if (path === '/api/v1/dna/extract' && method === 'POST') {
    const updated = writeDemoDna({
      ...dna,
      niche: typeof record.niche === 'string' ? record.niche : dna.niche,
      audienceAgeRange:
        typeof record.audienceAgeRange === 'string'
          ? (record.audienceAgeRange as CreatorDna['audienceAgeRange'])
          : dna.audienceAgeRange,
      audienceType:
        typeof record.audienceType === 'string'
          ? (record.audienceType as CreatorDna['audienceType'])
          : dna.audienceType,
      tone: Array.isArray(record.tone) ? (record.tone as string[]) : dna.tone,
      format:
        typeof record.format === 'string'
          ? (record.format as CreatorDna['format'])
          : dna.format,
      dnaVersion: dna.dnaVersion + 1,
      updatedAt: new Date().toISOString(),
    });
    return buildDemoProfile(updated);
  }

  if (path.startsWith('/api/v1/trends/for-me')) {
    return {
      trends: DEMO_RANKED_TRENDS,
      personalizationLimited: false,
    };
  }

  if (path.startsWith('/api/v1/trends/remix')) {
    const ideaText =
      typeof record.idea === 'string' && record.idea.trim().length > 0
        ? record.idea.trim()
        : 'Binary Search in sorted arrays';
    const trendId = typeof record.trendId === 'string' ? record.trendId : 'trend_pov_finally';
    return {
      trendId,
      format: 'POV: you finally understand {concept} after {time}',
      hook: `POV: You finally understand ${ideaText} after 3 days 😅`,
      script: [
        {
          scene: 'Hook',
          text: `POV: You finally understand ${ideaText} after 3 days 😅`,
        },
        {
          scene: 'Explanation',
          text: 'Binary search is a simple and efficient algorithm that helps us find an element in a sorted array in log n time.',
        },
        {
          scene: 'Visual Step',
          text: 'Instead of checking every element one by one, we cut the search space in half on every single step!',
        },
      ],
      cta: 'Save this for your next coding interview & follow for more CSE tips!',
      caption: `${ideaText} Made Easy ✨ Tailored to your Creator DNA.`,
      hashtags: ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'],
      whatWasKept: ['POV opening hook', '3-beat educational reveal', 'Relatable student pacing'],
      whatWasChanged: [
        `Swapped topic to ${ideaText}`,
        'Injected Friendly - Educational CSE tone',
        'Added exam/interview prep call to action',
      ],
    };
  }

  if (path.startsWith('/api/v1/trends/hooks')) {
    const topic =
      typeof record.idea === 'string' && record.idea.trim().length > 0
        ? record.idea.trim()
        : 'Binary Search';
    const regenerateStyle = record.regenerateStyle as HookStyle | undefined;
    const allHooks: Hook[] = [
      {
        id: 'hook_pov_1',
        style: 'pov',
        text: `POV: You finally understand ${topic} after 3 days 😅`,
        whyItWorks: 'Relatable student struggle creates instant empathy in the first 2 seconds.',
      },
      {
        id: 'hook_claim_2',
        style: 'bold-claim',
        text: `This one trick will make ${topic} click for you`,
        whyItWorks: 'Promises a clear mental shortcut for a topic students find intimidating.',
      },
      {
        id: 'hook_story_3',
        style: 'story',
        text: `From confusion to confidence - ${topic} explained simply`,
        whyItWorks: 'Frames the video as a before-and-after transformation.',
      },
      {
        id: 'hook_gap_4',
        style: 'curiosity-gap',
        text: `I tried ${topic} for 3 days... here's what happened`,
        whyItWorks: 'Opens a curiosity loop that viewers stay to resolve.',
      },
      {
        id: 'hook_question_5',
        style: 'question',
        text: `Why do 80% of CSE students get ${topic} boundary conditions wrong?`,
        whyItWorks: 'Challenges the viewer to test their own understanding.',
      },
      {
        id: 'hook_contrarian_6',
        style: 'contrarian',
        text: `Stop memorizing ${topic} code. Draw the array instead.`,
        whyItWorks: 'Pattern-interrupts rote learning habits with visual intuition.',
      },
    ];
    if (regenerateStyle !== undefined) {
      const match = allHooks.find((h) => h.style === regenerateStyle) ?? allHooks[0]!;
      return { hooks: [{ ...match, id: `${match.id}_${Date.now()}` }] };
    }
    return { hooks: allHooks };
  }

  if (path.startsWith('/api/v1/audience-mirror')) {
    const hook =
      typeof record.hook === 'string' && record.hook.length > 0
        ? record.hook
        : 'POV: You finally understand Binary Search after 3 days 😅';
    const cta =
      typeof record.cta === 'string' && record.cta.length > 0
        ? record.cta
        : 'Save this for your next coding interview!';
    const content =
      typeof record.content === 'string' && record.content.length > 0 ? record.content : hook;
    const projectId =
      typeof record.projectId === 'string' && record.projectId.length > 0
        ? record.projectId
        : 'proj_demo_1';
    const now = new Date().toISOString();
    const mirror = {
      predictions: [
        {
          segmentName: 'Students (18–24)',
          interest: 'High' as const,
          reason: 'Your core audience connects immediately with the 3-day study struggle.',
          tip: 'Show the mid-point calculation visually in the first 3 seconds.',
        },
        {
          segmentName: 'Beginner Coders',
          interest: 'High' as const,
          reason: 'Interested & engaged because the explanation avoids heavy math jargon.',
          tip: 'Highlight why sorted order is required before halving.',
        },
        {
          segmentName: 'Working Developers',
          interest: 'Medium' as const,
          reason: 'Somewhat interested as a quick refresher or interview prep nostalgia.',
          tip: 'Mention the integer overflow edge case in mid = low + (high - low) / 2.',
        },
        {
          segmentName: 'Tech Enthusiasts',
          interest: 'Low' as const,
          reason: 'Niche audience looking for broader tech news rather than DSA specifics.',
          tip: 'Connect log n speed to real-world database indexing.',
        },
      ],
      overallInsight:
        'Your audience loves practical examples and relatable student experiences. The topic is highly relevant to your core audience!',
      improvedCta: 'Comment "DSA" and I will share my visual Binary Search cheat sheet!',
      disclaimer: 'AI analysis, not a guaranteed prediction.',
    };
    const project = {
      id: projectId,
      uid: 'local-creator',
      idea: content,
      trendId: 'trend_pov_finally',
      status: 'awaiting-approval' as const,
      versions: [
        {
          version: 1,
          kind: 'mirror' as const,
          hook,
          cta,
          content,
          mirror,
          feedback: [],
          createdAt: now,
        },
      ],
      approvedVersion: null,
      renderJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    return { project, mirror };
  }

  if (path.startsWith('/api/v1/improve')) {
    const projectId =
      typeof record.projectId === 'string' ? record.projectId : 'proj_demo_1';
    const target = record.target === 'hook' ? ('hook' as const) : ('cta' as const);
    const now = new Date().toISOString();
    const improved = {
      hook: 'POV: You finally understand Binary Search after 3 days 😅 (in 45 seconds)',
      cta: 'Comment "DSA" for the free visual Binary Search notes!',
    };
    const mirror = {
      predictions: [
        {
          segmentName: 'Students (18–24)',
          interest: 'High' as const,
          reason: 'Clear time promise + visual notes CTA boosts saves.',
          tip: 'Keep the energy upbeat on the opening line.',
        },
        {
          segmentName: 'Beginner Coders',
          interest: 'High' as const,
          reason: 'Step-by-step visual framing makes the algorithm approachable.',
          tip: 'Walk through an 8-element array on screen.',
        },
      ],
      overallInsight:
        'Your audience loves practical examples and relatable student experiences. The topic is highly relevant to your core audience!',
      improvedCta: improved.cta,
      disclaimer: 'AI analysis, not a guaranteed prediction.',
    };
    const project = {
      id: projectId,
      uid: 'local-creator',
      idea: improved.hook,
      trendId: 'trend_pov_finally',
      status: 'awaiting-approval' as const,
      versions: [
        {
          version: 2,
          kind: 'improve' as const,
          hook: improved.hook,
          cta: improved.cta,
          content: improved.hook,
          mirror,
          feedback: [],
          createdAt: now,
        },
      ],
      approvedVersion: null,
      renderJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    return { project, target, improved, mirror };
  }

  if (path.includes('/approve') && method === 'POST') {
    const jobId = 'demo-binary-search';
    const now = new Date().toISOString();
    return {
      project: {
        id: 'proj_demo_1',
        uid: 'local-creator',
        idea: 'POV: You finally understand Binary Search after 3 days 😅',
        trendId: 'trend_pov_finally',
        status: 'rendering' as const,
        versions: [],
        approvedVersion: 1,
        renderJobId: jobId,
        createdAt: now,
        updatedAt: now,
      },
      job: {
        jobId,
        queue: 'render',
        state: 'Completed',
      },
    };
  }

  if (path === '/api/v1/render' && method === 'POST') {
    const jobId = `job_${Date.now().toString(36)}`;
    const hook =
      typeof record.hook === 'string' && record.hook.length > 0
        ? record.hook
        : 'POV: You finally understand Binary Search after 3 days 😅';
    const caption =
      typeof record.caption === 'string' && record.caption.length > 0
        ? record.caption
        : 'Binary Search Made Easy ✨';
    const hashtags = Array.isArray(record.hashtags)
      ? (record.hashtags as string[])
      : ['#CSE', '#CodingLife', '#StudyWithMe', '#BinarySearch', '#StudentsLife'];

    const job: JobStatusResponse = {
      jobId,
      name: 'render-video',
      state: 'waiting',
      progress: 0,
      attemptsMade: 0,
      failedReason: null,
      returnvalue: null,
      data: {
        projectId: typeof record.projectId === 'string' ? record.projectId : 'proj_demo_1',
        hook,
        caption,
        hashtags,
        cta: typeof record.cta === 'string' ? record.cta : 'Follow for more CSE tips!',
        script: Array.isArray(record.script)
          ? record.script
          : [
              { scene: 'Hook', text: hook },
              {
                scene: 'Core Idea',
                text: 'Binary search is a simple and efficient algorithm that helps us find an element in sorted array in log n time.',
              },
            ],
        /**
         * When this simulated render started. `data` is an open record on the
         * job document, and with no worker behind it this timestamp is the only
         * thing that makes the job move - see `simulateDemoJob`.
         */
        demoStartedAt: Date.now(),
      },
      stage: 'queued',
      assets: [],
      error: null,
    };
    writeDemoJob(job);

    return {
      jobId,
      queue: 'render',
      state: 'waiting',
      stage: 'queued',
      progress: 0,
      resumedFromAssets: false,
    };
  }

  if (path.startsWith('/api/v1/jobs/')) {
    const jobId = decodeURIComponent(path.slice('/api/v1/jobs/'.length));
    return readDemoJob(jobId, Date.now());
  }

  if (method === 'POST' && path.startsWith('/api/v1/render/') && path.endsWith('/retry')) {
    const jobId = decodeURIComponent(path.split('/')[4] ?? 'demo-binary-search');
    // Read through the simulation: the attempt counter continues from the render
    // the creator actually watched, not from the document's starting point.
    const current = readDemoJob(jobId, Date.now());
    const restarted: JobStatusResponse = {
      ...current,
      state: 'waiting',
      stage: 'queued',
      progress: 0,
      // A retry re-runs the pipeline, so the finished asset is gone until the
      // timeline reports it again.
      assets: [],
      error: null,
      failedReason: null,
      returnvalue: null,
      attemptsMade: current.attemptsMade + 1,
      data: { ...current.data, demoStartedAt: Date.now() },
    };
    writeDemoJob(restarted);

    return {
      jobId,
      queue: 'render',
      state: 'waiting',
      stage: 'queued',
      progress: 0,
      resumedFromAssets: current.assets.length > 0,
    };
  }

  if (path.startsWith('/api/v1/render/')) {
    const parts = path.split('/');
    const jobId = decodeURIComponent(parts[4] ?? 'demo-binary-search');
    return readDemoJob(jobId, Date.now());
  }

  if (path.startsWith('/api/v1/voice-coach/quota')) {
    return {
      usedToday: 1,
      remainingToday: 4,
      dailyCap: 5,
      maxSessionSeconds: 180,
    };
  }

  if (path.startsWith('/api/v1/voice-coach/feedback')) {
    return {
      transcript:
        'Binary search is a simple and efficient algorithm that helps us find an element in sorted array in log n time.',
      summary: {
        overallScore: 82,
        paceWpm: 142,
        fillerCount: 0,
        energyScore: 82,
        clarityScore: 94,
        confidenceScore: 78,
        strengths: ['Crystal clear explanation of log n time', 'Friendly educational energy'],
        issues: ['Slightly fast transition before "sorted array"'],
        tips: ['Pause for half a beat before saying "in log n time" for emphasis.'],
      },
    };
  }

  if (path.startsWith('/api/v1/dna/suggestions/generate')) {
    return {
      suggestions: [],
      skipped: true,
      reason: 'no-new-signals',
    };
  }

  if (path.startsWith('/api/v1/dna/suggestions')) {
    return {
      suggestions: [],
    };
  }

  if (path.startsWith('/api/v1/dna/signals') && method === 'POST') {
    return {
      id: `sig_${Date.now()}`,
      uid: 'local-creator',
      kind: typeof record.kind === 'string' ? record.kind : 'hook_chosen',
      label: typeof record.label === 'string' ? record.label : 'Binary Search',
      source: typeof record.source === 'string' ? record.source : 'studio',
      createdAt: new Date().toISOString(),
    };
  }

  if (path.startsWith('/api/v1/dna/signals')) {
    return {
      signals: [],
    };
  }

  if (path.startsWith('/api/v1/dna/versions')) {
    return {
      currentVersion: dna.dnaVersion,
      versions: [
        {
          version: dna.dnaVersion,
          dna,
          reason: 'Initial Tech (CSE) Creator DNA profile',
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  return null;
}
