import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import type { EncryptionKeyModel } from '../types.js';

/**
 * Define the EncryptionKey model on a Sequelize instance.
 * Stores wrapped (encrypted) data encryption keys for each quarantine record.
 */
export function defineEncryptionKey(sequelize: Sequelize): EncryptionKeyModel {
  return sequelize.define(
    'EncryptionKey',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      encryptedDataKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'encrypted_data_key',
      },
      iv: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      authTag: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'auth_tag',
      },
      algorithm: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'aes-256-gcm',
      },
    },
    {
      tableName: 'encryption_keys',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    },
  ) as EncryptionKeyModel;
}
