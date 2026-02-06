// Router factory
export { createModerationRouter } from './router.js';

// Service factory (for advanced usage without Express)
export { createModerationService } from './service.js';

// Envelope builder utilities
export { buildEnvelope, redactPattern, generateSummary } from './envelopeBuilder.js';

// Types
export type {
  StructuredEnvelope,
  RedactedMatch,
  BotAction,
  HumanAction,
  BotActionRequest,
  BotActionReason,
  HumanActionRequest,
  BotQueueResponse,
  QueueQueryParams,
  QuarantineListItem,
  QuarantineListResponse,
  QuarantineListParams,
  ContentAccessResponse,
  AuthMiddleware,
  ModerationConfig,
  ModerationService,
  ActionResult,
  QuarantineQueryOptions,
  QuarantineQueryResult,
  QuarantineQueryFn,
} from './types.js';
