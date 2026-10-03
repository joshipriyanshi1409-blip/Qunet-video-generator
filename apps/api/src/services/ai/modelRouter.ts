/**
 * AI Model Router and Provider Abstraction.
 *
 * Provides a unified interface for different AI capabilities (text, image,
 * video, TTS, STT, music, embeddings, moderation, vision) with swappable
 * provider backends.
 *
 * Each capability type has its own provider interface, and the ModelRouter
 * selects the appropriate provider based on configuration and task requirements.
 */

import type { Logger } from 'pino';

/** All supported AI capability types. */
export const AI_CAPABILITIES = [
  'TEXT_GENERATION',
  'REASONING',
  'IMAGE_GENERATION',
  'VIDEO_GENERATION',
  'TTS',
  'STT',
  'MUSIC_GENERATION',
  'EMBEDDINGS',
  'MODERATION',
  'VISION',
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Provider status for health checks. */
export type ProviderStatus = 'available' | 'not_configured' | 'error' | 'disabled';

/** Information about a registered provider. */
export interface ProviderInfo {
  id: string;
  name: string;
  capabilities: readonly AiCapability[];
  status: ProviderStatus;
  /** Whether this provider requires an API key that is configured. */
  configured: boolean;
  /** Cost tier: 1=cheapest, 3=most expensive. */
  costTier: 1 | 2 | 3;
  /** Relative speed: 1=slowest, 3=fastest. */
  speedTier: 1 | 2 | 3;
}

/** Model selection criteria for the router. */
export interface ModelSelectionCriteria {
  capability: AiCapability;
  /** Prefer cheapest model that meets quality needs. */
  priority?: 'cost' | 'quality' | 'speed' | 'balanced';
  /** Specific provider to use if available. */
  preferredProvider?: string;
  /** Minimum quality tier required. */
  minQuality?: 1 | 2 | 3;
}

/** A registered provider adapter. */
export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly AiCapability[];
  readonly costTier: 1 | 2 | 3;
  readonly speedTier: 1 | 2 | 3;

  /** Check if this provider can handle the capability. */
  supports(capability: AiCapability): boolean;

  /** Get the current status of this provider. */
  getStatus(): ProviderStatus;

  /** Health check - verify the provider is reachable and configured. */
  healthCheck(): Promise<boolean>;
}

/** Text generation provider interface. */
export interface TextProvider extends ProviderAdapter {
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
}

export interface TextGenerationRequest {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface TextGenerationResponse {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model: string;
  };
}

/** Image generation provider interface. */
export interface ImageProvider extends ProviderAdapter {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
}

export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
  model?: string;
  style?: string;
  signal?: AbortSignal;
}

export interface ImageGenerationResponse {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  note: string;
}

/** Video generation provider interface. */
export interface VideoProvider extends ProviderAdapter {
  generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse>;
}

export interface VideoGenerationRequest {
  prompt: string;
  durationSeconds: number;
  width: number;
  height: number;
  model?: string;
  signal?: AbortSignal;
}

export interface VideoGenerationResponse {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  durationSeconds: number;
  note: string;
}

/** TTS provider interface. */
export interface TtsProvider extends ProviderAdapter {
  synthesize(request: TtsRequest): Promise<TtsResponse>;
}

export interface TtsRequest {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  style?: string;
  language?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface TtsResponse {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  durationSeconds: number;
  note: string;
}

/** Music generation provider interface. */
export interface MusicProvider extends ProviderAdapter {
  compose(request: MusicGenerationRequest): Promise<MusicGenerationResponse>;
}

export interface MusicGenerationRequest {
  prompt: string;
  durationSeconds: number;
  model?: string;
  signal?: AbortSignal;
}

export interface MusicGenerationResponse {
  bytes: Buffer;
  mimeType: string;
  extension: string;
  durationSeconds: number;
  note: string;
}

/**
 * The Model Router - selects and manages AI providers.
 *
 * Responsibilities:
 * - Maintain a registry of available providers
 * - Select the best provider for each task based on criteria
 * - Handle provider fallback when primary is unavailable
 * - Report provider status for health checks
 */
export interface ModelRouter {
  /** Get all registered providers. */
  getProviders(): readonly ProviderInfo[];

  /** Get the status of a specific capability. */
  getCapabilityStatus(capability: AiCapability): ProviderStatus;

  /** Select the best model/provider for a task. */
  selectModel(criteria: ModelSelectionCriteria): ProviderInfo | null;

  /** Get a text provider. */
  getTextProvider(preferredProvider?: string): TextProvider | null;

  /** Get an image provider. */
  getImageProvider(preferredProvider?: string): ImageProvider | null;

  /** Get a video provider. */
  getVideoProvider(preferredProvider?: string): VideoProvider | null;

  /** Get a TTS provider. */
  getTtsProvider(preferredProvider?: string): TtsProvider | null;

  /** Get a music provider. */
  getMusicProvider(preferredProvider?: string): MusicProvider | null;

  /** Run health checks on all providers. */
  healthCheck(): Promise<Record<string, ProviderStatus>>;
}

export interface ModelRouterDeps {
  logger: Logger;
  textProviders?: TextProvider[];
  imageProviders?: ImageProvider[];
  videoProviders?: VideoProvider[];
  ttsProviders?: TtsProvider[];
  musicProviders?: MusicProvider[];
}

export function createModelRouter(deps: ModelRouterDeps): ModelRouter {
  const { logger } = deps;

  const allProviders: ProviderAdapter[] = [
    ...(deps.textProviders ?? []),
    ...(deps.imageProviders ?? []),
    ...(deps.videoProviders ?? []),
    ...(deps.ttsProviders ?? []),
    ...(deps.musicProviders ?? []),
  ];

  function getProviders(): ProviderInfo[] {
    return allProviders.map((p) => ({
      id: p.id,
      name: p.name,
      capabilities: p.capabilities,
      status: p.getStatus(),
      configured: p.getStatus() !== 'not_configured',
      costTier: p.costTier,
      speedTier: p.speedTier,
    }));
  }

  function getCapabilityStatus(capability: AiCapability): ProviderStatus {
    const providers = allProviders.filter((p) => p.supports(capability));
    if (providers.length === 0) return 'not_configured';
    if (providers.some((p) => p.getStatus() === 'available')) return 'available';
    if (providers.some((p) => p.getStatus() === 'error')) return 'error';
    return 'not_configured';
  }

  function selectModel(criteria: ModelSelectionCriteria): ProviderInfo | null {
    const providers = allProviders.filter(
      (p) => p.supports(criteria.capability) && p.getStatus() === 'available',
    );
    if (providers.length === 0) return null;

    if (criteria.preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === criteria.preferredProvider);
      if (preferred !== undefined) {
        return {
          id: preferred.id,
          name: preferred.name,
          capabilities: preferred.capabilities,
          status: preferred.getStatus(),
          configured: true,
          costTier: preferred.costTier,
          speedTier: preferred.speedTier,
        };
      }
    }

    const priority = criteria.priority ?? 'balanced';
    let sorted: ProviderAdapter[];

    switch (priority) {
      case 'cost':
        sorted = [...providers].sort((a, b) => a.costTier - b.costTier);
        break;
      case 'quality':
        sorted = [...providers].sort((a, b) => b.costTier - a.costTier);
        break;
      case 'speed':
        sorted = [...providers].sort((a, b) => b.speedTier - a.speedTier);
        break;
      case 'balanced':
      default:
        // Balanced: prefer quality tier 2, then sort by cost
        sorted = [...providers].sort((a, b) => {
          const qualityDiff = Math.abs(b.costTier - 2) - Math.abs(a.costTier - 2);
          if (qualityDiff !== 0) return qualityDiff;
          return a.costTier - b.costTier;
        });
        break;
    }

    const selected = sorted[0];
    if (selected === undefined) return null;

    logger.debug(
      { capability: criteria.capability, provider: selected.id, priority },
      'model router selected provider',
    );

    return {
      id: selected.id,
      name: selected.name,
      capabilities: selected.capabilities,
      status: selected.getStatus(),
      configured: true,
      costTier: selected.costTier,
      speedTier: selected.speedTier,
    };
  }

  function getTextProvider(preferredProvider?: string): TextProvider | null {
    const providers = deps.textProviders ?? [];
    if (preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === preferredProvider);
      if (preferred !== undefined && preferred.getStatus() === 'available') return preferred;
    }
    return providers.find((p) => p.getStatus() === 'available') ?? null;
  }

  function getImageProvider(preferredProvider?: string): ImageProvider | null {
    const providers = deps.imageProviders ?? [];
    if (preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === preferredProvider);
      if (preferred !== undefined && preferred.getStatus() === 'available') return preferred;
    }
    return providers.find((p) => p.getStatus() === 'available') ?? null;
  }

  function getVideoProvider(preferredProvider?: string): VideoProvider | null {
    const providers = deps.videoProviders ?? [];
    if (preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === preferredProvider);
      if (preferred !== undefined && preferred.getStatus() === 'available') return preferred;
    }
    return providers.find((p) => p.getStatus() === 'available') ?? null;
  }

  function getTtsProvider(preferredProvider?: string): TtsProvider | null {
    const providers = deps.ttsProviders ?? [];
    if (preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === preferredProvider);
      if (preferred !== undefined && preferred.getStatus() === 'available') return preferred;
    }
    return providers.find((p) => p.getStatus() === 'available') ?? null;
  }

  function getMusicProvider(preferredProvider?: string): MusicProvider | null {
    const providers = deps.musicProviders ?? [];
    if (preferredProvider !== undefined) {
      const preferred = providers.find((p) => p.id === preferredProvider);
      if (preferred !== undefined && preferred.getStatus() === 'available') return preferred;
    }
    return providers.find((p) => p.getStatus() === 'available') ?? null;
  }

  async function healthCheck(): Promise<Record<string, ProviderStatus>> {
    const results: Record<string, ProviderStatus> = {};
    for (const provider of allProviders) {
      try {
        const healthy = await provider.healthCheck();
        results[provider.id] = healthy ? provider.getStatus() : 'error';
      } catch {
        results[provider.id] = 'error';
      }
    }
    return results;
  }

  return {
    getProviders,
    getCapabilityStatus,
    selectModel,
    getTextProvider,
    getImageProvider,
    getVideoProvider,
    getTtsProvider,
    getMusicProvider,
    healthCheck,
  };
}
