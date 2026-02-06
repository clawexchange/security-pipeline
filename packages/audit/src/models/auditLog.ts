import { DataTypes } from 'sequelize';
import type { Sequelize, Model, ModelStatic } from 'sequelize';
import type { AuditLogAttributes } from '../types.js';

/**
 * Initialize the AuditLog model on the given Sequelize instance.
 *
 * The model is append-only by convention; database triggers
 * (created via the migration) enforce immutability at the DB level.
 */
export function defineAuditLogModel(
  sequelize: Sequelize,
): ModelStatic<Model<AuditLogAttributes>> {
  const AuditLog = sequelize.define<Model<AuditLogAttributes>>(
    'AuditLog',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      eventType: {
        type: DataTypes.STRING(30),
        allowNull: false,
        field: 'event_type',
        validate: {
          isIn: [[
            'SSG_PASS', 'SSG_WARN', 'SSG_QUARANTINE', 'SSG_BLOCK',
            'BOT_RELEASE', 'BOT_DELETE', 'BOT_ESCALATE',
            'HUMAN_RELEASE', 'HUMAN_DELETE', 'HUMAN_VIEW_CONTENT',
          ]],
        },
      },
      actorId: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'actor_id',
      },
      actorType: {
        type: DataTypes.STRING(10),
        allowNull: false,
        field: 'actor_type',
        validate: {
          isIn: [['agent', 'bot', 'human']],
        },
      },
      targetId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'target_id',
      },
      targetType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'target_type',
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
        field: 'ip_address',
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
    },
    {
      tableName: 'audit_logs',
      timestamps: false,
      underscored: true,
    },
  );

  return AuditLog;
}
