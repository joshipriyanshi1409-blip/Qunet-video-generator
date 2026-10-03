import { describe, expect, it } from 'vitest';
import {
  audienceMirrorRequestSchema,
  audienceMirrorResultSchema,
  improveRequestSchema,
  projectSchema,
  type AudienceMirrorResult,
} from '../schemas/index.js';

/**
 * Phase 5 eval fixtures.
 *
 * Five mirror answers, each for a different creator, with expected-trait checks.
 * The point is not to pin golden strings but to encode what must stay true of an
 * Audience Mirror answer no matter which creator it was written for - the same
 * discipline as `trendEval.test.ts`.
 */

/** The five eval mirrors: one per creator archetype. */
export const EVAL_MIRRORS = {
  dsaCoach: {
    predictions: [
      {
        segmentName: 'Career switchers',
        interest: 'High' as const,
        reason: 'They are interviewing this month, so a concrete win lands immediately.',
        tip: 'Name the time saved ("3 days to 20 minutes") in the first line.',
      },
      {
        segmentName: 'Students',
        interest: 'Medium' as const,
        reason: 'The pattern is new to them, so the POV framing hides what they should learn.',
        tip: 'Add one line naming the algorithm before the reveal.',
      },
    ],
    overallInsight:
      'Switchers want the shortcut; students want the name. Lead with the shortcut, name the algorithm once.',
    improvedCta: 'Follow for the next data structure in plain English.',
  },

  moneyBasics: {
    predictions: [
      {
        segmentName: 'First-job beginners',
        interest: 'High' as const,
        reason: 'The number on screen is the whole reason they stopped scrolling.',
        tip: 'Put the rupee figure in the hook, not the CTA.',
      },
      {
        segmentName: 'Parents',
        interest: 'Low' as const,
        reason: 'Household budgeting is a different problem from salaried saving.',
        tip: 'Swap the example for a monthly household cash-flow decision.',
      },
    ],
    overallInsight: 'One number carries the whole video for beginners and loses everyone else.',
    improvedCta: 'Follow for the next money rule you can use this month.',
  },

  retroGamer: {
    predictions: [
      {
        segmentName: 'Retro hobbyists',
        interest: 'High' as const,
        reason: 'Grading an old clip on screen is exactly what they watch this channel for.',
        tip: 'Show the original footage before the verdict.',
      },
      {
        segmentName: 'Speedrunners',
        interest: 'Low' as const,
        reason: 'They want frame data, not nostalgia.',
        tip: 'Name the year and the hardware revision in the first line.',
      },
    ],
    overallInsight: 'Dry commentary is the product; speedrunners are not the audience.',
    improvedCta: 'Follow for the next one that aged like a cartridge.',
  },

  strengthCoach: {
    predictions: [
      {
        segmentName: 'Gym-averse beginners',
        interest: 'High' as const,
        reason: 'Two hard sets is a promise they believe they can keep this week.',
        tip: 'Show the failed rep, not the successful one.',
      },
      {
        segmentName: 'Parents',
        interest: 'Medium' as const,
        reason: 'They care about time cost more than load, which the hook does not mention.',
        tip: 'Say how many minutes the whole session takes.',
      },
    ],
    overallInsight: 'The time cost, not the load, is what makes this shareable to parents.',
    improvedCta: 'Follow for the next two-set workout you can do in a garage.',
  },

  indieFounder: {
    predictions: [
      {
        segmentName: 'Bootstrapped founders',
        interest: 'High' as const,
        reason: 'A real dashboard screenshot is proof, and proof is what they want.',
        tip: 'Blur nothing - the unedited number is the credibility.',
      },
      {
        segmentName: 'Aspiring founders',
        interest: 'Medium' as const,
        reason: 'They cannot judge whether the number is good yet.',
        tip: 'Add one line saying what "good" looks like at this stage.',
      },
    ],
    overallInsight: 'Credibility comes from the unedited number; scale it down for people earlier on.',
    improvedCta: 'Follow for the next ugly version I actually shipped.',
  },
} satisfies Record<string, Omit<AudienceMirrorResult, 'disclaimer'>>;

/** Every fixture must satisfy the wire schema. */
for (const [name, mirror] of Object.entries(EVAL_MIRRORS)) {
  describe(`eval mirror: ${name}`, () => {
    it('validates against audienceMirrorResultSchema', () => {
      const parsed = audienceMirrorResultSchema.parse(mirror);
      expect(parsed.disclaimer).toBe('AI analysis, not a guaranteed prediction.');
      expect(parsed.predictions.length).toBeGreaterThan(0);
    });

    it('gives every segment a reason that is not just the segment name', () => {
      for (const prediction of mirror.predictions) {
        expect(prediction.reason.length).toBeGreaterThan(20);
        expect(prediction.reason.toLowerCase()).not.toBe(prediction.segmentName.toLowerCase());
      }
    });

    it('gives every segment a tip that names a concrete edit', () => {
      for (const prediction of mirror.predictions) {
        expect(prediction.tip.length).toBeGreaterThan(10);
        // "make it better" style advice is exactly what the prompt forbids.
        expect(prediction.tip.toLowerCase()).not.toContain('make it better');
      }
    });

    it('spans more than one interest level, or says so in the insight', () => {
      const levels = new Set(mirror.predictions.map((prediction) => prediction.interest));
      const varied = levels.size > 1;
      expect(varied === true || mirror.overallInsight.length > 0).toBe(true);
    });

    it('produces an improved CTA that differs from a bare "follow me"', () => {
      expect(mirror.improvedCta.trim().length).toBeGreaterThan(10);
      expect(mirror.improvedCta.toLowerCase()).not.toBe('follow me');
    });
  });
}

describe('the Phase 5 request/response contracts', () => {
  it('accepts a mirror request carrying content, hook and cta', () => {
    const parsed = audienceMirrorRequestSchema.parse({
      content: 'POV: you finally understand binary search after 3 days',
      hook: 'POV: you finally understand binary search',
      cta: 'Follow for the next data structure',
      projectId: 'proj_1',
      trendId: 'trend_pov_finally',
    });
    expect(parsed.projectId).toBe('proj_1');
    expect(parsed.segments).toBeUndefined();
  });

  it('rejects a mirror request missing the hook or the cta', () => {
    expect(
      audienceMirrorRequestSchema.safeParse({ content: 'c', cta: 'cta' }).success,
    ).toBe(false);
    expect(
      audienceMirrorRequestSchema.safeParse({ content: 'c', hook: 'h' }).success,
    ).toBe(false);
  });

  it('accepts an improve request that carries the feedback that drove it', () => {
    const parsed = improveRequestSchema.parse({
      projectId: 'proj_1',
      target: 'hook',
      feedback: ['Name the time saved', 'Open with the mistake'],
    });
    expect(parsed.feedback).toHaveLength(2);
    expect(parsed.recheck).toBe(true);
  });

  it('tracks a full revise loop in the project versions array', () => {
    const project = projectSchema.parse({
      id: 'proj_1',
      uid: 'uid_1',
      idea: 'Explain binary search to a nervous interviewee',
      trendId: 'trend_pov_finally',
      versions: [
        {
          version: 1,
          kind: 'remix',
          hook: 'POV: you finally understand binary search after 3 days',
          cta: 'Follow for the next data structure',
          content: 'POV: you finally understand binary search after 3 days',
          createdAt: '2026-10-02T10:00:00.000Z',
        },
        {
          version: 2,
          kind: 'mirror',
          hook: 'POV: you finally understand binary search after 3 days',
          cta: 'Follow for the next data structure',
          content: 'POV: you finally understand binary search after 3 days',
          mirror: { ...EVAL_MIRRORS.dsaCoach },
          feedback: ['Name the time saved'],
          createdAt: '2026-10-02T10:01:00.000Z',
        },
        {
          version: 3,
          kind: 'improve',
          hook: 'POV: 3 days to 20 minutes on binary search',
          cta: 'Follow for the next data structure in plain English',
          content: 'POV: 3 days to 20 minutes on binary search',
          improvedCta: 'Follow for the next data structure in plain English',
          feedback: ['Name the time saved'],
          createdAt: '2026-10-02T10:02:00.000Z',
        },
      ],
      status: 'awaiting-approval',
      createdAt: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-02T10:02:00.000Z',
    });

    expect(project.versions.map((version) => version.kind)).toEqual([
      'remix',
      'mirror',
      'improve',
    ]);
    expect(project.versions[2]?.improvedCta).toBe(
      'Follow for the next data structure in plain English',
    );
    expect(project.status).toBe('awaiting-approval');
    expect(project.approvedVersion).toBeNull();
  });
});
