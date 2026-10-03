import { creatorDnaSchema } from '@creatordna/shared';
import type { PromptTemplate } from '../types.js';
import { renderTemplate } from '../render.js';

/**
 * DNA extraction, v1.
 *
 * Input: what the creator answered in onboarding plus any sample posts they
 * pasted. Output: the full Creator DNA document, validated against the *shared*
 * `creatorDnaSchema`, so a prompt change can never silently drift from the
 * contract the API and the UI rely on.
 *
 * Registered in `src/index.ts`; bump to v2 (never edit v1 in place) when the
 * wording changes so old extractions stay reproducible.
 */

const SYSTEM = `You are CreatorDNA Studio's DNA extractor.

You turn a creator's onboarding answers and sample posts into one structured
Creator DNA profile. That profile is injected into every future prompt, so it
must describe THIS creator and nobody else.

Hard rules:
- Infer only from the material given. Never invent achievements, follower counts,
  brand names or niches that are not supported by the input.
- Keep every string short and concrete: the whole profile is injected into every
  prompt and must stay under ~500 tokens.
- "vocabulary" holds words this creator actually uses (5-12 items).
- "catchphrases" holds repeated lines, not generic advice (0-5 items).
- "dos" and "donts" are observable habits, not values ("opens with the mistake",
  "never uses the word hustle").
- "audience" is 1-4 short labels naming who they talk to.
- If sample posts are provided, mirror their rhythm, sentence length and
  punctuation in "style". If none are provided, derive "style" from the format
  and tone and keep it factual.
- Output strict JSON only, matching the requested schema exactly. No prose, no
  markdown, no code fences.`;

const USER = `ONBOARDING ANSWERS
- niche: {{niche}}
- audience age range: {{audience_age_range}}
- audience type: {{audience_type}}
- audience description: {{audience_description}}
- tone (creator's own words): {{tone}}
- usual format: {{format}}

SAMPLE POSTS
{{sample_posts_block}}

Return JSON with exactly these keys:
{
  "niche": string,
  "tone": string[],
  "audience": string[],
  "style": string,
  "personality": string[],
  "format": "talking-head" | "b-roll-voiceover" | "screen-recording" | "whiteboard" | "listicle" | "storytime" | "tutorial" | "other",
  "vocabulary": string[],
  "catchphrases": string[],
  "dos": string[],
  "donts": string[],
  "samplePosts": [{ "text": string, "url"?: string }],
  "audienceAgeRange": "13-17" | "18-24" | "25-34" | "35-44" | "45-54" | "55+",
  "audienceType": "beginners" | "peers" | "professionals" | "hobbyists" | "founders" | "students" | "parents" | "other"
}

"samplePosts" must echo the sample posts you were given, verbatim.`;

/** "None provided" when the creator skipped the optional step. */
export const NO_SAMPLE_POSTS = 'None provided.';

/** Formats the sample posts for the prompt (newline-separated, numbered). */
export function formatSamplePostsBlock(posts: readonly { text: string; url?: string }[]): string {
  if (posts.length === 0) return NO_SAMPLE_POSTS;
  return posts
    .map((post, index) => {
      const suffix = post.url === undefined ? '' : ` (${post.url})`;
      return `${index + 1}. ${post.text}${suffix}`;
    })
    .join('\n');
}

export const dnaExtractV1: PromptTemplate<typeof creatorDnaSchema> = {
  id: 'dna-extract',
  version: 1,
  description:
    'Turn onboarding answers and sample posts into a validated Creator DNA profile.',
  outputSchema: creatorDnaSchema,
  variables: [
    { name: 'niche', description: 'What the creator makes content about.', required: true },
    { name: 'audience_age_range', description: 'Audience age band.', required: true },
    { name: 'audience_type', description: 'Audience type relative to the creator.', required: true },
    {
      name: 'audience_description',
      description: 'Free-text audience description, or "not given".',
      required: true,
    },
    { name: 'tone', description: 'Comma-separated tone words.', required: true },
    { name: 'format', description: 'Usual content format.', required: true },
    {
      name: 'sample_posts_block',
      description: 'Numbered sample posts, or "None provided."',
      required: true,
    },
  ],
  build(variables) {
    return {
      system: SYSTEM,
      user: renderTemplate(USER, variables),
    };
  },
};
