import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { trendSchema, type Trend } from '@creatordna/shared';

/**
 * The seeded trend catalogue.
 *
 * 20 formats, one file, no model call: they are the input to ranking and
 * remixing, not the output of it. `scripts/seedTrends.ts` writes the same list
 * into Firestore when a project is configured; the local-file store below keeps
 * `pnpm dev` working without one.
 *
 * `format` is the recognizable skeleton a remix must preserve - it is the single
 * most important field here.
 */
export const SEED_TRENDS: readonly Trend[] = [
  {
    id: 'trend_pov_finally',
    title: 'POV: you finally understand it',
    format: 'POV: you finally understand {concept} after {time}',
    description:
      'Narrate the moment a concept clicks, then explain it in one line with a single visual.',
    category: 'education',
    popularityScore: 91,
  },
  {
    id: 'trend_i_was_wrong',
    title: 'I was wrong about this for years',
    format: 'I was wrong about {common belief} for {duration}',
    description:
      'Admit the mistake on camera, then correct it with one concrete example and the number that proves it.',
    category: 'education',
    popularityScore: 74,
  },
  {
    id: 'trend_three_mistakes',
    title: 'Three mistakes keeping you broke',
    format: '{number} mistakes keeping you {outcome}',
    description:
      'Count down the mistakes, one fix each, with the real spreadsheet or receipt on screen.',
    category: 'finance',
    popularityScore: 68,
  },
  {
    id: 'trend_day_one_vs_day_365',
    title: 'Day 1 vs day 365',
    format: 'Day {n} vs day {n*365}',
    description:
      'Split-screen transformation with a voiceover of the one thing that actually changed.',
    category: 'fitness',
    popularityScore: 88,
  },
  {
    id: 'trend_this_aged_badly',
    title: 'This aged badly',
    format: 'This aged {badly|well}',
    description:
      'Replay an old clip and grade it on screen, with dry commentary over the original audio.',
    category: 'entertainment',
    popularityScore: 79,
  },
  {
    id: 'trend_my_real_metric',
    title: 'My real MRR screenshot',
    format: 'My real {metric} screenshot',
    description:
      'Show the dashboard unedited, then explain the one number that moved and why.',
    category: 'business',
    popularityScore: 83,
  },
  {
    id: 'trend_the_one_thing',
    title: 'The one thing nobody tells you',
    format: 'The one thing nobody tells you about {topic}',
    description:
      'Single-take talking head revealing an overlooked detail, then how to use it today.',
    category: 'lifestyle',
    popularityScore: 71,
  },
  {
    id: 'trend_rate_my_setup',
    title: 'Rate my setup out of 10',
    format: 'Rate my {thing} out of 10',
    description:
      'Fast-cut review of a viewer-submitted setup with a visible score card and one fix.',
    category: 'tech',
    popularityScore: 64,
  },
  {
    id: 'trend_explain_like_five',
    title: 'Explain it like I am five',
    format: 'Explain {topic} like I am five',
    description:
      'Reduce a hard topic to one analogy, one diagram and one sentence, in under 30 seconds.',
    category: 'education',
    popularityScore: 86,
  },
  {
    id: 'trend_stop_doing_this',
    title: 'Stop doing this today',
    format: 'Stop doing {habit} today',
    description:
      'Name the habit in the first second, show the cost, then give the one-line replacement.',
    category: 'lifestyle',
    popularityScore: 77,
  },
  {
    id: 'trend_i_tried_it_for_30_days',
    title: 'I tried it for 30 days',
    format: 'I tried {thing} for {duration}',
    description:
      'Day-by-day montage with an honest verdict at the end, including what did not work.',
    category: 'fitness',
    popularityScore: 81,
  },
  {
    id: 'trend_unpopular_opinion',
    title: 'Unpopular opinion',
    format: 'Unpopular opinion: {claim}',
    description:
      'State the claim flatly, defend it with one example, invite the disagreement in the CTA.',
    category: 'business',
    popularityScore: 72,
  },
  {
    id: 'trend_what_i_would_do_differently',
    title: 'What I would do differently',
    format: 'What I would do differently if I started {thing} today',
    description:
      'Talk to camera over your own old work, naming the three decisions you would change.',
    category: 'business',
    popularityScore: 69,
  },
  {
    id: 'trend_before_you_buy',
    title: 'Before you buy this, watch this',
    format: 'Before you buy {thing}, watch this',
    description:
      'One objection, one demonstration, one recommendation, shot on a desk with a single prop.',
    category: 'tech',
    popularityScore: 66,
  },
  {
    id: 'trend_the_math_behind',
    title: 'The math behind it',
    format: 'The math behind {everyday thing}',
    description:
      'Derive something familiar on screen, one line at a time, ending on the surprising result.',
    category: 'education',
    popularityScore: 63,
  },
  {
    id: 'trend_my_worst_mistake',
    title: 'My worst mistake cost me',
    format: 'My worst mistake cost me {cost}',
    description:
      'Open on the number, rewind to the decision, then the lesson in one sentence.',
    category: 'finance',
    popularityScore: 70,
  },
  {
    id: 'trend_pov_teacher',
    title: 'POV: your teacher was right',
    format: 'POV: your {authority figure} was right about {thing}',
    description:
      'Cut between the old advice and the moment it finally paid off, no narration needed.',
    category: 'entertainment',
    popularityScore: 75,
  },
  {
    id: 'trend_thirty_second_fix',
    title: 'The 30 second fix',
    format: 'The {duration} fix for {problem}',
    description:
      'One problem, one fix, one before/after, timed on screen so the viewer can copy it.',
    category: 'lifestyle',
    popularityScore: 78,
  },
  {
    id: 'trend_nobody_talks_about',
    title: 'Nobody talks about this part',
    format: 'Nobody talks about this part of {topic}',
    description:
      'Show the unglamorous middle of the process that the highlight reel always skips.',
    category: 'education',
    popularityScore: 73,
  },
  {
    id: 'trend_i_asked_100_people',
    title: 'I asked 100 people',
    format: 'I asked {number} people about {topic}',
    description:
      'Cut the answers into a rhythm, then draw the one conclusion the answers actually support.',
    category: 'entertainment',
    popularityScore: 67,
  },
];

/** Firestore collection holding the catalogue. */
export const TRENDS_COLLECTION = 'trends';

/**
 * Catalogue access. Firestore in production; a local JSON file in development so
 * `pnpm dev` and the smoke test work without a project.
 */
export interface TrendRepository {
  readonly kind: 'firestore' | 'local-file' | 'seed';
  /** The whole catalogue, ordered by popularity. */
  list(): Promise<Trend[]>;
  get(id: string): Promise<Trend | null>;
  /** Idempotent: writes only the ids that are missing. Returns how many it wrote. */
  seed(trends?: readonly Trend[]): Promise<number>;
}

function validateTrends(trends: readonly unknown[]): Trend[] {
  return trends.map((trend) => trendSchema.parse(trend));
}

export function createFirestoreTrendRepository(db: Firestore): TrendRepository {
  const collection = db.collection(TRENDS_COLLECTION);

  return {
    kind: 'firestore',

    async list() {
      const snapshot = await collection.orderBy('popularityScore', 'desc').get();
      return validateTrends(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    },

    async get(id) {
      const snapshot = await collection.doc(id).get();
      if (!snapshot.exists) return null;
      return trendSchema.parse({ id: snapshot.id, ...snapshot.data() });
    },

    async seed(trends = SEED_TRENDS) {
      let written = 0;
      for (const trend of trends) {
        const ref = collection.doc(trend.id);
        const existing = await ref.get();
        if (existing.exists) continue;
        const { id: _id, ...rest } = trend;
        await ref.set({ ...rest, createdAt: new Date().toISOString() });
        written += 1;
      }
      return written;
    },
  };
}

interface LocalCatalogue {
  trends: Trend[];
}

/**
 * TODO(phase-5): delete once Firestore (or the emulator) is the only store.
 * Mirrors `createLocalFileDnaRepository`: write-then-rename, one file.
 */
export function createLocalFileTrendRepository(file: string): TrendRepository {
  async function read(): Promise<Trend[]> {
    try {
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text) as Partial<LocalCatalogue>;
      return validateTrends(parsed.trends ?? []);
    } catch {
      return [];
    }
  }

  async function write(trends: Trend[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify({ trends }, null, 2), 'utf8');
    await rename(temporary, file);
  }

  return {
    kind: 'local-file',

    async list() {
      const stored = await read();
      const catalogue = stored.length > 0 ? stored : validateTrends(SEED_TRENDS);
      return [...catalogue].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));
    },

    async get(id) {
      const found = (await read()).find((trend) => trend.id === id);
      return found ?? SEED_TRENDS.find((trend) => trend.id === id) ?? null;
    },

    async seed(trends = SEED_TRENDS) {
      const stored = await read();
      const known = new Set(stored.map((trend) => trend.id));
      const missing = validateTrends(trends).filter((trend) => !known.has(trend.id));
      if (missing.length > 0) await write([...stored, ...missing]);
      return missing.length;
    },
  };
}

/**
 * The catalogue is a constant in this deployment: no store, no I/O, always the
 * seed. Used when neither Firestore nor a writable directory is available.
 */
export function createSeedTrendRepository(): TrendRepository {
  const list = (): Trend[] =>
    [...SEED_TRENDS].sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0));

  return {
    kind: 'seed',
    list(): Promise<Trend[]> {
      return Promise.resolve(list());
    },
    get(id: string): Promise<Trend | null> {
      return Promise.resolve(list().find((trend) => trend.id === id) ?? null);
    },
    // Already there by definition: nothing to write.
    seed(): Promise<number> {
      return Promise.resolve(0);
    },
  };
}
