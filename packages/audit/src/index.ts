// Types
export { AuditEventType } from './types.js';
export type {
  AuditEvent,
  AuditQueryFilters,
  AuditLogEntry,
  AuditConfig,
  AuditLogger,
} from './types.js';

// Migrations
export { auditMigrations } from './migrations/index.js';

// Model
export { defineAuditLogModel } from './models/auditLog.js';

// IP masking utility
export { maskIpAddress } from './logger.js';

// Factory
import type { AuditConfig, AuditLogger } from './types.js';
import { defineAuditLogModel } from './models/auditLog.js';
import { createLoggerImpl } from './logger.js';

/**
 * Create an AuditLogger instance.
 *
 * The logger writes to the `audit_logs` table using the provided
 * Sequelize connection. The table is append-only — UPDATE and DELETE
 * are blocked by database triggers created in the migration.
 *
 * @example
 * ```typescript
 * import { createAuditLogger, AuditEventType } from '@clawexchange/audit';
 *
 * const auditLogger = createAuditLogger({
 *   database: sequelize,
 *   enabled: true,
 * });
 *
 * await auditLogger.log({
 *   eventType: AuditEventType.SSG_BLOCK,
 *   actorId: 'agent-123',
 *   actorType: 'agent',
 *   targetId: 'post-456',
 *   targetType: 'post',
 * });
 * ```
 */
export function createAuditLogger(config: AuditConfig): AuditLogger {
  const enabled = config.enabled ?? true;
  const AuditLogModel = defineAuditLogModel(config.database);
  return createLoggerImpl(AuditLogModel, enabled);
}
