import { describe, expect, it } from 'vitest';
import { creatorDnaSchema } from '@creatordna/shared';

/**
 * The demo seed.
 *
 * The seed script is not unit-tested - it touches the filesystem, Firestore and
 * the render pipeline, and the honest test for it is to run it, which
 * `docs/ENVIRONMENT.md` and the root README both describe. What *is* worth
 * pinning down is the fixture: a demo creator whose DNA fails validation is a
 * demo that 422s on the first screen, and the failure looks like a product bug
 * rather than a seed bug.
 */

const demoDna = {
  niche: 'DSA interview prep for career switchers',
  audienceAgeRange: '25-34',
  audienceType: 'professionals',
  tone: ['direct', 'practical'],
  audience: ['Career switchers', 'Students'],
  style: 'Short sentences, whiteboard, fast cuts',
  personality: ['blunt', 'encouraging'],
  format: 'whiteboard',
  vocabulary: ['amortized', 'invariant', 'off-by-one'],
  catchphrases: ['Binary search in 30 seconds.', 'Draw the search space.'],
  dos: ['dry run the code on screen', 'name the bug out loud'],
  donts: ['jargon dumps', 'apologising for the maths'],
  samplePosts: [
    { text: 'Binary search in 30 seconds. The search space halves every step.' },
    { text: 'Your loop never terminates? Print the mid. It is not moving.' },
  ],
};

describe('the demo creator fixture', () => {
  it('is a valid Creator DNA', () => {
    expect(() => creatorDnaSchema.parse(demoDna)).not.toThrow();
  });

  it('is complete, so the score ring is not empty on the first screen', () => {
    const parsed = creatorDnaSchema.parse(demoDna);
    // Every field a creator can fill is filled: a demo that starts at 40%
    // completeness invites the audience to ask about onboarding instead.
    for (const [field, value] of Object.entries(parsed)) {
      if (field === 'dnaVersion' || field === 'updatedAt') continue;
      if (Array.isArray(value)) {
        expect(value.length, `${field} should not be empty`).toBeGreaterThan(0);
      } else if (typeof value === 'string') {
        expect(value.length, `${field} should not be blank`).toBeGreaterThan(0);
      }
    }
  });

  it('starts at version 1, so the history page has room to show a change', () => {
    expect(creatorDnaSchema.parse(demoDna).dnaVersion).toBe(1);
  });

  it('keeps every list field inside its schema ceiling', () => {
    // A suggestion accepted against this profile must never push a field past
    // what the profile validates, so the fixture has to be below the ceiling.
    const parsed = creatorDnaSchema.parse(demoDna);
    expect(parsed.vocabulary.length).toBeLessThanOrEqual(40);
    expect(parsed.tone.length).toBeLessThanOrEqual(6);
    expect(parsed.personality.length).toBeLessThanOrEqual(8);
    expect(parsed.audience.length).toBeLessThanOrEqual(8);
  });
});
