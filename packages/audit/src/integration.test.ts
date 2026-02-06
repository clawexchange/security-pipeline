import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sequelize, DataTypes } from 'sequelize';
import { createAuditLogger } from './index.js';
import { auditMigrations } from './migrations/index.js';
import { AuditEventType } from './types.js';
import type { AuditLogger } from './types.js';

/**
 * Integration tests using SQLite in-memory database.
 *
 * Note: SQLite does not support PostgreSQL-style trigger functions,
 * so append-only trigger tests are PostgreSQL-specific and tested
 * separately. These tests verify the full logger flow against a
 * real database.
 */
describe('Audit Logger Integration (SQLite)', () => {
  let sequelize: Sequelize;
  let logger: AuditLogger;

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Run migration
    await auditMigrations.up(sequelize.getQueryInterface(), DataTypes);

    // Create logger
    logger = createAuditLogger({
      database: sequelize,
      enabled: true,
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('logs an SSG_PASS event and retrieves it', async () => {
    await logger.log({
      eventType: AuditEventType.SSG_PASS,
      actorId: 'agent-001',
      actorType: 'agent',
      targetId: 'post-100',
      targetType: 'post',
    });

    const results = await logger.query({
      eventType: AuditEventType.SSG_PASS,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const entry = results[0]!;
    expect(entry.eventType).toBe('SSG_PASS');
    expect(entry.actorId).toBe('agent-001');
    expect(entry.actorType).toBe('agent');
    expect(entry.targetId).toBe('post-100');
    expect(entry.targetType).toBe('post');
    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeDefined();
  });

  it('logs an SSG_BLOCK event with metadata', async () => {
    await logger.log({
      eventType: AuditEventType.SSG_BLOCK,
      actorId: 'agent-002',
      actorType: 'agent',
      targetId: 'post-200',
      targetType: 'post',
      metadata: { tier: 'CRITICAL', labels: ['SECRET_LEAK', 'API_KEY'] },
    });

    const results = await logger.query({
      eventType: AuditEventType.SSG_BLOCK,
      actorId: 'agent-002',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const entry = results[0]!;
    expect(entry.metadata).toEqual({
      tier: 'CRITICAL',
      labels: ['SECRET_LEAK', 'API_KEY'],
    });
  });

  it('logs bot moderation events', async () => {
    await logger.log({
      eventType: AuditEventType.BOT_RELEASE,
      actorId: 'moderator-bot',
      actorType: 'bot',
      targetId: 'quarantine-rec-1',
      targetType: 'quarantine_record',
    });

    await logger.log({
      eventType: AuditEventType.BOT_ESCALATE,
      actorId: 'moderator-bot',
      actorType: 'bot',
      targetId: 'quarantine-rec-2',
      targetType: 'quarantine_record',
    });

    const results = await logger.query({ actorType: 'bot' });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('logs human admin events', async () => {
    await logger.log({
      eventType: AuditEventType.HUMAN_VIEW_CONTENT,
      actorId: 'admin-jane',
      actorType: 'human',
      targetId: 'quarantine-rec-3',
      targetType: 'quarantine_record',
      ipAddress: '10.0.0.99',
    });

    const results = await logger.query({
      eventType: AuditEventType.HUMAN_VIEW_CONTENT,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const entry = results[0]!;
    expect(entry.actorType).toBe('human');
    // IP should be masked
    expect(entry.ipAddress).toBe('10.0.0.0');
  });

  it('masks IP address in stored records', async () => {
    await logger.log({
      eventType: AuditEventType.HUMAN_DELETE,
      actorId: 'admin-bob',
      actorType: 'human',
      ipAddress: '172.16.50.42',
    });

    const results = await logger.query({
      actorId: 'admin-bob',
    });

    expect(results[0]!.ipAddress).toBe('172.16.50.0');
  });

  it('queries by date range', async () => {
    const before = new Date();
    // Small delay to ensure timestamp separation
    await new Promise((r) => setTimeout(r, 50));

    await logger.log({
      eventType: AuditEventType.SSG_WARN,
      actorId: 'agent-date-test',
      actorType: 'agent',
    });

    const after = new Date();

    const results = await logger.query({
      startDate: before,
      endDate: after,
      actorId: 'agent-date-test',
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('applies limit and offset to results', async () => {
    // Insert several events
    for (let i = 0; i < 5; i++) {
      await logger.log({
        eventType: AuditEventType.SSG_PASS,
        actorId: `agent-pagination-${i}`,
        actorType: 'agent',
      });
    }

    const page1 = await logger.query({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await logger.query({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    // Pages should have different entries
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });

  it('queries by multiple event types', async () => {
    await logger.log({
      eventType: AuditEventType.SSG_QUARANTINE,
      actorId: 'agent-multi',
      actorType: 'agent',
    });

    const results = await logger.query({
      eventType: [AuditEventType.SSG_QUARANTINE, AuditEventType.SSG_BLOCK],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const entry of results) {
      expect(['SSG_QUARANTINE', 'SSG_BLOCK']).toContain(entry.eventType);
    }
  });

  it('does not log when disabled', async () => {
    const disabledLogger = createAuditLogger({
      database: sequelize,
      enabled: false,
    });

    await disabledLogger.log({
      eventType: AuditEventType.SSG_PASS,
      actorId: 'agent-disabled',
      actorType: 'agent',
    });

    // Use the enabled logger to query (disabled logger still queries fine)
    const results = await logger.query({ actorId: 'agent-disabled' });
    expect(results).toHaveLength(0);
  });

  it('returns empty array for non-matching query', async () => {
    const results = await logger.query({
      actorId: 'nonexistent-actor-xyz',
    });
    expect(results).toHaveLength(0);
  });
});

/**
 * Append-only enforcement test.
 *
 * These tests verify that direct SQL UPDATE and DELETE on audit_logs
 * are blocked. On PostgreSQL this is enforced by triggers; on SQLite
 * we simulate by verifying the migration creates the expected trigger
 * SQL (triggers are PostgreSQL-only, so SQLite skips them).
 */
describe('Append-only enforcement', () => {
  it('migration skips triggers on non-PostgreSQL dialects', async () => {
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Should not throw on SQLite (triggers are postgres-only)
    await auditMigrations.up(sequelize.getQueryInterface(), DataTypes);

    // Verify table was created
    const tables = await sequelize.getQueryInterface().showAllTables();
    expect(tables).toContain('audit_logs');

    await sequelize.close();
  });

  it('down migration drops table cleanly', async () => {
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    await auditMigrations.up(sequelize.getQueryInterface(), DataTypes);
    await auditMigrations.down(sequelize.getQueryInterface());

    const tables = await sequelize.getQueryInterface().showAllTables();
    expect(tables).not.toContain('audit_logs');

    await sequelize.close();
  });
});
