import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maskIpAddress, createLoggerImpl } from './logger.js';
import { AuditEventType } from './types.js';
import type { AuditEvent, AuditLogAttributes } from './types.js';
import type { Model, ModelStatic } from 'sequelize';

// ─── maskIpAddress ───────────────────────────────────────────────

describe('maskIpAddress', () => {
  it('masks last octet of IPv4 address', () => {
    expect(maskIpAddress('192.168.1.100')).toBe('192.168.1.0');
  });

  it('masks different IPv4 addresses', () => {
    expect(maskIpAddress('10.0.0.255')).toBe('10.0.0.0');
    expect(maskIpAddress('172.16.50.42')).toBe('172.16.50.0');
  });

  it('masks IPv6 address', () => {
    expect(maskIpAddress('2001:db8::1')).toBe('2001:db8::0');
  });

  it('masks full IPv6 address', () => {
    expect(maskIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334'))
      .toBe('2001:0db8:85a3:0000:0000:8a2e:0370:0');
  });

  it('returns null for undefined', () => {
    expect(maskIpAddress(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(maskIpAddress(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(maskIpAddress('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(maskIpAddress('   ')).toBeNull();
  });

  it('trims whitespace before masking', () => {
    expect(maskIpAddress('  192.168.1.100  ')).toBe('192.168.1.0');
  });

  it('returns null for invalid format', () => {
    expect(maskIpAddress('not-an-ip')).toBeNull();
  });

  it('handles IPv4-mapped IPv6 addresses', () => {
    const result = maskIpAddress('::ffff:192.168.1.1');
    expect(result).toBe('::ffff:192.168.1.0');
  });
});

// ─── createLoggerImpl ────────────────────────────────────────────

function createMockModel() {
  const rows: Record<string, unknown>[] = [];

  const model = {
    create: vi.fn(async (data: Record<string, unknown>) => {
      const row = {
        id: `uuid-${rows.length + 1}`,
        ...data,
        createdAt: new Date(),
      };
      rows.push(row);
      return { get: () => row };
    }),
    findAll: vi.fn(async (options: Record<string, unknown>) => {
      let result = [...rows];

      // Apply basic limit
      const limit = (options['limit'] as number) ?? 100;
      const offset = (options['offset'] as number) ?? 0;
      result = result.slice(offset, offset + limit);

      return result.map((r) => ({
        get: ({ plain }: { plain: boolean }) => plain ? { ...r } : r,
      }));
    }),
    _rows: rows,
  } as unknown as ModelStatic<Model<AuditLogAttributes>>;

  return model;
}

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventType: AuditEventType.SSG_PASS,
    actorId: 'agent-001',
    actorType: 'agent',
    ...overrides,
  };
}

describe('createLoggerImpl', () => {
  let mockModel: ReturnType<typeof createMockModel>;

  beforeEach(() => {
    mockModel = createMockModel();
  });

  describe('log()', () => {
    it('creates a row for a basic event', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.log(makeEvent({
        eventType: AuditEventType.SSG_BLOCK,
        actorId: 'agent-xyz',
        actorType: 'agent',
        targetId: 'post-123',
        targetType: 'post',
      }));

      expect(mockModel.create).toHaveBeenCalledOnce();
      const call = vi.mocked(mockModel.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(call['eventType']).toBe('SSG_BLOCK');
      expect(call['actorId']).toBe('agent-xyz');
      expect(call['actorType']).toBe('agent');
      expect(call['targetId']).toBe('post-123');
      expect(call['targetType']).toBe('post');
    });

    it('masks IP address before storing', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.log(makeEvent({ ipAddress: '10.0.0.55' }));

      const call = vi.mocked(mockModel.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(call['ipAddress']).toBe('10.0.0.0');
    });

    it('sets nullable fields to null when not provided', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.log(makeEvent());

      const call = vi.mocked(mockModel.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(call['targetId']).toBeNull();
      expect(call['targetType']).toBeNull();
      expect(call['ipAddress']).toBeNull();
      expect(call['metadata']).toBeNull();
    });

    it('stores metadata when provided', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.log(makeEvent({
        metadata: { tier: 'HIGH', score: 75 },
      }));

      const call = vi.mocked(mockModel.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(call['metadata']).toEqual({ tier: 'HIGH', score: 75 });
    });

    it('does nothing when disabled', async () => {
      const logger = createLoggerImpl(mockModel, false);

      await logger.log(makeEvent());

      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('logs all event types without error', async () => {
      const logger = createLoggerImpl(mockModel, true);

      for (const eventType of Object.values(AuditEventType)) {
        await logger.log(makeEvent({ eventType }));
      }

      expect(mockModel.create).toHaveBeenCalledTimes(
        Object.values(AuditEventType).length,
      );
    });
  });

  describe('query()', () => {
    it('returns entries in the expected format', async () => {
      const logger = createLoggerImpl(mockModel, true);

      // Insert a record first
      await logger.log(makeEvent({
        eventType: AuditEventType.SSG_QUARANTINE,
        actorId: 'agent-abc',
        actorType: 'agent',
        targetId: 'post-789',
        targetType: 'post',
        ipAddress: '192.168.0.1',
        metadata: { labels: ['SECRET'] },
      }));

      const results = await logger.query({});

      expect(results).toHaveLength(1);
      expect(results[0]!.eventType).toBe('SSG_QUARANTINE');
      expect(results[0]!.actorId).toBe('agent-abc');
      expect(results[0]!.id).toBeDefined();
    });

    it('passes filters to findAll', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.query({
        eventType: AuditEventType.SSG_BLOCK,
        actorId: 'bot-1',
        limit: 50,
        offset: 10,
      });

      expect(mockModel.findAll).toHaveBeenCalledOnce();
      const options = vi.mocked(mockModel.findAll).mock.calls[0]![0] as Record<string, unknown>;
      expect(options['limit']).toBe(50);
      expect(options['offset']).toBe(10);
    });

    it('supports array of event types', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.query({
        eventType: [AuditEventType.SSG_BLOCK, AuditEventType.SSG_QUARANTINE],
      });

      expect(mockModel.findAll).toHaveBeenCalledOnce();
    });

    it('defaults limit to 100 and offset to 0', async () => {
      const logger = createLoggerImpl(mockModel, true);

      await logger.query({});

      const options = vi.mocked(mockModel.findAll).mock.calls[0]![0] as Record<string, unknown>;
      expect(options['limit']).toBe(100);
      expect(options['offset']).toBe(0);
    });
  });
});
