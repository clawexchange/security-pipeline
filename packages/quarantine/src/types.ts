import type { Sequelize, Model, ModelStatic, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';

/** S3-compatible storage configuration */
export interface S3Config {
  /** S3 endpoint URL (e.g. http://localhost:9000 for MinIO) */
  endpoint: string;
  /** Bucket name for quarantine storage */
  bucket: string;
  /** S3 access key */
  accessKey: string;
  /** S3 secret key */
  secretKey: string;
  /** S3 region (default: us-east-1) */
  region?: string;
  /** Force path-style URLs (required for MinIO, default: true) */
  forcePathStyle?: boolean;
}

/** Encryption configuration */
export interface EncryptionConfig {
  /** Base64-encoded 32-byte master key for AES-256-GCM */
  masterKey: string;
  /** Encryption algorithm (default: aes-256-gcm) */
  algorithm?: 'aes-256-gcm';
}

/** Full quarantine service configuration */
export interface QuarantineConfig {
  /** S3-compatible storage settings */
  storage: S3Config;
  /** Encryption settings */
  encryption: EncryptionConfig;
  /** Sequelize instance for metadata storage */
  database: Sequelize;
  /** Hours until quarantined content auto-expires (default: 72) */
  expiryHours?: number;
}

/** Status of a quarantined record */
export type QuarantineStatus =
  | 'QUARANTINED'
  | 'UNDER_REVIEW'
  | 'RELEASED'
  | 'DELETED'
  | 'EXPIRED';

/** Metadata passed when storing quarantined content */
export interface QuarantineMetadata {
  /** Risk tier from SSG inspection */
  tier: string;
  /** Detection labels from plugins */
  labels: string[];
  /** Per-plugin results for audit */
  pluginResults: Record<string, unknown>[];
  /** Optional source identifier (e.g. agent ID, post ID) */
  sourceId?: string;
  /** Content type that was inspected */
  contentType?: string;
}

/** Quarantine record attributes stored in PostgreSQL */
export interface QuarantineRecordAttributes {
  id: string;
  s3Key: string;
  status: QuarantineStatus;
  tier: string;
  labels: string[];
  contentType: string | null;
  sourceId: string | null;
  encryptionKeyId: string;
  contentHash: string;
  sizeBytes: number;
  expiresAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Encryption key record attributes */
export interface EncryptionKeyAttributes {
  id: string;
  encryptedDataKey: string;
  iv: string;
  authTag: string;
  algorithm: string;
  createdAt: Date;
}

/** Quarantine record model instance */
export interface QuarantineRecordInstance
  extends Model<InferAttributes<QuarantineRecordInstance>, InferCreationAttributes<QuarantineRecordInstance>>,
    QuarantineRecordAttributes {
  id: CreationOptional<string>;
  status: CreationOptional<QuarantineStatus>;
  reviewedBy: CreationOptional<string | null>;
  reviewedAt: CreationOptional<Date | null>;
  reviewNotes: CreationOptional<string | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

/** Encryption key model instance */
export interface EncryptionKeyInstance
  extends Model<InferAttributes<EncryptionKeyInstance>, InferCreationAttributes<EncryptionKeyInstance>>,
    EncryptionKeyAttributes {
  id: CreationOptional<string>;
  algorithm: CreationOptional<string>;
  createdAt: CreationOptional<Date>;
}

/** Quarantine record model class */
export type QuarantineRecordModel = ModelStatic<QuarantineRecordInstance>;

/** Encryption key model class */
export type EncryptionKeyModel = ModelStatic<EncryptionKeyInstance>;

/** The public quarantine service interface */
export interface QuarantineService {
  /** Store content in quarantine. Returns the quarantine record ID. */
  store(content: string, metadata: QuarantineMetadata): Promise<string>;
  /** Get metadata for a quarantined record (no content) */
  getMetadata(id: string): Promise<QuarantineRecordAttributes | null>;
  /** Update the status of a quarantined record */
  updateStatus(id: string, status: QuarantineStatus, reviewedBy?: string, reviewNotes?: string): Promise<void>;
  /** Generate a time-limited signed URL for direct S3 content access */
  generateSignedUrl(id: string, expirySeconds: number): Promise<string>;
  /** Mark expired records. Returns count of records expired. */
  cleanup(): Promise<number>;
}

/** Internal storage client interface */
export interface StorageClient {
  /** Upload encrypted content to S3 */
  upload(key: string, data: Buffer): Promise<void>;
  /** Download encrypted content from S3 */
  download(key: string): Promise<Buffer>;
  /** Delete content from S3 */
  delete(key: string): Promise<void>;
  /** Delete multiple objects from S3 */
  deleteMany(keys: string[]): Promise<void>;
  /** Generate a presigned URL for direct access */
  getSignedUrl(key: string, expirySeconds: number): Promise<string>;
}

/** Encrypted payload returned by the encryption service */
export interface EncryptedPayload {
  /** Encrypted data */
  ciphertext: Buffer;
  /** Initialization vector */
  iv: Buffer;
  /** GCM authentication tag */
  authTag: Buffer;
  /** Encrypted data encryption key (DEK wrapped with master key) */
  encryptedDek: Buffer;
  /** IV used to encrypt the DEK */
  dekIv: Buffer;
  /** Auth tag from DEK encryption */
  dekAuthTag: Buffer;
}

/** Encryption service interface */
export interface EncryptionService {
  /** Encrypt content using envelope encryption (DEK + master key) */
  encrypt(plaintext: Buffer): EncryptedPayload;
  /** Decrypt content using stored encryption metadata */
  decrypt(payload: EncryptedPayload): Buffer;
}

/** Migration interface for consumers */
export interface QuarantineMigrations {
  /** Run migrations to create tables */
  up(queryInterface: unknown, Sequelize: unknown): Promise<void>;
  /** Rollback migrations */
  down(queryInterface: unknown): Promise<void>;
}
