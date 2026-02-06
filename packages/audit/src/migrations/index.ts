import type { QueryInterface, DataTypes as DataTypesType } from 'sequelize';

/**
 * Audit log migrations.
 *
 * Creates the `audit_logs` table with indexes and database triggers
 * that enforce append-only behavior. Once a row is inserted, it
 * cannot be updated or deleted at the database level.
 */
export const auditMigrations = {
  async up(queryInterface: QueryInterface, DataTypes: typeof DataTypesType): Promise<void> {
    // 1. Create the audit_logs table
    await queryInterface.createTable('audit_logs', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      event_type: {
        type: DataTypes.STRING(30),
        allowNull: false,
      },
      actor_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      actor_type: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      target_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      target_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // 2. Add indexes for common query patterns
    await queryInterface.addIndex('audit_logs', ['event_type'], {
      name: 'idx_audit_logs_event_type',
    });

    await queryInterface.addIndex('audit_logs', ['actor_id'], {
      name: 'idx_audit_logs_actor_id',
    });

    await queryInterface.addIndex('audit_logs', ['target_id'], {
      name: 'idx_audit_logs_target_id',
    });

    await queryInterface.addIndex('audit_logs', ['created_at'], {
      name: 'idx_audit_logs_created_at',
    });

    await queryInterface.addIndex('audit_logs', ['actor_type', 'event_type'], {
      name: 'idx_audit_logs_actor_type_event_type',
    });

    // 3. Create the prevent_modification function (PostgreSQL)
    //    This function raises an exception when called, preventing
    //    any UPDATE or DELETE on the audit_logs table.
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs table is append-only: % operations are not permitted', TG_OP;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // 4. Add UPDATE trigger
      await queryInterface.sequelize.query(`
        CREATE TRIGGER audit_logs_prevent_update
        BEFORE UPDATE ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();
      `);

      // 5. Add DELETE trigger
      await queryInterface.sequelize.query(`
        CREATE TRIGGER audit_logs_prevent_delete
        BEFORE DELETE ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();
      `);
    }
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      // Drop triggers first
      await queryInterface.sequelize.query(
        'DROP TRIGGER IF EXISTS audit_logs_prevent_delete ON audit_logs;',
      );
      await queryInterface.sequelize.query(
        'DROP TRIGGER IF EXISTS audit_logs_prevent_update ON audit_logs;',
      );
      // Drop function
      await queryInterface.sequelize.query(
        'DROP FUNCTION IF EXISTS prevent_audit_log_modification();',
      );
    }

    // Drop table
    await queryInterface.dropTable('audit_logs');
  },
};
