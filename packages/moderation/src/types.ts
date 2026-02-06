import type { Request, Response } from 'express';
import type { QuarantineService, QuarantineRecordAttributes } from '@clawexchange/quarantine';
import type { AuditLogger } from '@clawexchange/audit';

// ── Quarantine query extension ──────────────────────────────────

/** Filters for querying quarantine records */
export interface QuarantineQueryOptions {
  /** Filter by quarantine status */
  status?: string;
  /** Filter by risk tier */
  tier?: string;
  /** Maximum results to return */
  limit: number;
  /** Offset for pagination */
  offset: number;
}

/** Paginated query result from quarantine */
export interface QuarantineQueryResult {
  items: QuarantineRecordAttributes[];
  total: number;
}

/**
 * Callback to query quarantine records with filters and pagination.
 * The base QuarantineService doesn't expose listing — consumers
 * provide this via their Sequelize model or a thin wrapper.
 */
export type QuarantineQueryFn = (options: QuarantineQueryOptions) => Promise<QuarantineQueryResult>;

// ── Envelope types ──────────────────────────────────────────────

/** A redacted pattern match safe for bot consumption */
export interface RedactedMatch {
  /** Pattern identifier, e.g. "aws-access-key" */
  patternId: string;
  /** Redacted text (no raw content) */
  redacted: string;
}

/**
 * Structured envelope sent to bots. NEVER contains raw content.
 * Bots make moderation decisions based only on this envelope.
 */
export interface StructuredEnvelope {
  /** Quarantine record ID */
  id: string;
  /** Risk tier from SSG */
  tier: string;
  /** Detection labels from plugins */
  labels: string[];
  /** Redacted pattern matches (no raw content exposed) */
  matches: RedactedMatch[];
  /** Auto-generated summary describing what was detected */
  summary: string;
  /** Content type that was inspected */
  contentType: string | null;
  /** Source identifier (e.g. post ID) */
  sourceId: string | null;
  /** When the content was quarantined */
  quarantinedAt: string;
  /** When the quarantine expires */
  expiresAt: string;
}

// ── Action types ────────────────────────────────────────────────

/** Actions a bot can take on quarantined content */
export type BotAction = 'release' | 'delete' | 'escalate';

/** Actions a human admin can take on quarantined content */
export type HumanAction = 'release' | 'delete';

/**
 * Fixed-schema action request from bots.
 * No free-text fields — bots can only select from predefined options.
 */
export interface BotActionRequest {
  /** Quarantine record ID */
  quarantineId: string;
  /** Action to take */
  action: BotAction;
  /** Bot's confidence level (0.0 to 1.0) */
  confidence: number;
  /** Reason code from predefined set */
  reason: BotActionReason;
}

/** Predefined reason codes for bot actions (no free-text) */
export type BotActionReason =
  | 'FALSE_POSITIVE'
  | 'TRUE_POSITIVE_LOW_RISK'
  | 'TRUE_POSITIVE_HIGH_RISK'
  | 'NEEDS_HUMAN_REVIEW'
  | 'POLICY_VIOLATION'
  | 'DUPLICATE_CONTENT';

/**
 * Action request from human admin.
 */
export interface HumanActionRequest {
  /** Quarantine record ID */
  quarantineId: string;
  /** Action to take */
  action: HumanAction;
  /** Human-readable notes (optional) */
  notes?: string;
}

// ── Queue types ─────────────────────────────────────────────────

/** A paginated list of envelopes for the bot queue */
export interface BotQueueResponse {
  /** List of envelopes for items awaiting review */
  items: StructuredEnvelope[];
  /** Total count of items in queue */
  total: number;
  /** Current page offset */
  offset: number;
  /** Page size limit */
  limit: number;
}

/** Parameters for querying the bot queue */
export interface QueueQueryParams {
  /** Filter by risk tier */
  tier?: string;
  /** Page offset (default: 0) */
  offset?: number;
  /** Page size limit (default: 20, max: 100) */
  limit?: number;
}

// ── Human list types ────────────────────────────────────────────

/** A quarantine record with metadata for human review list */
export interface QuarantineListItem {
  /** Quarantine record ID */
  id: string;
  /** Current status */
  status: string;
  /** Risk tier */
  tier: string;
  /** Detection labels */
  labels: string[];
  /** Content type */
  contentType: string | null;
  /** Source identifier */
  sourceId: string | null;
  /** Content size in bytes */
  sizeBytes: number;
  /** When quarantined */
  createdAt: string;
  /** When it expires */
  expiresAt: string;
  /** Who reviewed it (if reviewed) */
  reviewedBy: string | null;
}

/** Response for human quarantine list */
export interface QuarantineListResponse {
  items: QuarantineListItem[];
  total: number;
  offset: number;
  limit: number;
}

/** Parameters for querying the human quarantine list */
export interface QuarantineListParams {
  /** Filter by status */
  status?: string;
  /** Filter by risk tier */
  tier?: string;
  /** Page offset (default: 0) */
  offset?: number;
  /** Page size limit (default: 20, max: 100) */
  limit?: number;
}

// ── Content access types ────────────────────────────────────────

/** Response for content access request (signed URL) */
export interface ContentAccessResponse {
  /** Time-limited signed URL for accessing quarantined content */
  signedUrl: string;
  /** When the signed URL expires (ISO 8601) */
  expiresAt: string;
}

// ── Configuration ───────────────────────────────────────────────

/** Authentication/authorization middleware function */
export type AuthMiddleware = (req: Request, res: Response, next: () => void) => void;

/** Configuration for creating a moderation router */
export interface ModerationConfig {
  /** Quarantine service instance */
  quarantine: QuarantineService;
  /** Audit logger instance */
  audit: AuditLogger;
  /**
   * Query function for listing quarantine records.
   * Required because the base QuarantineService only supports
   * single-record lookup; listing requires direct DB access.
   */
  queryQuarantine: QuarantineQueryFn;
  /** Middleware to authenticate bot requests */
  botAuth: AuthMiddleware;
  /** Middleware to authenticate human admin requests */
  humanAuth: AuthMiddleware;
  /** Signed URL expiry in seconds (default: 300 = 5 minutes) */
  signedUrlExpiry?: number;
}

// ── Service types ───────────────────────────────────────────────

/** Result of a moderation action */
export interface ActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** Updated status of the quarantine record */
  newStatus: string;
  /** Message describing what happened */
  message: string;
}

/** Moderation service interface */
export interface ModerationService {
  /** Get a paginated queue of items for bot review */
  getQueue(params: QueueQueryParams): Promise<BotQueueResponse>;
  /** Execute a bot action */
  executeBotAction(request: BotActionRequest, botId: string): Promise<ActionResult>;
  /** List quarantine records for human review */
  listQuarantine(params: QuarantineListParams): Promise<QuarantineListResponse>;
  /** Generate a signed URL for human content access */
  getContentAccess(quarantineId: string, adminId: string): Promise<ContentAccessResponse>;
  /** Execute a human action */
  executeHumanAction(request: HumanActionRequest, adminId: string): Promise<ActionResult>;
}
