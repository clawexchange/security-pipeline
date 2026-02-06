import { createHash, randomUUID } from 'node:crypto';
import type {
  QuarantineService,
  QuarantineMetadata,
  QuarantineRecordAttributes,
  QuarantineStatus,
  QuarantineRecordModel,
  EncryptionKeyModel,
  StorageClient,
  EncryptionService,
} from './types.js';
import { cleanupExpiredRecords } from './cleanup.js';

interface ServiceDeps {
  storage: StorageClient;
  encryption: EncryptionService;
  QuarantineRecord: QuarantineRecordModel;
  EncryptionKey: EncryptionKeyModel;
  expiryHours: number;
}

/**
 * Create the quarantine service implementation.
 */
export function createService(deps: ServiceDeps): QuarantineService {
  const { storage, encryption, QuarantineRecord, EncryptionKey, expiryHours } = deps;

  return {
    async store(content: string, metadata: QuarantineMetadata): Promise<string> {
      const contentBuffer = Buffer.from(content, 'utf-8');

      // Hash the plaintext for deduplication/audit (SHA-256)
      const contentHash = createHash('sha256').update(contentBuffer).digest('hex');

      // Encrypt the content
      const encrypted = encryption.encrypt(contentBuffer);

      // Store the encryption key metadata in the database
      const keyRecord = await EncryptionKey.create({
        id: randomUUID(),
        encryptedDataKey: encrypted.encryptedDek.toString('base64'),
        iv: encrypted.dekIv.toString('base64'),
        authTag: encrypted.dekAuthTag.toString('base64'),
        algorithm: 'aes-256-gcm',
      });

      // Generate S3 key with date-based partitioning
      const now = new Date();
      const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
      const s3Key = `quarantine/${datePath}/${randomUUID()}`;

      // Upload encrypted content to S3
      await storage.upload(s3Key, encrypted.ciphertext);

      // Create quarantine record in database
      const record = await QuarantineRecord.create({
        id: randomUUID(),
        s3Key,
        status: 'QUARANTINED',
        tier: metadata.tier,
        labels: metadata.labels,
        contentType: metadata.contentType ?? null,
        sourceId: metadata.sourceId ?? null,
        encryptionKeyId: keyRecord.get('id') as string,
        contentHash,
        sizeBytes: contentBuffer.length,
        expiresAt: new Date(now.getTime() + expiryHours * 60 * 60 * 1000),
      });

      return record.get('id') as string;
    },

    async getMetadata(id: string): Promise<QuarantineRecordAttributes | null> {
      const record = await QuarantineRecord.findByPk(id);
      if (!record) return null;
      return record.get({ plain: true }) as QuarantineRecordAttributes;
    },

    async updateStatus(
      id: string,
      status: QuarantineStatus,
      reviewedBy?: string,
      reviewNotes?: string,
    ): Promise<void> {
      const record = await QuarantineRecord.findByPk(id);
      if (!record) {
        throw new Error(`Quarantine record not found: ${id}`);
      }

      const updateData: Record<string, unknown> = { status };

      if (reviewedBy) {
        updateData.reviewedBy = reviewedBy;
        updateData.reviewedAt = new Date();
      }
      if (reviewNotes) {
        updateData.reviewNotes = reviewNotes;
      }

      // If deleting, also remove from S3
      if (status === 'DELETED') {
        const s3Key = record.get('s3Key') as string;
        await storage.delete(s3Key);
      }

      await record.update(updateData);
    },

    async generateSignedUrl(id: string, expirySeconds: number): Promise<string> {
      const record = await QuarantineRecord.findByPk(id);
      if (!record) {
        throw new Error(`Quarantine record not found: ${id}`);
      }

      const s3Key = record.get('s3Key') as string;
      return storage.getSignedUrl(s3Key, expirySeconds);
    },

    async cleanup(): Promise<number> {
      return cleanupExpiredRecords(QuarantineRecord, storage);
    },
  };
}
