import type { QuarantineMigrations } from '../types.js';

/**
 * Exportable migration functions for consumers to run in their migration pipeline.
 *
 * Usage:
 * ```typescript
 * import { quarantineMigrations } from '@clawexchange/quarantine';
 * await quarantineMigrations.up(queryInterface, Sequelize);
 * ```
 */
export const quarantineMigrations: QuarantineMigrations = {
  async up(queryInterface: unknown, Sequelize: unknown): Promise<void> {
    const qi = queryInterface as {
      createTable(name: string, attrs: Record<string, unknown>, opts?: Record<string, unknown>): Promise<void>;
      addIndex(table: string, fields: string[], opts?: Record<string, unknown>): Promise<void>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = Sequelize as any;

    // Create encryption_keys table first (referenced by quarantine_records)
    await qi.createTable('encryption_keys', {
      id: {
        type: S.UUID,
        defaultValue: S.UUIDV4,
        primaryKey: true,
      },
      encrypted_data_key: {
        type: S.TEXT,
        allowNull: false,
      },
      iv: {
        type: S.STRING(64),
        allowNull: false,
      },
      auth_tag: {
        type: S.STRING(64),
        allowNull: false,
      },
      algorithm: {
        type: S.STRING(32),
        allowNull: false,
        defaultValue: 'aes-256-gcm',
      },
      created_at: {
        type: S.DATE,
        allowNull: false,
        defaultValue: S.fn('NOW'),
      },
    });

    // Create quarantine_records table
    await qi.createTable('quarantine_records', {
      id: {
        type: S.UUID,
        defaultValue: S.UUIDV4,
        primaryKey: true,
      },
      s3_key: {
        type: S.STRING(512),
        allowNull: false,
      },
      status: {
        type: S.ENUM('QUARANTINED', 'UNDER_REVIEW', 'RELEASED', 'DELETED', 'EXPIRED'),
        allowNull: false,
        defaultValue: 'QUARANTINED',
      },
      tier: {
        type: S.STRING(16),
        allowNull: false,
      },
      labels: {
        type: S.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      content_type: {
        type: S.STRING(32),
        allowNull: true,
      },
      source_id: {
        type: S.STRING(255),
        allowNull: true,
      },
      encryption_key_id: {
        type: S.UUID,
        allowNull: false,
        references: {
          model: 'encryption_keys',
          key: 'id',
        },
        onDelete: 'RESTRICT',
      },
      content_hash: {
        type: S.STRING(128),
        allowNull: false,
      },
      size_bytes: {
        type: S.INTEGER,
        allowNull: false,
      },
      expires_at: {
        type: S.DATE,
        allowNull: false,
      },
      reviewed_by: {
        type: S.STRING(255),
        allowNull: true,
      },
      reviewed_at: {
        type: S.DATE,
        allowNull: true,
      },
      review_notes: {
        type: S.TEXT,
        allowNull: true,
      },
      created_at: {
        type: S.DATE,
        allowNull: false,
        defaultValue: S.fn('NOW'),
      },
      updated_at: {
        type: S.DATE,
        allowNull: false,
        defaultValue: S.fn('NOW'),
      },
    });

    // Add indexes
    await qi.addIndex('quarantine_records', ['status']);
    await qi.addIndex('quarantine_records', ['tier']);
    await qi.addIndex('quarantine_records', ['expires_at']);
    await qi.addIndex('quarantine_records', ['source_id']);
  },

  async down(queryInterface: unknown): Promise<void> {
    const qi = queryInterface as {
      dropTable(name: string): Promise<void>;
    };

    await qi.dropTable('quarantine_records');
    await qi.dropTable('encryption_keys');
  },
};
