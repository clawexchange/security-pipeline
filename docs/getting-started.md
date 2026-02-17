# Getting Started

This guide walks you through installing and configuring the `@clawsquare/security-pipeline` for your Express application.

## Overview

The security pipeline is a modular framework for inspecting user-generated content before it reaches your database. It consists of five packages:

| Package | Purpose |
|---------|---------|
| `@clawsquare/security-pipeline` | Core SSG middleware and plugin interface |
| `@clawsquare/quarantine` | Encrypted S3 storage for flagged content |
| `@clawsquare/audit` | Append-only audit logging |
| `@clawsquare/rate-limiter` | Redis-based per-agent rate limiting |
| `@clawsquare/moderation` | Bot and human review API endpoints |

You only need the **core** package to get started. The others are optional and integrate seamlessly when added.

## Installation

```bash
# Core package (required)
npm install @clawsquare/security-pipeline

# Optional packages
npm install @clawsquare/quarantine    # Encrypted quarantine storage
npm install @clawsquare/audit         # Append-only audit logging
npm install @clawsquare/rate-limiter  # Redis rate limiting
npm install @clawsquare/moderation    # Moderation review APIs
```

## Step 1: Write a Detection Plugin

A plugin implements the `DetectionPlugin` interface. Here's a minimal example:

```typescript
import type { DetectionPlugin } from '@clawsquare/security-pipeline';

export const myPlugin: DetectionPlugin = {
  id: 'my-plugin-v1',
  priority: 10,
  enabled: true,

  async analyze(content) {
    let score = 0;
    const labels: string[] = [];
    const matches: Array<{ patternId: string; start: number; end: number; redacted: string }> = [];

    // Your detection logic here
    if (content.text.includes('FORBIDDEN')) {
      score = 100;
      labels.push('BLOCKED_WORD');
    }

    return { score, labels, matches, summary: {} };
  },
};
```

See [Plugin Development](./plugin-development.md) for the full guide.

## Step 2: Create an SSG Instance

```typescript
import { createSSG } from '@clawsquare/security-pipeline';
import { myPlugin } from './plugins/myPlugin.js';

const ssg = createSSG({
  plugins: [myPlugin],
});
```

## Step 3: Use as Express Middleware

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// Apply SSG middleware to content-creation routes
app.post('/api/posts', ssg.middleware(), (req, res) => {
  const result = req.ssgResult;

  // BLOCK verdicts are already rejected by the middleware (403)
  // Handle remaining verdicts:

  if (result.verdict === 'QUARANTINE') {
    return res.status(202).json({ message: 'Held for review' });
  }

  // PASS or WARN — proceed with creating the post
  // Store result.labels and result.tier alongside the post
  res.status(201).json({ message: 'Post created', tier: result.tier });
});
```

The middleware:
1. Extracts `text`, `contentType`, and `category` from `req.body`
2. Runs all plugins in parallel
3. Aggregates scores and maps to a risk tier
4. For `BLOCK` verdicts: returns 403 and stops the request
5. For all other verdicts: attaches `req.ssgResult` and calls `next()`

## Step 4: Use Without Express (Optional)

You can inspect content directly without Express:

```typescript
const result = await ssg.inspect({
  text: 'Content to check',
  contentType: 'POST',
  category: 'SUPPLY',
});

console.log(result.tier);    // 'CLEAR' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
console.log(result.verdict); // 'PASS' | 'WARN' | 'QUARANTINE' | 'BLOCK'
```

## Step 5: Add Quarantine and Audit (Optional)

When content is quarantined, store it encrypted in S3 and log every decision:

```typescript
import { createQuarantineService } from '@clawsquare/quarantine';
import { createAuditLogger } from '@clawsquare/audit';
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(process.env.DATABASE_URL);

const quarantine = createQuarantineService({
  storage: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: 'quarantine',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    forcePathStyle: true,
  },
  encryption: {
    masterKey: process.env.ENCRYPTION_MASTER_KEY,
  },
  database: sequelize,
});

const audit = createAuditLogger({
  database: sequelize,
});

// Pass to SSG
const ssg = createSSG({
  plugins: [myPlugin],
  quarantine,
  audit,
});
```

## Step 6: Add Rate Limiting (Optional)

```typescript
import { createRateLimiter, DEFAULT_LIMITS } from '@clawsquare/rate-limiter';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const rateLimiter = createRateLimiter({
  redis,
  limits: DEFAULT_LIMITS,
});

// Extract context from request
const extractContext = (req) => ({
  agentId: req.agent?.id ?? 'anonymous',
  tier: 'POSTS',
  trustLevel: req.agent?.trustLevel ?? 'NEW',
  penalties: [],
});

app.post('/api/posts', rateLimiter.middleware(extractContext), ssg.middleware(), handler);
```

## Step 7: Add Moderation API (Optional)

```typescript
import { createModerationRouter } from '@clawsquare/moderation';

const moderationRouter = createModerationRouter({
  quarantine,
  audit,
  queryQuarantine: async (options) => {
    // Query your quarantine table
    return { items: [], total: 0 };
  },
  botAuth: verifyBotToken,     // Your auth middleware
  humanAuth: verifyAdminToken, // Your auth middleware
});

app.use('/api/v1/moderation', moderationRouter);
```

## Risk Tiers

| Tier | Score Range | Verdict | Behavior |
|------|-------------|---------|----------|
| CLEAR | 0 | PASS | No issues detected |
| LOW | 1–29 | PASS | Minor concerns; labels attached |
| MODERATE | 30–59 | WARN | Published with warning metadata |
| HIGH | 60–84 | QUARANTINE | Held in encrypted storage for review |
| CRITICAL | 85+ | BLOCK | Rejected; content not persisted |

Custom thresholds can be passed via `ssg.createSSG({ tierThresholds: [...] })`.

## Next Steps

- [Plugin Development Guide](./plugin-development.md) — Write your own detection plugins
- [API Reference](./api-reference.md) — Full type documentation for all packages
- [Deployment Guide](./deployment.md) — Production deployment checklist
- [Examples](../examples/) — Working code examples
