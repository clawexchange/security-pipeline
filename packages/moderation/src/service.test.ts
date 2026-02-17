import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModerationService } from './service.js';
import type {
  ModerationConfig,
  ModerationService,
  QuarantineQueryFn,
} from './types.js';
import type { QuarantineService, QuarantineRecordAttributes } from '@clawsquare/quarantine';
import type { AuditLogger } from '@clawsquare/audit';

function makeRecord(overrides: Partial<QuarantineRecordAttributes> = {}): QuarantineRecordAttributes {
  return {
    id: 'q-001',
    s3Key: 'quarantine/2026/02/06/q-001',
    status: 'QUARANTINED',
    tier: 'HIGH',
    labels: ['SECRET_KEY'],
    contentType: 'POST',
    sourceId: 'post-123',
    encryptionKeyId: 'ek-001',
    contentHash: 'sha256abc',
    sizeBytes: 512,
    expiresAt: new Date('2026-02-09T00:00:00Z'),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date('2026-02-06T00:00:00Z'),
    updatedAt: new Date('2026-02-06T00:00:00Z'),
    ...overrides,
  };
}

function createMocks() {
  const quarantine: QuarantineService = {
    store: vi.fn().mockResolvedValue('q-001'),
    getMetadata: vi.fn().mockResolvedValue(makeRecord()),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    generateSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed?token=abc'),
    cleanup: vi.fn().mockResolvedValue(0),
  };

  const audit: AuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
  };

  const queryQuarantine: QuarantineQueryFn = vi.fn().mockResolvedValue({
    items: [makeRecord()],
    total: 1,
  });

  return { quarantine, audit, queryQuarantine };
}

function createService(mocks = createMocks()): { service: ModerationService; mocks: ReturnType<typeof createMocks> } {
  const config: ModerationConfig = {
    quarantine: mocks.quarantine,
    audit: mocks.audit,
    queryQuarantine: mocks.queryQuarantine,
    botAuth: (_req, _res, next) => { next(); },
    humanAuth: (_req, _res, next) => { next(); },
  };
  return { service: createModerationService(config), mocks };
}

describe('ModerationService', () => {
  describe('getQueue', () => {
    it('returns structured envelopes from quarantine query', async () => {
      const { service, mocks } = createService();
      const result = await service.getQueue({});

      expect(mocks.queryQuarantine).toHaveBeenCalledWith({
        status: 'QUARANTINED',
        tier: undefined,
        limit: 20,
        offset: 0,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('q-001');
      expect(result.items[0]!.tier).toBe('HIGH');
      expect(result.total).toBe(1);
    });

    it('passes tier filter to query', async () => {
      const { service, mocks } = createService();
      await service.getQueue({ tier: 'CRITICAL' });

      expect(mocks.queryQuarantine).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'CRITICAL' }),
      );
    });

    it('clamps limit to max 100', async () => {
      const { service, mocks } = createService();
      await service.getQueue({ limit: 500 });

      expect(mocks.queryQuarantine).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('uses default limit of 20', async () => {
      const { service, mocks } = createService();
      await service.getQueue({});

      expect(mocks.queryQuarantine).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      );
    });
  });

  describe('executeBotAction', () => {
    it('rejects invalid action', async () => {
      const { service } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'nuke' as 'release',
        confidence: 0.9,
        reason: 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid action');
    });

    it('rejects invalid reason', async () => {
      const { service } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'release',
        confidence: 0.9,
        reason: 'BECAUSE_I_SAID_SO' as 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid reason');
    });

    it('rejects confidence outside 0-1 range', async () => {
      const { service } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'release',
        confidence: 1.5,
        reason: 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Confidence must be');
    });

    it('rejects negative confidence', async () => {
      const { service } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'release',
        confidence: -0.1,
        reason: 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
    });

    it('returns error for non-existent record', async () => {
      const mocks = createMocks();
      vi.mocked(mocks.quarantine.getMetadata).mockResolvedValue(null);
      const { service } = createService(mocks);

      const result = await service.executeBotAction({
        quarantineId: 'nonexistent',
        action: 'release',
        confidence: 0.9,
        reason: 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('rejects action on non-QUARANTINED record', async () => {
      const mocks = createMocks();
      vi.mocked(mocks.quarantine.getMetadata).mockResolvedValue(makeRecord({ status: 'RELEASED' }));
      const { service } = createService(mocks);

      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'release',
        confidence: 0.9,
        reason: 'FALSE_POSITIVE',
      }, 'bot-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('RELEASED');
    });

    it('releases content successfully', async () => {
      const { service, mocks } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'release',
        confidence: 0.95,
        reason: 'FALSE_POSITIVE',
      }, 'bot-mod-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('RELEASED');
      expect(mocks.quarantine.updateStatus).toHaveBeenCalledWith(
        'q-001', 'RELEASED', 'bot-mod-1', expect.any(String),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'BOT_RELEASE',
          actorId: 'bot-mod-1',
          actorType: 'bot',
          targetId: 'q-001',
        }),
      );
    });

    it('deletes content successfully', async () => {
      const { service, mocks } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'delete',
        confidence: 0.99,
        reason: 'TRUE_POSITIVE_HIGH_RISK',
      }, 'bot-mod-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('DELETED');
      expect(mocks.quarantine.updateStatus).toHaveBeenCalledWith(
        'q-001', 'DELETED', 'bot-mod-1', expect.any(String),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'BOT_DELETE' }),
      );
    });

    it('escalates content for human review', async () => {
      const { service, mocks } = createService();
      const result = await service.executeBotAction({
        quarantineId: 'q-001',
        action: 'escalate',
        confidence: 0.5,
        reason: 'NEEDS_HUMAN_REVIEW',
      }, 'bot-mod-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('UNDER_REVIEW');
      expect(mocks.quarantine.updateStatus).toHaveBeenCalledWith(
        'q-001', 'UNDER_REVIEW', 'bot-mod-1', expect.any(String),
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'BOT_ESCALATE' }),
      );
    });
  });

  describe('listQuarantine', () => {
    it('returns quarantine list items', async () => {
      const { service } = createService();
      const result = await service.listQuarantine({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('q-001');
      expect(result.items[0]!.status).toBe('QUARANTINED');
    });

    it('passes status and tier filters', async () => {
      const { service, mocks } = createService();
      await service.listQuarantine({ status: 'UNDER_REVIEW', tier: 'HIGH' });

      expect(mocks.queryQuarantine).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'UNDER_REVIEW', tier: 'HIGH' }),
      );
    });
  });

  describe('getContentAccess', () => {
    it('returns signed URL and logs audit event', async () => {
      const { service, mocks } = createService();
      const result = await service.getContentAccess('q-001', 'admin-1');

      expect(result.signedUrl).toBe('https://s3.example.com/signed?token=abc');
      expect(result.expiresAt).toBeDefined();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'HUMAN_VIEW_CONTENT',
          actorId: 'admin-1',
          actorType: 'human',
          targetId: 'q-001',
        }),
      );
    });

    it('throws error for non-existent record', async () => {
      const mocks = createMocks();
      vi.mocked(mocks.quarantine.getMetadata).mockResolvedValue(null);
      const { service } = createService(mocks);

      await expect(service.getContentAccess('nonexistent', 'admin-1'))
        .rejects.toThrow('not found');
    });
  });

  describe('executeHumanAction', () => {
    it('rejects invalid action', async () => {
      const { service } = createService();
      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'escalate' as 'release',
      }, 'admin-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid action');
    });

    it('allows action on UNDER_REVIEW records', async () => {
      const mocks = createMocks();
      vi.mocked(mocks.quarantine.getMetadata).mockResolvedValue(makeRecord({ status: 'UNDER_REVIEW' }));
      const { service } = createService(mocks);

      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'release',
      }, 'admin-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('RELEASED');
    });

    it('allows action on QUARANTINED records', async () => {
      const { service } = createService();
      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'delete',
      }, 'admin-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('DELETED');
    });

    it('rejects action on RELEASED records', async () => {
      const mocks = createMocks();
      vi.mocked(mocks.quarantine.getMetadata).mockResolvedValue(makeRecord({ status: 'RELEASED' }));
      const { service } = createService(mocks);

      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'delete',
      }, 'admin-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('RELEASED');
    });

    it('releases with notes and logs audit event', async () => {
      const { service, mocks } = createService();
      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'release',
        notes: 'Reviewed and confirmed false positive',
      }, 'admin-1');

      expect(result.success).toBe(true);
      expect(mocks.quarantine.updateStatus).toHaveBeenCalledWith(
        'q-001', 'RELEASED', 'admin-1', 'Reviewed and confirmed false positive',
      );
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'HUMAN_RELEASE',
          actorId: 'admin-1',
          actorType: 'human',
          metadata: { notes: 'Reviewed and confirmed false positive' },
        }),
      );
    });

    it('deletes and logs audit event', async () => {
      const { service, mocks } = createService();
      const result = await service.executeHumanAction({
        quarantineId: 'q-001',
        action: 'delete',
      }, 'admin-1');

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('DELETED');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'HUMAN_DELETE' }),
      );
    });
  });
});
