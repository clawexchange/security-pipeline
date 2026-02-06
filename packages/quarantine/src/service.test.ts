import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createService } from './service.js';
import type {
  QuarantineRecordModel,
  EncryptionKeyModel,
  StorageClient,
  EncryptionService,
  EncryptedPayload,
  QuarantineMetadata,
} from './types.js';

// -- Mock factories --

function createMockStorage(): StorageClient {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from('encrypted')),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  };
}

function createMockEncryption(): EncryptionService {
  return {
    encrypt: vi.fn().mockReturnValue({
      ciphertext: Buffer.from('ciphertext'),
      iv: randomBytes(12),
      authTag: randomBytes(16),
      encryptedDek: Buffer.from('encrypted-dek'),
      dekIv: randomBytes(12),
      dekAuthTag: randomBytes(16),
    } satisfies EncryptedPayload),
    decrypt: vi.fn().mockReturnValue(Buffer.from('decrypted content')),
  };
}

function createMockRecord(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    id: randomUUID(),
    s3Key: 'quarantine/2026/02/06/test-key',
    status: 'QUARANTINED',
    tier: 'HIGH',
    labels: ['SECRET_DETECTED'],
    contentType: 'POST',
    sourceId: 'agent-123',
    encryptionKeyId: randomUUID(),
    contentHash: 'abc123',
    sizeBytes: 100,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };

  return {
    get(key?: string | { plain: boolean }) {
      if (typeof key === 'string') return data[key];
      if (key && typeof key === 'object' && 'plain' in key) return { ...data };
      return data;
    },
    update: vi.fn().mockImplementation(async (updates: Record<string, unknown>) => {
      Object.assign(data, updates);
    }),
  };
}

function createMockModel(records: ReturnType<typeof createMockRecord>[] = []) {
  const model = {
    create: vi.fn().mockImplementation(async (attrs: Record<string, unknown>) => {
      const record = createMockRecord(attrs);
      records.push(record);
      return record;
    }),
    findByPk: vi.fn().mockImplementation(async (id: string) => {
      return records.find((r) => r.get('id') === id) ?? null;
    }),
    findAll: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue([0]),
  };
  return model as unknown;
}

describe('QuarantineService', () => {
  let storage: StorageClient;
  let encryption: EncryptionService;
  let quarantineRecords: ReturnType<typeof createMockRecord>[];
  let encryptionKeyRecords: ReturnType<typeof createMockRecord>[];
  let QuarantineRecord: QuarantineRecordModel;
  let EncryptionKey: EncryptionKeyModel;

  beforeEach(() => {
    storage = createMockStorage();
    encryption = createMockEncryption();
    quarantineRecords = [];
    encryptionKeyRecords = [];
    QuarantineRecord = createMockModel(quarantineRecords) as QuarantineRecordModel;
    EncryptionKey = createMockModel(encryptionKeyRecords) as EncryptionKeyModel;
  });

  function createTestService() {
    return createService({
      storage,
      encryption,
      QuarantineRecord,
      EncryptionKey,
      expiryHours: 72,
    });
  }

  describe('store', () => {
    const metadata: QuarantineMetadata = {
      tier: 'HIGH',
      labels: ['SECRET_DETECTED', 'AWS_KEY'],
      pluginResults: [{ pluginId: 'secretScanner', score: 70 }],
      sourceId: 'agent-456',
      contentType: 'POST',
    };

    it('should encrypt content and store in S3', async () => {
      const service = createTestService();
      const id = await service.store('sensitive content', metadata);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      // Encryption was called
      expect(encryption.encrypt).toHaveBeenCalledOnce();
      const encryptCall = vi.mocked(encryption.encrypt).mock.calls[0]!;
      expect(encryptCall[0].toString('utf-8')).toBe('sensitive content');

      // S3 upload was called
      expect(storage.upload).toHaveBeenCalledOnce();
      const uploadCall = vi.mocked(storage.upload).mock.calls[0]!;
      expect(uploadCall[0]).toMatch(/^quarantine\/\d{4}\/\d{2}\/\d{2}\//);
      expect(Buffer.isBuffer(uploadCall[1])).toBe(true);
    });

    it('should create an encryption key record', async () => {
      const service = createTestService();
      await service.store('content', metadata);

      expect(EncryptionKey.create).toHaveBeenCalledOnce();
      const createCall = vi.mocked(EncryptionKey.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(createCall.algorithm).toBe('aes-256-gcm');
      expect(typeof createCall.encryptedDataKey).toBe('string');
      expect(typeof createCall.iv).toBe('string');
      expect(typeof createCall.authTag).toBe('string');
    });

    it('should create a quarantine record with correct metadata', async () => {
      const service = createTestService();
      await service.store('content', metadata);

      expect(QuarantineRecord.create).toHaveBeenCalledOnce();
      const createCall = vi.mocked(QuarantineRecord.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(createCall.status).toBe('QUARANTINED');
      expect(createCall.tier).toBe('HIGH');
      expect(createCall.labels).toEqual(['SECRET_DETECTED', 'AWS_KEY']);
      expect(createCall.contentType).toBe('POST');
      expect(createCall.sourceId).toBe('agent-456');
      expect(createCall.expiresAt).toBeInstanceOf(Date);
    });

    it('should set expiresAt based on expiryHours config', async () => {
      const service = createTestService();
      const before = Date.now();
      await service.store('content', metadata);
      const after = Date.now();

      const createCall = vi.mocked(QuarantineRecord.create).mock.calls[0]![0] as Record<string, unknown>;
      const expiresAt = createCall.expiresAt as Date;
      const expectedMin = before + 72 * 60 * 60 * 1000;
      const expectedMax = after + 72 * 60 * 60 * 1000;

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it('should handle missing optional metadata fields', async () => {
      const service = createTestService();
      const minimalMetadata: QuarantineMetadata = {
        tier: 'CRITICAL',
        labels: [],
        pluginResults: [],
      };

      await service.store('content', minimalMetadata);

      const createCall = vi.mocked(QuarantineRecord.create).mock.calls[0]![0] as Record<string, unknown>;
      expect(createCall.contentType).toBeNull();
      expect(createCall.sourceId).toBeNull();
    });
  });

  describe('getMetadata', () => {
    it('should return record attributes when found', async () => {
      const recordId = randomUUID();
      const mockRecord = createMockRecord({ id: recordId });
      quarantineRecords.push(mockRecord);

      const service = createTestService();
      const result = await service.getMetadata(recordId);

      expect(result).toBeDefined();
      expect(result!.id).toBe(recordId);
      expect(result!.status).toBe('QUARANTINED');
    });

    it('should return null for non-existent record', async () => {
      const service = createTestService();
      const result = await service.getMetadata(randomUUID());

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status of an existing record', async () => {
      const recordId = randomUUID();
      const mockRecord = createMockRecord({ id: recordId });
      quarantineRecords.push(mockRecord);

      const service = createTestService();
      await service.updateStatus(recordId, 'UNDER_REVIEW');

      expect(mockRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'UNDER_REVIEW' }),
      );
    });

    it('should set reviewedBy and reviewedAt when provided', async () => {
      const recordId = randomUUID();
      const mockRecord = createMockRecord({ id: recordId });
      quarantineRecords.push(mockRecord);

      const service = createTestService();
      await service.updateStatus(recordId, 'RELEASED', 'admin-1', 'False positive');

      expect(mockRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'RELEASED',
          reviewedBy: 'admin-1',
          reviewNotes: 'False positive',
          reviewedAt: expect.any(Date),
        }),
      );
    });

    it('should delete S3 object when status is DELETED', async () => {
      const recordId = randomUUID();
      const s3Key = 'quarantine/2026/02/06/test-key';
      const mockRecord = createMockRecord({ id: recordId, s3Key });
      quarantineRecords.push(mockRecord);

      const service = createTestService();
      await service.updateStatus(recordId, 'DELETED');

      expect(storage.delete).toHaveBeenCalledWith(s3Key);
    });

    it('should throw for non-existent record', async () => {
      const service = createTestService();

      await expect(service.updateStatus(randomUUID(), 'RELEASED'))
        .rejects.toThrow('Quarantine record not found');
    });
  });

  describe('generateSignedUrl', () => {
    it('should return a signed URL for existing record', async () => {
      const recordId = randomUUID();
      const s3Key = 'quarantine/2026/02/06/test-key';
      const mockRecord = createMockRecord({ id: recordId, s3Key });
      quarantineRecords.push(mockRecord);

      const service = createTestService();
      const url = await service.generateSignedUrl(recordId, 300);

      expect(storage.getSignedUrl).toHaveBeenCalledWith(s3Key, 300);
      expect(url).toBe('https://s3.example.com/signed-url');
    });

    it('should throw for non-existent record', async () => {
      const service = createTestService();

      await expect(service.generateSignedUrl(randomUUID(), 300))
        .rejects.toThrow('Quarantine record not found');
    });
  });

  describe('cleanup', () => {
    it('should call cleanup and return count', async () => {
      const service = createTestService();
      const count = await service.cleanup();

      expect(count).toBe(0);
      expect(QuarantineRecord.findAll).toHaveBeenCalled();
    });
  });
});
