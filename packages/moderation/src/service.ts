import { AuditEventType } from '@clawexchange/audit';
import type { QuarantineRecordAttributes } from '@clawexchange/quarantine';
import { buildEnvelope } from './envelopeBuilder.js';
import type {
  ModerationService,
  ModerationConfig,
  QueueQueryParams,
  BotQueueResponse,
  BotActionRequest,
  QuarantineListParams,
  QuarantineListResponse,
  QuarantineListItem,
  HumanActionRequest,
  ContentAccessResponse,
  ActionResult,
} from './types.js';

const VALID_BOT_ACTIONS = new Set(['release', 'delete', 'escalate']);
const VALID_HUMAN_ACTIONS = new Set(['release', 'delete']);
const VALID_BOT_REASONS = new Set([
  'FALSE_POSITIVE',
  'TRUE_POSITIVE_LOW_RISK',
  'TRUE_POSITIVE_HIGH_RISK',
  'NEEDS_HUMAN_REVIEW',
  'POLICY_VIOLATION',
  'DUPLICATE_CONTENT',
]);

function clampLimit(limit: number | undefined, max: number, defaultVal: number): number {
  if (limit === undefined || limit < 1) return defaultVal;
  return Math.min(limit, max);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || offset < 0) return 0;
  return offset;
}

function toListItem(record: QuarantineRecordAttributes): QuarantineListItem {
  return {
    id: record.id,
    status: record.status,
    tier: record.tier,
    labels: record.labels,
    contentType: record.contentType,
    sourceId: record.sourceId,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    reviewedBy: record.reviewedBy,
  };
}

/**
 * Create a ModerationService backed by quarantine and audit services.
 */
export function createModerationService(config: ModerationConfig): ModerationService {
  const { quarantine, audit, queryQuarantine, signedUrlExpiry = 300 } = config;

  return {
    async getQueue(params: QueueQueryParams): Promise<BotQueueResponse> {
      const limit = clampLimit(params.limit, 100, 20);
      const offset = clampOffset(params.offset);

      // Query quarantine for items with QUARANTINED status (bot queue only sees pending items)
      const result = await queryQuarantine({
        status: 'QUARANTINED',
        tier: params.tier,
        limit,
        offset,
      });

      const items = result.items.map((record) => buildEnvelope(record));

      return {
        items,
        total: result.total,
        offset,
        limit,
      };
    },

    async executeBotAction(request: BotActionRequest, botId: string): Promise<ActionResult> {
      // Validate action
      if (!VALID_BOT_ACTIONS.has(request.action)) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: `Invalid action: ${request.action}. Must be one of: release, delete, escalate`,
        };
      }

      // Validate reason
      if (!VALID_BOT_REASONS.has(request.reason)) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: `Invalid reason: ${request.reason}`,
        };
      }

      // Validate confidence
      if (typeof request.confidence !== 'number' || request.confidence < 0 || request.confidence > 1) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: 'Confidence must be a number between 0.0 and 1.0',
        };
      }

      // Fetch the record to ensure it exists
      const record = await quarantine.getMetadata(request.quarantineId);
      if (!record) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: `Quarantine record not found: ${request.quarantineId}`,
        };
      }

      // Only act on QUARANTINED items
      if (record.status !== 'QUARANTINED') {
        return {
          success: false,
          newStatus: record.status,
          message: `Cannot act on record with status: ${record.status}`,
        };
      }

      const reviewNotes = `action=${request.action} reason=${request.reason} confidence=${request.confidence}`;

      switch (request.action) {
        case 'release': {
          await quarantine.updateStatus(request.quarantineId, 'RELEASED', botId, reviewNotes);
          await audit.log({
            eventType: AuditEventType.BOT_RELEASE,
            actorId: botId,
            actorType: 'bot',
            targetId: request.quarantineId,
            targetType: 'quarantine_record',
            metadata: { reason: request.reason, confidence: request.confidence },
          });
          return { success: true, newStatus: 'RELEASED', message: 'Content released from quarantine' };
        }

        case 'delete': {
          await quarantine.updateStatus(request.quarantineId, 'DELETED', botId, reviewNotes);
          await audit.log({
            eventType: AuditEventType.BOT_DELETE,
            actorId: botId,
            actorType: 'bot',
            targetId: request.quarantineId,
            targetType: 'quarantine_record',
            metadata: { reason: request.reason, confidence: request.confidence },
          });
          return { success: true, newStatus: 'DELETED', message: 'Quarantined content deleted' };
        }

        case 'escalate': {
          await quarantine.updateStatus(request.quarantineId, 'UNDER_REVIEW', botId, reviewNotes);
          await audit.log({
            eventType: AuditEventType.BOT_ESCALATE,
            actorId: botId,
            actorType: 'bot',
            targetId: request.quarantineId,
            targetType: 'quarantine_record',
            metadata: { reason: request.reason, confidence: request.confidence },
          });
          return { success: true, newStatus: 'UNDER_REVIEW', message: 'Content escalated for human review' };
        }

        default:
          return { success: false, newStatus: record.status, message: 'Unknown action' };
      }
    },

    async listQuarantine(params: QuarantineListParams): Promise<QuarantineListResponse> {
      const limit = clampLimit(params.limit, 100, 20);
      const offset = clampOffset(params.offset);

      const result = await queryQuarantine({
        status: params.status,
        tier: params.tier,
        limit,
        offset,
      });

      const items = result.items.map(toListItem);

      return {
        items,
        total: result.total,
        offset,
        limit,
      };
    },

    async getContentAccess(quarantineId: string, adminId: string): Promise<ContentAccessResponse> {
      // Verify record exists
      const record = await quarantine.getMetadata(quarantineId);
      if (!record) {
        throw new Error(`Quarantine record not found: ${quarantineId}`);
      }

      // Log the content access in audit trail
      await audit.log({
        eventType: AuditEventType.HUMAN_VIEW_CONTENT,
        actorId: adminId,
        actorType: 'human',
        targetId: quarantineId,
        targetType: 'quarantine_record',
      });

      // Generate time-limited signed URL
      const signedUrl = await quarantine.generateSignedUrl(quarantineId, signedUrlExpiry);
      const expiresAt = new Date(Date.now() + signedUrlExpiry * 1000).toISOString();

      return { signedUrl, expiresAt };
    },

    async executeHumanAction(request: HumanActionRequest, adminId: string): Promise<ActionResult> {
      // Validate action
      if (!VALID_HUMAN_ACTIONS.has(request.action)) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: `Invalid action: ${request.action}. Must be one of: release, delete`,
        };
      }

      // Fetch the record
      const record = await quarantine.getMetadata(request.quarantineId);
      if (!record) {
        return {
          success: false,
          newStatus: 'QUARANTINED',
          message: `Quarantine record not found: ${request.quarantineId}`,
        };
      }

      // Humans can act on QUARANTINED or UNDER_REVIEW items
      if (record.status !== 'QUARANTINED' && record.status !== 'UNDER_REVIEW') {
        return {
          success: false,
          newStatus: record.status,
          message: `Cannot act on record with status: ${record.status}`,
        };
      }

      const reviewNotes = request.notes ?? `action=${request.action}`;

      switch (request.action) {
        case 'release': {
          await quarantine.updateStatus(request.quarantineId, 'RELEASED', adminId, reviewNotes);
          await audit.log({
            eventType: AuditEventType.HUMAN_RELEASE,
            actorId: adminId,
            actorType: 'human',
            targetId: request.quarantineId,
            targetType: 'quarantine_record',
            metadata: request.notes ? { notes: request.notes } : undefined,
          });
          return { success: true, newStatus: 'RELEASED', message: 'Content released from quarantine' };
        }

        case 'delete': {
          await quarantine.updateStatus(request.quarantineId, 'DELETED', adminId, reviewNotes);
          await audit.log({
            eventType: AuditEventType.HUMAN_DELETE,
            actorId: adminId,
            actorType: 'human',
            targetId: request.quarantineId,
            targetType: 'quarantine_record',
            metadata: request.notes ? { notes: request.notes } : undefined,
          });
          return { success: true, newStatus: 'DELETED', message: 'Quarantined content deleted' };
        }

        default:
          return { success: false, newStatus: record.status, message: 'Unknown action' };
      }
    },
  };
}
