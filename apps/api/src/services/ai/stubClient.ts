import { contentFormatSchema, tokenize } from '@creatordna/shared';
import type { TextModelClient, TextModelRequest, TextModelResponse } from './types.js';

/**
 * DEV ONLY - a fake model so the whole Phase 3 flow can be demoed and manually
 * smoke-tested without a Gemini API key.
 *
 * TODO(phase-4): delete this file once a real model id is configured. It is
 * only wired in when `AI_STUB_CLIENT=true`, and the API refuses to boot with
 * that flag in production (see `config/env.ts`).
 *
 * The stub parses the labelled lines of the `dna-extract` prompt, so it can
 * only ever answer a prompt that carries real onboarding answers - it cannot
 * invent a profile out of nothing.
 */

const FORMATS = contentFormatSchema.options;

/**
 * Reads one `- <label>: <value>` line. Matched literally (the labels contain
 * parentheses and apostrophes), so no regex escaping is needed.
 */
function readLine(user: string, label: string): string | undefined {
  const prefix = `- ${label}:`;
  for (const line of user.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return undefined;
}

/**
 * A line of the form `LABEL: value`, with no leading dash - the shape the
 * trend-remix prompt uses for its `TREND FORMAT` / `IDEA` headers.
 */
function readBareLine(user: string, label: string): string | undefined {
  const prefix = `${label}:`;
  for (const line of user.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return undefined;
}

function readSamplePosts(user: string): { text: string; url?: string }[] {
  const block = /SAMPLE POSTS\n([\s\S]*?)\n\nReturn JSON/.exec(user)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => /^\d+\.\s+(.+)$/.exec(line.trim())?.[1])
    .filter((line): line is string => line !== undefined && line.length > 0)
    .map((line) => {
      const withUrl = /^(.*?)\s+\((https?:\/\/\S+)\)$/.exec(line);
      if (withUrl === null || withUrl === undefined) return { text: line };
      return { text: withUrl[1] ?? line, url: withUrl[2] };
    });
}

export interface StubTextModelClientOptions {
  /** Adapter name logged with every call. */
  readonly name?: string;
}

/**
 * Builds a `TextModelClient` that answers each Phase 3 + Phase 4 prompt from the
 * prompt's own contents. It never invents: if the prompt does not carry the
 * inputs a prompt expects, it throws, which the wrapper surfaces as a 503.
 */
export function createStubTextModelClient(
  options: StubTextModelClientOptions = {},
): TextModelClient {
  const name = options.name ?? 'stub';

  return {
    name,

    async generate(_model: string, request: TextModelRequest): Promise<TextModelResponse> {
      // A little latency so the wrapper's timeout/backoff/duration paths behave
      // exactly as they do against a real endpoint.
      await new Promise((resolve) => setTimeout(resolve, 25));

      const answer = answerFor(request);
      if (answer !== null) return { ...answer, model: `${name}-model` };

      const niche = readLine(request.user, 'niche');
      const tone = (readLine(request.user, 'tone (creator\'s own words)') ?? '')
        .split(',')
        .map((word) => word.trim())
        .filter((word) => word.length > 0);
      const format = readLine(request.user, 'usual format');
      const audienceAgeRange = readLine(request.user, 'audience age range');
      const audienceType = readLine(request.user, 'audience type');

      if (niche === undefined || tone.length === 0 || format === undefined) {
        throw new Error(
          'stub model: the prompt did not carry the expected onboarding answers ' +
            '(niche / tone / format). Refusing to invent a profile.',
        );
      }

      const samplePosts = readSamplePosts(request.user);

      // The stub's job is to be *plausible*, not clever: it mirrors the
      // answers and borrows a few concrete words from the sample posts so the
      // consistency half of the sync score has something to check.
      const sampleWords = Array.from(
        new Set(
          samplePosts
            .flatMap((post) => post.text.split(/[^A-Za-z]+/))
            .filter((word) => word.length > 5)
            .slice(0, 3),
        ),
      );

      const payload: Record<string, unknown> = {
        niche,
        tone,
        audience: [audienceType ?? 'peers'],
        style:
          samplePosts.length > 0
            ? 'Mirrors the sample posts: short sentences, concrete nouns, no filler.'
            : 'Short sentences and concrete nouns, derived from the format and tone.',
        personality: tone.slice(0, 2),
        format: FORMATS.includes(format as (typeof FORMATS)[number])
          ? format
          : 'other',
        vocabulary: sampleWords,
        catchphrases: [],
        dos: ['Opens with the concrete problem'],
        donts: ['Never opens with a generic greeting'],
        samplePosts,
      };
      if (audienceAgeRange !== undefined) payload.audienceAgeRange = audienceAgeRange;
      if (audienceType !== undefined) payload.audienceType = audienceType;

      return {
        text: JSON.stringify(payload),
        promptTokens: 420,
        completionTokens: 190,
        model: `${name}-model`,
      };
    },
  };
}


/**
 * Answers the three Phase 4 prompts. Returns `null` when the request is not one
 * of them, so the DNA branch below still handles `dna-extract`.
 *
 * The remix/hook answers are assembled from the prompt itself - the trend
 * format, the creator's niche, tone and vocabulary - so the demo output really
 * does change when the DNA changes, which is the Phase 4 acceptance criterion.
 */
function answerFor(request: TextModelRequest): Omit<TextModelResponse, 'model'> | null {
  const user = request.user;

  // --- trend-relevance ----------------------------------------------------
  if (user.startsWith('CREATOR DNA') && user.includes('TRENDING FORMATS')) {
    const niche = readLine(user, 'niche') ?? '';
    const scores = [...user.matchAll(/^\d+\. (trend_[a-z0-9_]+) - (.+?) \| /gm)].map(
      ([, trendId, title]) => {
        const text = `${String(trendId)} ${String(title)}`.toLowerCase();
        // Deliberately simple: keyword overlap between the trend and the niche.
        const words = tokenize(niche);
        const hits = words.filter((word) => text.includes(word)).length;
        const relevance = Math.max(5, Math.min(95, 20 + hits * 30));
        const reasons =
          hits > 0 ? [`your niche shows up in "${String(title)}"`] : ['no overlap with your niche'];
        return { trendId: String(trendId), relevance, reasons };
      },
    );
    if (scores.length === 0) return null;
    return {
      text: JSON.stringify({ scores }),
      promptTokens: 300 + scores.length * 12,
      completionTokens: 40 + scores.length * 10,
    };
  }

  // --- hook-lab -----------------------------------------------------------
  if (user.startsWith('IDEA:')) {
    const idea = readBareLine(user, 'IDEA') ?? 'this';
    const niche = readLine(user, 'niche') ?? 'your niche';
    const tone = (readLine(user, 'tone') ?? 'direct').split(',')[0]?.trim() ?? 'direct';
    const vocabulary = (readLine(user, 'vocabulary to reuse') ?? '')
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && word !== 'none recorded');
    const single = /Write exactly ONE hook/.test(user);
    const styles = single
      ? [/"([a-z-]+)" style/.exec(user)?.[1] ?? 'question']
      : ['question', 'bold-claim', 'pov', 'story', 'contrarian', 'curiosity-gap'];

    // Hooks are short, so a long idea sentence is trimmed to its subject.
    const subject = idea.split(/\s+/).slice(0, 8).join(" ");
    const hooks = styles.map((style, index) => ({
      id: `h${index + 1}`,
      text: hookText(style, subject, vocabulary[0]),
      style,
      whyItWorks: `Written for ${niche} in a ${tone} voice.`,
    }));

    return {
      text: JSON.stringify({ hooks }),
      promptTokens: 260 + hooks.length * 10,
      completionTokens: 60 + hooks.length * 14,
    };
  }

  // --- trend-remix --------------------------------------------------------
  if (user.startsWith('TREND FORMAT:')) {
    const trendFormat = readBareLine(user, 'TREND FORMAT') ?? 'Free-form idea';
    const niche = readLine(user, 'niche') ?? 'your niche';
    const tone = readLine(user, 'tone') ?? 'direct';
    const audience = readLine(user, 'audience') ?? 'your audience';
    const vocabulary = (readLine(user, 'vocabulary to reuse') ?? '')
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && word !== 'none recorded');
    const idea = readBareLine(user, "CREATOR'S OWN IDEA");
    const topic = idea !== undefined && idea.startsWith('None') ? niche : (idea ?? niche);

    const payload = {
      trendId: null,
      format: trendFormat,
      hook: `POV: you finally understand ${topic}`,
      script: [
        { scene: 'Hook', text: `POV: you have avoided ${topic} for weeks.` },
        { scene: 'Setup', text: `Here is the one picture that makes it click for ${audience}.` },
        { scene: 'Turn', text: `Most people get this backwards - and it costs them the interview.` },
        {
          scene: 'Proof',
          text:
            vocabulary.length > 0
              ? `Watch it work on ${vocabulary.slice(0, 2).join(' and ')}.`
              : 'Watch it work on a real example.',
        },
        { scene: 'CTA', text: `Follow for the next ${topic} breakdown, ${tone} as always.` },
      ],
      cta: `Follow for the next ${topic} breakdown.`,
      caption: `${topic}, in one screen.`,
      hashtags: ['#shorts', '#creatordna', `#${niche.replace(/[^a-z0-9]+/gi, '').toLowerCase()}`],
      whatWasKept: [`the "${trendFormat}" skeleton`, 'the three-beat escalation'],
      whatWasChanged: [`topic swapped to ${topic}`, "examples swapped to the creator's own", 'CTA swapped to a follow'],
    };
    return {
      text: JSON.stringify(payload),
      promptTokens: 520,
      completionTokens: 260,
    };
  }

  // --- improve-copy -------------------------------------------------------
  if (user.startsWith('REWRITE TARGET:')) {
    const target = readBareLine(user, 'REWRITE TARGET') ?? 'cta';
    const hook = readLine(user, 'CURRENT HOOK') ?? 'POV: you finally understand it';
    const cta = readLine(user, 'CURRENT CTA') ?? 'Follow for more.';
    const niche = readLine(user, 'niche') ?? 'your niche';
    const vocabulary = (readLine(user, 'vocabulary to reuse') ?? '')
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && word !== 'none recorded');
    const catchphrases = (readLine(user, 'catchphrases to weave in') ?? '')
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && word !== 'none recorded');

    // A feedback line of the form "1. ..." - the block the template renders.
    const feedback = user
      .split('\n')
      .map((line) => /^\s*\d+\.\s+(.+)$/.exec(line)?.[1])
      .filter((line): line is string => line !== undefined && line.length > 0);

    // The stub mirrors what the prompt promises: only the requested line moves.
    const detail = vocabulary[0] ?? niche;
    const improvedHook =
      target === 'hook' ? `POV: ${catchphrases[0] ?? hook.replace(/^POV:\s*/i, '')} - with the numbers.` : hook;
    const improvedCta =
      target === 'cta'
        ? `Follow for the next ${detail} breakdown, plain English.`
        : cta;

    const payload = {
      hook: improvedHook,
      cta: improvedCta,
      changedWhat:
        feedback.length > 0
          ? `Applied ${feedback.length} piece(s) of mirror feedback in the ${target}.`
          : `Tightened the ${target} with no feedback recorded.`,
    };

    return {
      text: JSON.stringify(payload),
      promptTokens: 380,
      completionTokens: 120,
    };
  }

  // --- audience-mirror ----------------------------------------------------
  if (user.startsWith('CONTENT UNDER TEST')) {
    const content = readBareLine(user, 'CONTENT UNDER TEST') ?? 'this';
    const niche = readLine(user, 'niche') ?? 'your niche';

    // The numbered segment block the template renders.
    const segments = user
      .split('\n')
      .map((line) => /^\s*\d+\.\s+(.+)$/.exec(line)?.[1])
      .filter((line): line is string => line !== undefined && line.length > 0);

    // Deterministic interest so the mirror is reproducible in dev: the first
    // segment is always the strongest, the last the weakest, and the interest
    // level walks down in between.
    const levels = ['High', 'Medium', 'Low'] as const;
    const predictions = segments.map((segmentName, index) => {
      const level = levels[Math.min(index, levels.length - 1)] ?? 'Low';
      return {
        segmentName,
        interest: level,
        reason: `This content names what ${segmentName} cares about in its first line, which is why it earns ${level.toLowerCase()} attention from them.`,
        tip:
          level === 'Low'
            ? `Add one line that names what ${segmentName} actually cares about before the reveal.`
            : `Keep the ${niche} framing; it is what ${segmentName} follows you for.`,
      };
    });

    const payload = {
      predictions,
      overallInsight: `The hook lands hardest with ${segments[0] ?? 'the first segment'}; the weakest segment needs one extra line before the payoff.`,
      improvedCta: `Follow for the next ${niche} breakdown of ${content}.`,
    };

    return {
      text: JSON.stringify(payload),
      promptTokens: 340,
      completionTokens: 200,
    };
  }

  return null;
}

function hookText(style: string, subject: string, vocabulary: string | undefined): string {
  const detail = vocabulary === undefined ? '' : ` (${vocabulary})`;
  switch (style) {
    case 'question':
      return `Why does ${subject} still not click${detail}?`;
    case 'bold-claim':
      return `${subject} is 8 lines. Everyone writes 30.`;
    case 'pov':
      return `POV: ${subject} finally makes sense${detail}.`;
    case 'story':
      return `I watched 400 people fail ${subject} the same way.`;
    case 'contrarian':
      return `Stop memorising ${subject}.`;
    default:
      return `The bug in ${subject} is never where you think.`;
  }
}
