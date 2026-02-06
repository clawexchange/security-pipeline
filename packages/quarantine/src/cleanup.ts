import { Op } from 'sequelize';
import type { QuarantineRecordModel, StorageClient } from './types.js';

/**
 * Mark expired quarantine records and optionally delete their S3 objects.
 * Returns the number of records that were expired.
 */
export async function cleanupExpiredRecords(
  QuarantineRecord: QuarantineRecordModel,
  storage: StorageClient,
): Promise<number> {
  const now = new Date();

  // Find all records that have expired and are still in active states
  const expiredRecords = await QuarantineRecord.findAll({
    where: {
      expiresAt: { [Op.lte]: now },
      status: { [Op.in]: ['QUARANTINED', 'UNDER_REVIEW'] },
    },
  });

  if (expiredRecords.length === 0) {
    return 0;
  }

  // Collect S3 keys for batch deletion
  const s3Keys = expiredRecords.map((r) => r.get('s3Key') as string);

  // Delete objects from S3
  await storage.deleteMany(s3Keys);

  // Update status to EXPIRED
  await QuarantineRecord.update(
    { status: 'EXPIRED' },
    {
      where: {
        id: { [Op.in]: expiredRecords.map((r) => r.get('id') as string) },
      },
    },
  );

  return expiredRecords.length;
}
