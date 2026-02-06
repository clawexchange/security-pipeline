import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import type { QuarantineRecordModel } from '../types.js';

/**
 * Define the QuarantineRecord model on a Sequelize instance.
 * Consumers call this to register the model with their database.
 */
export function defineQuarantineRecord(sequelize: Sequelize): QuarantineRecordModel {
  return sequelize.define(
    'QuarantineRecord',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      s3Key: {
        type: DataTypes.STRING(512),
        allowNull: false,
        field: 's3_key',
      },
      status: {
        type: DataTypes.ENUM('QUARANTINED', 'UNDER_REVIEW', 'RELEASED', 'DELETED', 'EXPIRED'),
        allowNull: false,
        defaultValue: 'QUARANTINED',
      },
      tier: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      labels: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      contentType: {
        type: DataTypes.STRING(32),
        allowNull: true,
        field: 'content_type',
      },
      sourceId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'source_id',
      },
      encryptionKeyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'encryption_key_id',
      },
      contentHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        field: 'content_hash',
      },
      sizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'size_bytes',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      reviewedBy: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'reviewed_by',
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'reviewed_at',
      },
      reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'review_notes',
      },
    },
    {
      tableName: 'quarantine_records',
      underscored: true,
      timestamps: true,
      indexes: [
        { fields: ['status'] },
        { fields: ['tier'] },
        { fields: ['expires_at'] },
        { fields: ['source_id'] },
      ],
    },
  ) as QuarantineRecordModel;
}
