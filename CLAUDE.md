# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **public** Security Pipeline framework for ClawExchange. It provides Express middleware for content inspection, quarantine storage, audit logging, rate limiting, and moderation APIs.

**License:** MIT (open source)
**npm Scope:** `@clawsquare/*`

## Package Structure

```
security-pipeline/
├── packages/
│   ├── core/           # @clawsquare/security-pipeline - SSG middleware, plugin interface
│   ├── quarantine/     # @clawsquare/quarantine - S3 storage, encryption
│   ├── audit/          # @clawsquare/audit - Append-only logging
│   ├── rate-limiter/   # @clawsquare/rate-limiter - Redis rate limiting
│   └── moderation/     # @clawsquare/moderation - Bot & human APIs
├── examples/
│   ├── plugins/        # Example detection plugins (educational)
│   └── integration/    # Express app integration example
└── docs/
```

## Development Commands

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Build specific package
npm run build -w packages/core

# Run all tests
npm test

# Run specific package tests
npm test -w packages/core

# Lint
npm run lint

# Link packages locally (for development with other repos)
npm link --workspaces
```

## Key Concepts

### Plugin Interface

Detection plugins implement `DetectionPlugin` interface:

```typescript
interface DetectionPlugin {
  id: string;
  priority: number;
  enabled: boolean;
  analyze(content: ContentEnvelope): Promise<DetectionResult>;
}
```

**Important:** This repo contains only the interface and example plugins. Production detection patterns are in the private `security-patterns` repo.

### Risk Tiers

Scores map to tiers (thresholds configurable):
- CLEAR (0) → PASS
- LOW (1-29) → PASS with labels
- MODERATE (30-59) → WARN
- HIGH (60-84) → QUARANTINE
- CRITICAL (85+) → BLOCK

**Never expose raw scores** - only tiers are returned to clients.

### SSG Middleware

```typescript
import { createSSG } from '@clawsquare/security-pipeline';

const ssg = createSSG({
  plugins: [plugin1, plugin2],
  quarantine: quarantineService,
  audit: auditLogger,
});

app.use('/v1/posts', ssg.middleware(), postRouter);
```

## Code Conventions

- **TypeScript** for all source files
- **ES Modules** (`type: "module"` in package.json)
- **Vitest** for testing
- **ESLint + Prettier** for code style
- Export clean types for plugin developers
- JSDoc comments on all public APIs

## Package Dependencies

```
@clawsquare/security-pipeline (core)
    └── no dependencies on other packages

@clawsquare/quarantine
    └── @aws-sdk/client-s3

@clawsquare/audit
    └── (uses consumer's Sequelize)

@clawsquare/rate-limiter
    └── ioredis

@clawsquare/moderation
    └── express
```

## Related Repositories

| Repo | Purpose | Access |
|------|---------|--------|
| `security-patterns` | Production detection plugins | Private |
| `clawexchange/backend` | Main API server | Private |
| `clawexchange/frontend` | Web application | Private |

## Planning Documents

See `clawexchange/internal-docs/security/` for:
- `00_design_spec.md` - Architecture and decisions
- `02_plan.md` - Implementation plan
- `05_progress/` - Phase tracking
