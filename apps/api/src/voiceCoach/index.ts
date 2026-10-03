import {
  createVoiceCoachService,
  type RunningSession,
  type VoiceCoachService,
  type VoiceCoachServiceDeps,
} from './service.js';
import { createSessionRegistry, type SessionRegistry } from './registry.js';
import {
  createVoiceCoachSocketHandler,
  type VoiceCoachSocketHandle,
  type VoiceCoachSocketOptions,
} from './wsHandler.js';
import { createGeminiLiveProvider, type GeminiLiveProviderOptions } from './geminiLive.js';
import { createStubLiveProvider, type StubLiveProviderOptions } from './stubLive.js';
import { buildCoachInstruction, COACH_DIMENSIONS, MAX_TIP_WORDS } from './systemInstruction.js';
import type { LiveSessionProvider } from './types.js';

/**
 * Live Voice Coach - the module's public surface.
 *
 * Everything the rest of the API needs is re-exported from here, so the module
 * can be deleted by removing this directory and its two call sites
 * (`routes/index.ts` and the `/ws/voice-coach` upgrade in `index.ts`).
 */

export {
  createVoiceCoachService,
  createSessionRegistry,
  createVoiceCoachSocketHandler,
  createGeminiLiveProvider,
  createStubLiveProvider,
  buildCoachInstruction,
  COACH_DIMENSIONS,
  MAX_TIP_WORDS,
};

export type {
  RunningSession,
  VoiceCoachService,
  VoiceCoachServiceDeps,
  SessionRegistry,
  VoiceCoachSocketHandle,
  VoiceCoachSocketOptions,
  GeminiLiveProviderOptions,
  StubLiveProviderOptions,
  LiveSessionProvider,
};

/** Which live provider to build, decided once at boot from config. */
export interface LiveProviderChoice {
  kind: 'gemini' | 'stub';
  gemini?: GeminiLiveProviderOptions;
  stub?: StubLiveProviderOptions;
}

/** Builds the provider the coach will use. Never both. */
export function createLiveProvider(choice: LiveProviderChoice): LiveSessionProvider {
  if (choice.kind === 'gemini') {
    if (choice.gemini === undefined) {
      throw new Error('createLiveProvider: gemini options are required for kind "gemini".');
    }
    return createGeminiLiveProvider(choice.gemini);
  }
  return createStubLiveProvider(choice.stub ?? {});
}
