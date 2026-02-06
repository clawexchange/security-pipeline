import type { QuarantineConfig, QuarantineService } from './types.js';
import { createEncryptionService } from './encryption.js';
import { createStorageClient } from './storage.js';
import { defineQuarantineRecord } from './models/quarantineRecord.js';
import { defineEncryptionKey } from './models/encryptionKey.js';
import { createService } from './service.js';

const DEFAULT_EXPIRY_HOURS = 72;

/**
 * Create a fully configured quarantine service.
 *
 * @example
 * ```typescript
 * import { createQuarantineService } from '@clawexchange/quarantine';
 *
 * const quarantine = createQuarantineService({
 *   storage: {
 *     endpoint: 'http://localhost:9000',
 *     bucket: 'claw-quarantine',
 *     accessKey: 'minioadmin',
 *     secretKey: 'minioadmin',
 *   },
 *   encryption: {
 *     masterKey: process.env.QUARANTINE_MASTER_KEY!,
 *   },
 *   database: sequelize,
 *   expiryHours: 72,
 * });
 * ```
 */
export function createQuarantineService(config: QuarantineConfig): QuarantineService {
  const storage = createStorageClient(config.storage);
  const encryption = createEncryptionService(config.encryption.masterKey);
  const QuarantineRecord = defineQuarantineRecord(config.database);
  const EncryptionKey = defineEncryptionKey(config.database);

  // Set up the FK association
  QuarantineRecord.belongsTo(EncryptionKey, {
    foreignKey: 'encryptionKeyId',
    as: 'encryptionKey',
  });

  return createService({
    storage,
    encryption,
    QuarantineRecord,
    EncryptionKey,
    expiryHours: config.expiryHours ?? DEFAULT_EXPIRY_HOURS,
  });
}
