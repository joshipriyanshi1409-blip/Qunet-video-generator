export { computeDnaCompleteness } from './dnaCompleteness.js';
export type { DnaCompleteness } from './dnaCompleteness.js';

export { computeDnaConsistency, computeDnaSyncScore } from './dnaSyncScore.js';
export type { DnaConsistency } from './dnaSyncScore.js';

export {
  buildDnaContext,
  DNA_CONTEXT_HISTORY_LIMIT,
  DNA_CONTEXT_TOKEN_BUDGET,
  estimateTokens,
  formatDnaBlock,
  formatHistoryItem,
} from './dnaContext.js';
export type { DnaContext, DnaContextInput } from './dnaContext.js';

export {
  blendTrendRelevance,
  computeTrendRelevance,
  rankTrends,
  rankTrendsByPopularity,
  tokenize,
  type RelevanceDna,
  type TrendRelevanceResult,
  type TrendRelevanceSignals,
} from './trendRelevance.js';

export {
  LIVE_LIMITS,
  dailyCapReached,
  reconnectDelayMs,
  remainingSessionSeconds,
  remainingToday,
  sessionProgress,
  sessionTimeExpired,
  shouldReconnect,
  toQuotaResponse,
  utcDayKey,
  type LiveLimits,
} from './liveCoachLimits.js';
export * from './renderProgress.js';
