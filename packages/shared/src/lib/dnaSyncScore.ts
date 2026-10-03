import type { CreatorDnaUpsert, DnaSyncScore } from '../schemas/dna.schema.js';
import { computeDnaCompleteness } from './dnaCompleteness.js';

/**
 * DNA sync score = completeness + consistency.
 *
 * - **completeness** (`computeDnaCompleteness`) is *how much* of the profile is
 *   filled in, weighted by how much each field improves generation quality.
 * - **consistency** (this file) is *how much the evidence agrees* with what the
 *   creator declared: do the sample posts actually use the vocabulary and tone
 *   they picked, and do the "do not" rules contradict the word list?
 *
 * Consistency only ever *drops* when there is something to contradict. A creator
 * who filled everything in but pasted no sample posts has nothing to disagree
 * with, so their consistency stays at 100 - the score then tracks completeness
 * alone, which is what the My DNA ring is for.
 */

/** Weight of completeness in the final score. Consistency gets the rest. */
const COMPLETENESS_WEIGHT = 0.7;
const CONSISTENCY_WEIGHT = 0.3;

/** Penalty per word listed in `donts` that is also in the word list. */
const CONTRADICTION_PENALTY = 15;
/** Ceiling on the contradiction penalty, so one bad word cannot zero the score. */
const MAX_CONTRADICTION_PENALTY = 30;
/** Penalty when an audience description exists but the type is left as "other". */
const AUDIENCE_TYPE_PENALTY = 5;
/** Share of the word list that must be missing before it costs anything. */
const WORD_EVIDENCE_SHARE = 0.4;

const MAX_PENALTY = 100;

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueLower(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWord(value);
    if (normalized.length > 0) seen.add(normalized);
  }
  return [...seen];
}

/** Lowercased haystack of every sample post, for `includes` checks. */
function sampleHaystack(samplePosts: readonly { text: string }[]): string {
  return ` ${samplePosts.map((post) => normalizeWord(post.text)).join(' \n ')} `;
}

export interface DnaConsistency {
  /** 0-100. */
  consistency: number;
  /** Human-readable reasons the score is below 100. */
  inconsistencies: string[];
}

/**
 * Pure consistency check. Dependency-free so it runs in the browser (My DNA
 * ring) and in the API (stored with the profile) with identical results.
 */
export function computeDnaConsistency(dna: CreatorDnaUpsert): DnaConsistency {
  const inconsistencies: string[] = [];
  let penalty = 0;

  const vocabulary = uniqueLower(dna.vocabulary ?? []);
  const catchphrases = uniqueLower(dna.catchphrases ?? []);
  const donts = uniqueLower(dna.donts ?? []);
  const samples = dna.samplePosts ?? [];

  // --- 1. declared vocabulary should show up in the evidence ----------------
  if (samples.length > 0) {
    const haystack = sampleHaystack(samples);

    const missingWords = [...vocabulary, ...catchphrases].filter((word) => !haystack.includes(word));
    if (missingWords.length > 0 && vocabulary.length + catchphrases.length > 0) {
      const share = missingWords.length / (vocabulary.length + catchphrases.length);
      // At most 40 points: a creator who lists ten words and uses eight of them
      // should not lose more than a fraction of the score.
      penalty += Math.round(share * WORD_EVIDENCE_SHARE * 100);
      inconsistencies.push(
        `${missingWords.length} word(s) you listed never appear in your sample posts (${missingWords
          .slice(0, 3)
          .join(', ')}${missingWords.length > 3 ? ', …' : ''}).`,
      );
    }
  }

  // NOTE: tone words are deliberately *not* matched against the samples. "direct"
  // or "warm" are descriptors a creator picks, not words they type, so requiring
  // them to appear verbatim would flag every honest profile. Consistency only
  // measures things that can actually be checked.

  // --- 2. contradictions inside the word list ------------------------------
  const contradictions = donts.filter((word) =>
    [...vocabulary, ...catchphrases].includes(word),
  );
  if (contradictions.length > 0) {
    penalty += Math.min(contradictions.length * CONTRADICTION_PENALTY, MAX_CONTRADICTION_PENALTY);
    inconsistencies.push(
      `"${contradictions.join('", "')}" appear(s) in both your word list and your "do not" list.`,
    );
  }

  // --- 3. half-answered audience ------------------------------------------
  const audienceDescription = dna.audience?.find((segment) => segment.trim().length > 0);
  if (audienceDescription !== undefined && dna.audienceType === 'other') {
    penalty += AUDIENCE_TYPE_PENALTY;
    inconsistencies.push('You described your audience but left its type as "other".');
  }

  const consistency = Math.max(0, Math.min(100, MAX_PENALTY - penalty));
  return { consistency, inconsistencies };
}

/** Full sync score: completeness, consistency, and the blended 0-100 number. */
export function computeDnaSyncScore(dna: CreatorDnaUpsert): DnaSyncScore {
  const { completeness, missingFields, dnaVersion } = computeDnaCompleteness(dna);
  const { consistency, inconsistencies } = computeDnaConsistency(dna);

  const score = Math.round(
    completeness * COMPLETENESS_WEIGHT + consistency * CONSISTENCY_WEIGHT,
  );

  return {
    completeness,
    consistency,
    score: Math.max(0, Math.min(100, score)),
    missingFields,
    inconsistencies,
    dnaVersion,
  };
}
