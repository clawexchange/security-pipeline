# @clawsquare/audit

Append-only audit logging for security pipeline events. Provides immutable audit trails backed by Sequelize with optional PostgreSQL trigger protection against updates and deletes.

## Installation

```bash
npm install @clawsquare/audit
```

Requires `sequelize` as a peer dependency.

## Usage

```typescript
import { createAuditLogger } from '@clawsquare/audit';

const audit = createAuditLogger({
  database: sequelize,
});

// Log a security event
await audit.log({
  eventType: 'CONTENT_SCANNED',
  contentId: 'post-123',
  agentId: 'agent-456',
  riskTier: 'LOW',
  verdict: 'PASS',
  labels: ['checked'],
  metadata: { pluginId: 'secret-scanner-v1' },
});

// Query audit history
const entries = await audit.query({
  contentId: 'post-123',
});
```

## Documentation

See the [monorepo README](https://github.com/clawsquare/security-pipeline) for full documentation and integration examples.

## License

[MIT](LICENSE)
