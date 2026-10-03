import type { CreatorDna, CreatorDnaUpsert, DnaHistoryItem } from '../schemas/dna.schema.js';

/**
 * Turns a DNA profile (plus the creator's recent history) into the compact text
 * block that is prefixed to **every** prompt. This is the whole point of the
 * product: the model never sees a bare request, it always sees who it is writing
 * for.
 *
 * Budget is enforced, not hoped for: the block is capped at ~500 tokens
 * (estimated as `characters / 4`, the usual English-language rule of thumb) and
 * history is dropped from the oldest entry until it fits.
 */

/** Default token budget for the injected block. */
export const DNA_CONTEXT_TOKEN_BUDGET = 500;

/** Default number of recent history items to consider. */
export const DNA_CONTEXT_HISTORY_LIMIT = 5;

/** Rough token estimate. Good enough for a budget check, deliberately cheap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function list(values: readonly string[] | undefined, fallback = 'none given'): string {
  if (values === undefined || values.length === 0) return fallback;
  return values.join(', ');
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

/** The fixed DNA header. Kept short: every line here costs tokens on every call. */
export function formatDnaBlock(dna: CreatorDnaUpsert): string {
  const lines = [
    `niche: ${truncate(dna.niche || 'unknown', 80)}`,
    `audience: ${list(dna.audience)}`,
    `audience_age: ${dna.audienceAgeRange ?? 'unknown'}`,
    `audience_type: ${dna.audienceType ?? 'unknown'}`,
    `tone: ${list(dna.tone)}`,
    `personality: ${list(dna.personality)}`,
    `format: ${dna.format}`,
    `style: ${truncate(dna.style || 'unknown', 200)}`,
    `vocabulary: ${list(dna.vocabulary)}`,
    `catchphrases: ${list(dna.catchphrases)}`,
    `always: ${list(dna.dos)}`,
    `never: ${list(dna.donts)}`,
  ];

  const samples = (dna.samplePosts ?? []).slice(0, 3);
  if (samples.length > 0) {
    lines.push('sample_voice:');
    for (const sample of samples) {
      lines.push(`- ${truncate(sample.text, 140)}`);
    }
  }

  return lines.join('\n');
}

/** One recent item, compressed to a single line. */
export function formatHistoryItem(item: DnaHistoryItem): string {
  return `- [${item.kind}] ${truncate(item.summary, 160)}`;
}

export interface DnaContextInput {
  /** The creator this context belongs to (logged, never sent to the model). */
  uid: string;
  dna: CreatorDna | CreatorDnaUpsert;
  /** Most recent first. Older entries are dropped first when over budget. */
  history?: readonly DnaHistoryItem[];
  maxHistoryItems?: number;
  maxTokens?: number;
}

export interface DnaContext {
  /** The block to prepend to a prompt. */
  text: string;
  /** Estimated token count of `text`. */
  tokens: number;
  /** True when history had to be trimmed to fit the budget. */
  truncated: boolean;
  /** How many history items actually made it in. */
  historyItemsUsed: number;
}

/**
 * Builds the injected context block.
 *
 * The DNA header is always included in full - it is the part that makes output
 * sound like the creator. Only history is droppable, oldest first.
 */
export function buildDnaContext(input: DnaContextInput): DnaContext {
  const maxTokens = input.maxTokens ?? DNA_CONTEXT_TOKEN_BUDGET;
  const maxHistoryItems = input.maxHistoryItems ?? DNA_CONTEXT_HISTORY_LIMIT;

  const dnaBlock = formatDnaBlock(input.dna);
  const history = (input.history ?? []).slice(0, maxHistoryItems);

  const header = `CREATOR DNA (uid: ${input.uid}, version ${input.dna.dnaVersion ?? 1})\n${dnaBlock}`;

  if (history.length === 0) {
    const text = `${header}\n\nRECENT WORK: none yet`;
    return { text, tokens: estimateTokens(text), truncated: false, historyItemsUsed: 0 };
  }

  let used = 0;
  let truncated = false;
  const chosen: string[] = [];

  // Newest first: stop as soon as the next entry would blow the budget.
  for (const item of history) {
    const line = formatHistoryItem(item);
    const candidate = `${header}\n\nRECENT WORK\n${[...chosen, line].join('\n')}`;
    if (estimateTokens(candidate) > maxTokens) {
      truncated = true;
      break;
    }
    chosen.push(line);
    used += 1;
  }

  if (chosen.length === 0) {
    const text = `${header}\n\nRECENT WORK: none yet`;
    return { text, tokens: estimateTokens(text), truncated: true, historyItemsUsed: 0 };
  }

  const text = `${header}\n\nRECENT WORK\n${chosen.join('\n')}`;
  return { text, tokens: estimateTokens(text), truncated, historyItemsUsed: used };
}
