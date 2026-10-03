import type { CreatorDnaUpsert } from '../schemas/dna.schema.js';

export interface DnaCompleteness {
  /** 0-100, weighted by how much each field improves generation quality. */
  completeness: number;
  /** Human-readable labels of the fields that are still empty. */
  missingFields: string[];
  dnaVersion: number;
}

interface WeightedField {
  key: keyof CreatorDnaUpsert;
  label: string;
  weight: number;
}

/**
 * Weights are a product decision: niche/audience/style/tone drive every prompt,
 * so they count for more than dos/donts.
 */
const WEIGHTED_FIELDS: readonly WeightedField[] = [
  { key: 'niche', label: 'Niche', weight: 15 },
  { key: 'tone', label: 'Tone', weight: 10 },
  { key: 'audience', label: 'Audience', weight: 15 },
  { key: 'style', label: 'Style', weight: 10 },
  { key: 'personality', label: 'Personality', weight: 5 },
  { key: 'format', label: 'Format', weight: 10 },
  { key: 'vocabulary', label: 'Vocabulary', weight: 10 },
  { key: 'catchphrases', label: 'Catchphrases', weight: 5 },
  { key: 'dos', label: 'Dos', weight: 5 },
  { key: 'donts', label: "Don'ts", weight: 5 },
  { key: 'samplePosts', label: 'Sample posts', weight: 10 },
];

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Pure function behind the "DNA sync %" ring on the My DNA screen.
 * Deliberately dependency-free so it can run in the browser and in the API.
 */
export function computeDnaCompleteness(dna: CreatorDnaUpsert): DnaCompleteness {
  const missingFields: string[] = [];
  let score = 0;

  for (const field of WEIGHTED_FIELDS) {
    if (isFilled(dna[field.key])) {
      score += field.weight;
    } else {
      missingFields.push(field.label);
    }
  }

  const totalWeight = WEIGHTED_FIELDS.reduce((sum, field) => sum + field.weight, 0);
  const completeness = Math.round((score / totalWeight) * 100);

  return {
    completeness: Math.max(0, Math.min(100, completeness)),
    missingFields,
    dnaVersion: dna.dnaVersion ?? 1,
  };
}
