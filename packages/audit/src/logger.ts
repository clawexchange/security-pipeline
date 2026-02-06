import type { Model, ModelStatic, WhereOptions } from 'sequelize';
import { Op } from 'sequelize';
import type {
  AuditEvent,
  AuditQueryFilters,
  AuditLogEntry,
  AuditLogAttributes,
  AuditLogger,
} from './types.js';

/**
 * Mask an IP address for privacy.
 *
 * IPv4: zeroes the last octet       → 192.168.1.100 → 192.168.1.0
 * IPv6: zeroes the last 80 bits     → 2001:db8::1   → 2001:db8::
 * Invalid or missing: returns null.
 */
export function maskIpAddress(ip: string | undefined | null): string | null {
  if (!ip) return null;

  const trimmed = ip.trim();
  if (!trimmed) return null;

  // IPv4 pattern
  if (trimmed.includes('.') && !trimmed.includes(':')) {
    const parts = trimmed.split('.');
    if (parts.length !== 4) return null;
    parts[3] = '0';
    return parts.join('.');
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  if (trimmed.includes(':') && trimmed.includes('.')) {
    const lastColon = trimmed.lastIndexOf(':');
    const ipv4Part = trimmed.substring(lastColon + 1);
    const prefix = trimmed.substring(0, lastColon + 1);
    const parts = ipv4Part.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return prefix + parts.join('.');
    }
    return null;
  }

  // Pure IPv6 pattern
  if (trimmed.includes(':')) {
    const colonIndex = trimmed.lastIndexOf(':');
    const prefix = trimmed.substring(0, colonIndex);
    return prefix + ':0';
  }

  return null;
}

/**
 * Create the audit logger implementation.
 * Wraps a Sequelize model to provide log() and query() methods.
 */
export function createLoggerImpl(
  AuditLogModel: ModelStatic<Model<AuditLogAttributes>>,
  enabled: boolean,
): AuditLogger {
  return {
    async log(event: AuditEvent): Promise<void> {
      if (!enabled) return;

      await AuditLogModel.create({
        eventType: event.eventType,
        actorId: event.actorId,
        actorType: event.actorType,
        targetId: event.targetId ?? null,
        targetType: event.targetType ?? null,
        ipAddress: maskIpAddress(event.ipAddress),
        metadata: event.metadata ?? null,
      } as unknown as AuditLogAttributes);
    },

    async query(filters: AuditQueryFilters): Promise<AuditLogEntry[]> {
      const where: WhereOptions = {};

      if (filters.eventType) {
        if (Array.isArray(filters.eventType)) {
          where['event_type'] = { [Op.in]: filters.eventType };
        } else {
          where['event_type'] = filters.eventType;
        }
      }

      if (filters.actorId) {
        where['actor_id'] = filters.actorId;
      }

      if (filters.actorType) {
        where['actor_type'] = filters.actorType;
      }

      if (filters.targetId) {
        where['target_id'] = filters.targetId;
      }

      if (filters.startDate || filters.endDate) {
        const dateFilter: Record<symbol, Date> = {};
        if (filters.startDate) {
          dateFilter[Op.gte] = filters.startDate;
        }
        if (filters.endDate) {
          dateFilter[Op.lte] = filters.endDate;
        }
        where['created_at'] = dateFilter;
      }

      const rows = await AuditLogModel.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: filters.limit ?? 100,
        offset: filters.offset ?? 0,
      });

      return rows.map((row) => {
        // Sequelize returns camelCase attribute names from the model
        // definition, regardless of the `underscored` setting.
        const data = row.get({ plain: true }) as unknown as Record<string, unknown>;
        return {
          id: data['id'] as string,
          eventType: (data['eventType'] ?? data['event_type']) as AuditLogEntry['eventType'],
          actorId: (data['actorId'] ?? data['actor_id']) as string,
          actorType: (data['actorType'] ?? data['actor_type']) as AuditLogEntry['actorType'],
          targetId: ((data['targetId'] ?? data['target_id']) as string) ?? null,
          targetType: ((data['targetType'] ?? data['target_type']) as string) ?? null,
          ipAddress: ((data['ipAddress'] ?? data['ip_address']) as string) ?? null,
          metadata: ((data['metadata']) as Record<string, unknown>) ?? null,
          createdAt: (data['createdAt'] ?? data['created_at']) as Date,
        };
      });
    },
  };
}
