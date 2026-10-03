/**
 * AI Orchestrator
 *
 * Central coordination service for the video creation pipeline.
 * Manages the flow from user idea to finished video, coordinating
 * specialized AI agents through a shared structured project context.
 *
 * The orchestrator:
 * - Understands the user request
 * - Loads Creator DNA
 * - Determines content format (AI recommended or user-selected)
 * - Manages agent execution order
 * - Runs independent tasks in parallel where possible
 * - Retries failed stages without regenerating successful ones
 * - Stores intermediate results
 * - Reports progress through WebSocket events
 */

import {
  CONTENT_FORMAT_MAP,
  CONTENT_FORMATS,
  type ContentFormatRecipe,
  type FormatRecommendation,
  type Storyboard,
  type CreatorDna,
  type RenderCreateRequest,
} from '@creatordna/shared';
import type { Logger } from 'pino';
import type { TextModelService } from './ai/index.js';
import type { ModelRouter } from './ai/modelRouter.js';

/** Pipeline stages the orchestrator manages. */
export type OrchestratorStage =
  | 'idle'
  | 'loading-dna'
  | 'analyzing-trend'
  | 'selecting-format'
  | 'generating-hooks'
  | 'selecting-hook'
  | 'analyzing-audience'
  | 'generating-script'
  | 'critiquing-script'
  | 'generating-storyboard'
  | 'generating-assets'
  | 'generating-voice'
  | 'generating-music'
  | 'generating-captions'
  | 'composing'
  | 'quality-control'
  | 'completed'
  | 'failed';

/** Shared project context that every stage reads from and writes to. */
export interface ProjectContext {
  projectId: string;
  userId: string;

  /** Creator DNA - loaded once and reused. */
  creatorDNA: CreatorDna | null;

  /** The raw user idea/topic. */
  topic: string;

  /** Selected or AI-recommended content format. */
  contentFormat: ContentFormatRecipe | null;

  /** Trend context if the idea came from a trend. */
  trendContext: {
    trendId?: string;
    originalTitle?: string;
    structure?: string[];
  } | null;

  /** Generated hooks. */
  hooks: Array<{
    id: string;
    text: string;
    style: string;
    score?: number;
    whyItWorks?: string;
  }>;

  /** Selected hook for the final video. */
  selectedHook: {
    id: string;
    text: string;
    style: string;
  } | null;

  /** Generated script. */
  script: {
    scenes: Array<{
      scene: string;
      text: string;
      duration?: number;
    }>;
    hook: string;
    cta: string;
    caption?: string;
    hashtags?: string[];
  } | null;

  /** Script evaluation from the critic. */
  scriptEvaluation: {
    verdict: 'APPROVE' | 'REVISE';
    overallScore: number;
    hookStrength: number;
    pacingScore: number;
    dnaFit: number;
    formatCompliance: number;
    feedback: string[];
    revisionSuggestions?: string[];
  } | null;

  /** The storyboard for rendering. */
  storyboard: Storyboard | null;

  /** Render request ready for the pipeline. */
  renderRequest: RenderCreateRequest | null;

  /** Current pipeline stage. */
  currentStage: OrchestratorStage;

  /** Progress percentage (0-100). */
  progress: number;

  /** Error message if failed. */
  error: string | null;

  /** Which stages have been completed. */
  completedStages: OrchestratorStage[];

  /** Cache of expensive AI results. */
  cache: Map<string, unknown>;

  /** Timestamps for each stage. */
  stageTimestamps: Map<OrchestratorStage, { startedAt: number; completedAt?: number }>;
}

/** Options for creating a project. */
export interface CreateProjectOptions {
  userId: string;
  topic: string;
  contentFormatId?: string;
  trendId?: string;
  /** Override: use a pre-selected hook. */
  hook?: string;
  /** Override: use pre-generated script. */
  script?: RenderCreateRequest['script'];
}

/** Progress event emitted during orchestration. */
export interface OrchestratorProgressEvent {
  projectId: string;
  stage: OrchestratorStage;
  progress: number;
  message?: string;
}

/** Result of a completed orchestration. */
export interface OrchestrationResult {
  success: boolean;
  projectId: string;
  renderRequest?: RenderCreateRequest;
  error?: string;
  stagesCompleted: OrchestratorStage[];
  storyboard?: Storyboard;
}

export interface OrchestratorDeps {
  logger: Logger;
  ai?: TextModelService;
  modelRouter?: ModelRouter;
  /** Read the user's Creator DNA. */
  getDna: (userId: string) => Promise<CreatorDna | null>;
  /** Emit progress events (e.g., to WebSocket). */
  emitProgress?: (event: OrchestratorProgressEvent) => void;
}

/**
 * Creates a new empty project context.
 */
export function createEmptyContext(projectId: string, userId: string, topic: string): ProjectContext {
  return {
    projectId,
    userId,
    creatorDNA: null,
    topic,
    contentFormat: null,
    trendContext: null,
    hooks: [],
    selectedHook: null,
    script: null,
    scriptEvaluation: null,
    storyboard: null,
    renderRequest: null,
    currentStage: 'idle',
    progress: 0,
    error: null,
    completedStages: [],
    cache: new Map(),
    stageTimestamps: new Map(),
  };
}

export interface Orchestrator {
  /** Create a full project context for a new video. */
  createProject(options: CreateProjectOptions): Promise<ProjectContext>;

  /** Load Creator DNA into the context. */
  loadDna(context: ProjectContext): Promise<ProjectContext>;

  /** Recommend content formats based on topic and DNA. */
  recommendFormats(
    context: ProjectContext,
    topic: string,
  ): Promise<FormatRecommendation>;

  /** Select a content format (manual or AI-recommended). */
  selectFormat(
    context: ProjectContext,
    formatId: string,
  ): ProjectContext;

  /** Build a render request from the project context. */
  buildRenderRequest(context: ProjectContext): RenderCreateRequest | null;

  /** Get the current context state. */
  getContext(projectId: string): ProjectContext | null;

  /** Update the context (e.g., after user selects a hook). */
  updateContext(projectId: string, patch: Partial<ProjectContext>): void;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { logger, getDna, emitProgress } = deps;

  const contexts = new Map<string, ProjectContext>();

  function emit(context: ProjectContext, stage: OrchestratorStage, message?: string): void {
    context.currentStage = stage;
    context.stageTimestamps.set(stage, {
      startedAt: Date.now(),
      ...context.stageTimestamps.get(stage),
    });
    emitProgress?.({
      projectId: context.projectId,
      stage,
      progress: context.progress,
      message,
    });
  }

  return {
    async createProject(options) {
      const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const context = createEmptyContext(projectId, options.userId, options.topic);

      if (options.trendId !== undefined) {
        context.trendContext = { trendId: options.trendId };
      }

      contexts.set(projectId, context);

      logger.info({ projectId, userId: options.userId, topic: options.topic }, 'project created');

      // Load DNA
      const loaded = await this.loadDna(context);

      // Select or recommend format
      if (options.contentFormatId !== undefined) {
        this.selectFormat(loaded, options.contentFormatId);
      } else {
        const recommendation = await this.recommendFormats(loaded, options.topic);
        const topFormat = recommendation.recommendations[0];
        if (topFormat !== undefined) {
          this.selectFormat(loaded, topFormat.formatId);
        }
      }

      return loaded;
    },

    async loadDna(context) {
      emit(context, 'loading-dna', 'Loading your Creator DNA...');
      try {
        const dna = await getDna(context.userId);
        context.creatorDNA = dna;
        context.completedStages.push('loading-dna');
        context.progress = 5;
        context.stageTimestamps.get('loading-dna')!.completedAt = Date.now();
        logger.info(
          { projectId: context.projectId, hasDna: dna !== null },
          'DNA loaded into project context',
        );
      } catch (error) {
        logger.warn({ projectId: context.projectId, error }, 'failed to load DNA, continuing without it');
        context.creatorDNA = null;
      }
      return context;
    },

    async recommendFormats(context, topic) {
      emit(context, 'selecting-format', 'Analyzing best format for your idea...');

      const dna = context.creatorDNA;
      const analysis = buildFormatAnalysis(topic, dna);

      // Score each format against the topic and DNA.
      // This is synchronous scoring for now; future versions will call
      // the AI model for more nuanced recommendations.
      const scored = CONTENT_FORMATS.map((format) => {
        const score = scoreFormat(format, analysis);
        return {
          formatId: format.id,
          formatName: format.name,
          score,
          reason: generateFormatReason(format, analysis),
        };
      });

      // Sort by score, take top 3
      scored.sort((a, b) => b.score - a.score);
      const top3 = scored.slice(0, 3);

      context.progress = 10;

      return Promise.resolve({
        recommendations: top3,
        analysis: `Based on your topic "${topic}"${dna ? ` and your ${dna.niche} DNA` : ''}, these formats are the best fit.`,
      });
    },

    selectFormat(context, formatId) {
      const format = CONTENT_FORMAT_MAP.get(formatId);
      if (format === undefined) {
        logger.warn({ formatId }, 'format not found, using default');
        context.contentFormat = CONTENT_FORMATS[0] ?? null;
      } else {
        context.contentFormat = format;
      }
      context.completedStages.push('selecting-format');
      context.progress = 15;

      logger.info(
        { projectId: context.projectId, formatId: context.contentFormat?.id },
        'content format selected',
      );

      return context;
    },

    buildRenderRequest(context) {
      if (context.script === null) return null;

      const request: RenderCreateRequest = {
        projectId: context.projectId,
        hook: context.selectedHook?.text ?? context.script.hook,
        script: context.script.scenes.map((s) => ({
          scene: s.scene,
          text: s.text,
        })),
        cta: context.script.cta,
        caption: context.script.caption,
        hashtags: context.script.hashtags ?? [],
        dnaVersion: context.creatorDNA?.dnaVersion,
      };

      context.renderRequest = request;
      return request;
    },

    getContext(projectId) {
      return contexts.get(projectId) ?? null;
    },

    updateContext(projectId, patch) {
      const context = contexts.get(projectId);
      if (context === undefined) return;
      Object.assign(context, patch);
    },
  };
}

/** Internal analysis of topic + DNA for format scoring. */
interface FormatAnalysis {
  keywords: string[];
  hasNarrative: boolean;
  hasEducational: boolean;
  hasEntertainment: boolean;
  hasVisual: boolean;
  hasTechnical: boolean;
  dnaNiche?: string;
  dnaTone?: string[];
  dnaFormat?: string;
  topicLength: number;
  complexityEstimate: 'simple' | 'moderate' | 'complex';
}

function buildFormatAnalysis(topic: string, dna: CreatorDna | null): FormatAnalysis {
  const lower = topic.toLowerCase();
  const keywords = lower.split(/\s+/).filter((w) => w.length > 3);

  const narrativeWords = ['story', 'tale', 'experience', 'journey', 'happened', 'once', 'confess', 'crime', 'mystery'];
  const educationalWords = ['explain', 'how', 'why', 'learn', 'teach', 'guide', 'tutorial', 'tips', 'facts', 'science'];
  const entertainmentWords = ['funny', 'amazing', 'shocking', 'satisfying', 'cool', 'insane', 'crazy', 'wow'];
  const visualWords = ['show', 'look', 'see', 'visual', 'design', 'art', 'animation', 'cinematic'];
  const technicalWords = ['code', 'programming', 'ai', 'tech', 'software', 'data', 'algorithm', 'api'];

  return {
    keywords,
    hasNarrative: narrativeWords.some((w) => lower.includes(w)),
    hasEducational: educationalWords.some((w) => lower.includes(w)),
    hasEntertainment: entertainmentWords.some((w) => lower.includes(w)),
    hasVisual: visualWords.some((w) => lower.includes(w)),
    hasTechnical: technicalWords.some((w) => lower.includes(w)),
    dnaNiche: dna?.niche,
    dnaTone: dna?.tone,
    dnaFormat: dna?.format,
    topicLength: topic.length,
    complexityEstimate: keywords.length > 20 ? 'complex' : keywords.length > 10 ? 'moderate' : 'simple',
  };
}

function scoreFormat(format: ContentFormatRecipe, analysis: FormatAnalysis): number {
  let score = 50; // base score

  // Category matching
  if (analysis.hasNarrative && ['storytelling', 'creative'].includes(format.category)) score += 15;
  if (analysis.hasEducational && ['education', 'technology'].includes(format.category)) score += 15;
  if (analysis.hasEntertainment && ['entertainment'].includes(format.category)) score += 15;
  if (analysis.hasVisual && format.visualStyle === 'cinematic') score += 10;
  if (analysis.hasTechnical && ['technology', 'business'].includes(format.category)) score += 15;

  // Complexity matching
  if (analysis.complexityEstimate === 'complex' && format.recommendedDuration.default >= 30) score += 10;
  if (analysis.complexityEstimate === 'simple' && format.recommendedDuration.default <= 25) score += 10;

  // DNA format alignment
  if (analysis.dnaFormat !== undefined) {
    const dnaFormatMap: Record<string, string[]> = {
      'talking-head': ['storytime', 'confession-stories', 'fitness'],
      'b-roll-voiceover': ['mini-documentaries', 'true-crime', 'history'],
      'screen-recording': ['tutorials', 'tech-explainers', 'gaming'],
      'tutorial': ['tutorials', 'tech-explainers', 'life-hacks'],
      'storytime': ['storytime', 'reddit-stories', 'confession-stories'],
      'listicle': ['interesting-facts', 'did-you-know', 'hidden-facts'],
    };
    const matchingFormats = dnaFormatMap[analysis.dnaFormat] ?? [];
    if (matchingFormats.includes(format.id)) score += 20;
  }

  // Topic length as a signal for complexity
  if (analysis.topicLength > 100 && format.recommendedDuration.default >= 30) score += 5;

  return Math.min(100, Math.max(0, score));
}

function generateFormatReason(format: ContentFormatRecipe, analysis: FormatAnalysis): string {
  const reasons: string[] = [];

  if (analysis.hasNarrative && ['storytelling', 'creative'].includes(format.category)) {
    reasons.push('matches the narrative nature of your topic');
  }
  if (analysis.hasEducational && ['education', 'technology'].includes(format.category)) {
    reasons.push('fits the educational angle');
  }
  if (analysis.hasTechnical && ['technology', 'business'].includes(format.category)) {
    reasons.push('aligns with the technical subject matter');
  }
  if (analysis.dnaNiche !== undefined && reasons.length === 0) {
    reasons.push(`works well with ${format.pacing} pacing for ${format.category} content`);
  }
  if (reasons.length === 0) {
    reasons.push(`good general fit with ${format.name} format`);
  }

  return reasons.join('; ');
}
