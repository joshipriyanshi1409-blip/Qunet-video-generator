import { PromptRegistry } from './registry.js';
import { dnaExtractV1 } from './templates/dna-extract.v1.js';
import { hookLabV1 } from './templates/hook-lab.v1.js';
import { trendRelevanceV1 } from './templates/trend-relevance.v1.js';
import { audienceMirrorV1 } from './templates/audience-mirror.v1.js';
import { improveCopyV1 } from './templates/improve-copy.v1.js';
import { trendRemixV1 } from './templates/trend-remix.v1.js';
import { storyboardV1 } from './templates/storyboard.v1.js';
import { dnaLearnV1 } from './templates/dna-learn.v1.js';

/**
 * The single prompt registry used by every AI call.
 *
 * Phase 3 registered `dna-extract` v1 (onboarding answers -> Creator DNA).
 * Phase 4 adds `trend-remix` v1, `hook-lab` v1 and `trend-relevance` v1.
 * Phase 5 adds `audience-mirror` v1 and `improve-copy` v1.
 * Phase 7 adds `storyboard` v1 (approved script -> timed scenes).
 * Phase 9 adds `dna-learn` v1 (recorded signals -> proposed DNA updates).
 * The remaining templates (script/storyboard, voice coach feedback, captions)
 * arrive with their phases; `src/templates/README.md` documents the convention
 * each one must follow.
 */
export const prompts = new PromptRegistry();

prompts.register(dnaExtractV1);
prompts.register(trendRemixV1);
prompts.register(hookLabV1);
prompts.register(trendRelevanceV1);
prompts.register(audienceMirrorV1);
prompts.register(improveCopyV1);
prompts.register(storyboardV1);
prompts.register(dnaLearnV1);

export * from './errors.js';
export * from './registry.js';
export * from './render.js';
export * from './templates/dna-extract.v1.js';
export * from './templates/hook-lab.v1.js';
export * from './templates/trend-relevance.v1.js';
export * from './templates/trend-remix.v1.js';
export * from './templates/audience-mirror.v1.js';
export * from './templates/improve-copy.v1.js';
export * from './templates/storyboard.v1.js';
export * from './templates/dna-learn.v1.js';
export * from './types.js';
