import type { Sequelize, Model, ModelStatic } from 'sequelize';

/** All event types that can be recorded in the audit log */
export enum AuditEventType {
  /** SSG inspection resulted in PASS verdict */
  SSG_PASS = 'SSG_PASS',
  /** SSG inspection resulted in WARN verdict */
  SSG_WARN = 'SSG_WARN',
  /** SSG inspection resulted in QUARANTINE verdict */
  SSG_QUARANTINE = 'SSG_QUARANTINE',
  /** SSG inspection resulted in BLOCK verdict */
  SSG_BLOCK = 'SSG_BLOCK',
  /** Bot released content from quarantine */
  BOT_RELEASE = 'BOT_RELEASE',
  /** Bot deleted quarantined content */
  BOT_DELETE = 'BOT_DELETE',
  /** Bot escalated content for human review */
  BOT_ESCALATE = 'BOT_ESCALATE',
  /** Human admin released content from quarantine */
  HUMAN_RELEASE = 'HUMAN_RELEASE',
  /** Human admin deleted quarantined content */
  HUMAN_DELETE = 'HUMAN_DELETE',
  /** Human admin viewed quarantined content */
  HUMAN_VIEW_CONTENT = 'HUMAN_VIEW_CONTENT',
}

/** An audit event to be logged */
export interface AuditEvent {
  /** The type of event being logged */
  eventType: AuditEventType;
  /** ID of the actor performing the action (agent ID, bot ID, or admin ID) */
  actorId: string;
  /** Type of actor: 'agent', 'bot', or 'human' */
  actorType: 'agent' | 'bot' | 'human';
  /** ID of the target resource (post ID, quarantine record ID, etc.) */
  targetId?: string;
  /** Type of the target resource */
  targetType?: string;
  /** IP address of the request origin (will be masked for privacy) */
  ipAddress?: string;
  /** Additional structured metadata for the event */
  metadata?: Record<string, unknown>;
}

/** Filters for querying audit logs */
export interface AuditQueryFilters {
  /** Filter by event type(s) */
  eventType?: AuditEventType | AuditEventType[];
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by actor type */
  actorType?: 'agent' | 'bot' | 'human';
  /** Filter by target ID */
  targetId?: string;
  /** Filter events after this date (inclusive) */
  startDate?: Date;
  /** Filter events before this date (inclusive) */
  endDate?: Date;
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
}

/** A single audit log entry as returned from the database */
export interface AuditLogEntry {
  /** Unique identifier for this log entry */
  id: string;
  /** The type of event */
  eventType: AuditEventType;
  /** ID of the actor */
  actorId: string;
  /** Type of actor */
  actorType: 'agent' | 'bot' | 'human';
  /** ID of the target resource */
  targetId: string | null;
  /** Type of the target resource */
  targetType: string | null;
  /** Masked IP address */
  ipAddress: string | null;
  /** Additional metadata */
  metadata: Record<string, unknown> | null;
  /** When the event was recorded */
  createdAt: Date;
}

/** Configuration for creating an AuditLogger instance */
export interface AuditConfig {
  /** Sequelize instance connected to the database */
  database: Sequelize;
  /** Whether audit logging is enabled (default: true) */
  enabled?: boolean;
}

/** Audit logger service interface */
export interface AuditLogger {
  /** Log an audit event to the append-only audit trail */
  log(event: AuditEvent): Promise<void>;
  /** Query audit logs with optional filters */
  query(filters: AuditQueryFilters): Promise<AuditLogEntry[]>;
}

/** Internal model attributes for Sequelize */
export interface AuditLogAttributes {
  id: string;
  eventType: AuditEventType;
  actorId: string;
  actorType: 'agent' | 'bot' | 'human';
  targetId: string | null;
  targetType: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Sequelize model type for AuditLog */
export type AuditLogModel = ModelStatic<Model<AuditLogAttributes>>;
