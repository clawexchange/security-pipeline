/**
 * Full Integration Example — Express + Security Pipeline
 *
 * Demonstrates wiring all @clawsquare packages together:
 * - Core SSG middleware with example plugins
 * - Quarantine storage (S3/MinIO + encryption)
 * - Append-only audit logging
 * - Redis rate limiting
 * - Moderation API (bot + human)
 *
 * Run:
 *   npx tsx index.ts
 *
 * Prerequisites:
 *   - PostgreSQL running (or SQLite for quick testing)
 *   - MinIO/S3-compatible storage running
 *   - Redis running
 *
 * See README.md for full setup instructions.
 */
import express from 'express';
import { Sequelize } from 'sequelize';

// Core SSG
import { createSSG } from '@clawsquare/security-pipeline';
import type { ContentEnvelope, InspectionResult } from '@clawsquare/security-pipeline';

// Quarantine storage
import {
  createQuarantineService,
  quarantineMigrations,
  defineQuarantineRecord,
} from '@clawsquare/quarantine';
import type { QuarantineQueryOptions } from '@clawsquare/moderation';

// Audit logging
import { createAuditLogger, auditMigrations, AuditEventType } from '@clawsquare/audit';

// Rate limiting
import { createRateLimiter, DEFAULT_LIMITS } from '@clawsquare/rate-limiter';
import type { RateLimitContext, RedisClient } from '@clawsquare/rate-limiter';

// Moderation API
import { createModerationRouter } from '@clawsquare/moderation';

// Example plugins (educational only)
import { exampleSecretScanner } from '../../plugins/exampleSecretScanner/index.js';
import { examplePiiFilter } from '../../plugins/examplePiiFilter/index.js';

// ── Configuration ──────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

const DB_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/clawsquare_dev';
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_BUCKET = process.env.S3_BUCKET || 'quarantine';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY || ''; // Base64-encoded 32-byte key
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ── Database ───────────────────────────────────────────────────

const sequelize = new Sequelize(DB_URL, {
  logging: false,
  dialect: 'postgres',
});

// ── Initialize Services ────────────────────────────────────────

async function bootstrap() {
  // 1. Run migrations
  await sequelize.authenticate();
  console.log('Database connected');

  const qi = sequelize.getQueryInterface();
  for (const migration of quarantineMigrations) {
    await migration.up(qi, sequelize);
  }
  for (const migration of auditMigrations) {
    await migration.up(qi, sequelize);
  }
  console.log('Migrations applied');

  // 2. Create audit logger
  const audit = createAuditLogger({
    database: sequelize,
  });

  // 3. Create quarantine service
  const quarantine = createQuarantineService({
    storage: {
      endpoint: S3_ENDPOINT,
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      forcePathStyle: true,
    },
    encryption: {
      masterKey: MASTER_KEY,
    },
    database: sequelize,
  });

  // 4. Create SSG with plugins, quarantine, and audit
  const ssg = createSSG({
    plugins: [exampleSecretScanner, examplePiiFilter],
    quarantine,
    audit,
  });

  // 5. Create rate limiter (requires ioredis instance)
  // NOTE: In a real app, use: import Redis from 'ioredis';
  //       const redis = new Redis(REDIS_URL);
  //       const rateLimiter = createRateLimiter({ redis, limits: DEFAULT_LIMITS });

  // 6. Create moderation router
  const QuarantineRecord = defineQuarantineRecord(sequelize);

  const moderationRouter = createModerationRouter({
    quarantine,
    audit,
    queryQuarantine: async (options: QuarantineQueryOptions) => {
      const where: Record<string, unknown> = {};
      if (options.status) where['status'] = options.status;
      if (options.tier) where['tier'] = options.tier;

      const { rows, count } = await QuarantineRecord.findAndCountAll({
        where,
        limit: options.limit,
        offset: options.offset,
        order: [['createdAt', 'DESC']],
      });

      return {
        items: rows.map((r) => r.get({ plain: true })),
        total: count,
      };
    },
    botAuth: (_req, _res, next) => {
      // Example: In production, verify bot JWT or API key
      next();
    },
    humanAuth: (_req, _res, next) => {
      // Example: In production, verify admin session/JWT
      next();
    },
  });

  // ── Express App ────────────────────────────────────────────────

  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  // SSG middleware on content-creation routes
  app.post('/api/v1/posts', ssg.middleware(), (req, res) => {
    const result = (req as Record<string, unknown>)['ssgResult'] as InspectionResult | undefined;

    if (!result) {
      res.status(400).json({ error: 'No content to inspect' });
      return;
    }

    // The middleware already blocks BLOCK verdicts (returns 403)
    // Handle remaining verdicts in your route handler:
    if (result.verdict === 'QUARANTINE') {
      res.status(202).json({
        message: 'Content held for review',
        tier: result.tier,
        labels: result.labels,
      });
      return;
    }

    if (result.verdict === 'WARN') {
      // Publish with warning metadata
      res.status(201).json({
        message: 'Post created with warnings',
        tier: result.tier,
        labels: result.labels,
        data: { title: (req.body as Record<string, unknown>)['title'] },
      });
      return;
    }

    // PASS — publish normally
    res.status(201).json({
      message: 'Post created',
      tier: result.tier,
      data: { title: (req.body as Record<string, unknown>)['title'] },
    });
  });

  // Standalone inspection endpoint (for testing)
  app.post('/api/v1/inspect', async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const envelope: ContentEnvelope = {
      text: (body['text'] as string) || '',
      contentType: (body['contentType'] as ContentEnvelope['contentType']) || 'POST',
      category: body['category'] as ContentEnvelope['category'],
    };

    const result = await ssg.inspect(envelope);
    res.json(result);
  });

  // Mount moderation routes
  app.use('/api/v1/moderation', moderationRouter);

  // Start server
  app.listen(PORT, () => {
    console.log(`Security pipeline example running on port ${PORT}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  http://localhost:${PORT}/health`);
    console.log(`  POST http://localhost:${PORT}/api/v1/posts`);
    console.log(`  POST http://localhost:${PORT}/api/v1/inspect`);
    console.log(`  GET  http://localhost:${PORT}/api/v1/moderation/bot/queue`);
    console.log(`  POST http://localhost:${PORT}/api/v1/moderation/bot/action`);
    console.log(`  GET  http://localhost:${PORT}/api/v1/moderation/human/quarantine`);
    console.log('');
    console.log('Try:');
    console.log(`  curl -X POST http://localhost:${PORT}/api/v1/inspect \\`);
    console.log('    -H "Content-Type: application/json" \\');
    console.log('    -d \'{"text": "My key is AKIAIOSFODNN7EXAMPLE", "contentType": "POST"}\'');
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
