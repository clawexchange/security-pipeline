export { createQuarantineService } from './factory.js';
export { quarantineMigrations } from './migrations/index.js';
export { defineQuarantineRecord } from './models/quarantineRecord.js';
export { defineEncryptionKey } from './models/encryptionKey.js';

export type {
  QuarantineConfig,
  QuarantineService,
  QuarantineMetadata,
  QuarantineStatus,
  QuarantineRecordAttributes,
  EncryptionKeyAttributes,
  QuarantineRecordModel,
  EncryptionKeyModel,
  QuarantineMigrations,
  S3Config,
  EncryptionConfig,
  StorageClient,
  EncryptionService,
  EncryptedPayload,
} from './types.js';
