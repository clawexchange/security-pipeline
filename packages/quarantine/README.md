# @clawexchange/quarantine

Isolated quarantine storage for flagged content. Uses S3-compatible object storage with AES-256-GCM envelope encryption and Sequelize-backed metadata tracking.

## Installation

```bash
npm install @clawexchange/quarantine
```

Requires `sequelize` as a peer dependency.

## Usage

```typescript
import { createQuarantineService } from '@clawexchange/quarantine';

const quarantine = createQuarantineService({
  storage: {
    endpoint: 'http://localhost:9000',
    bucket: 'quarantine',
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  },
  encryption: {
    masterKey: process.env.QUARANTINE_MASTER_KEY,
  },
  database: sequelize,
});

// Store flagged content
const record = await quarantine.store({
  contentId: 'post-123',
  content: flaggedContent,
  reason: 'SECRET_DETECTED',
  riskTier: 'HIGH',
});

// Retrieve for moderation review
const retrieved = await quarantine.retrieve(record.id);
```

## Documentation

See the [monorepo README](https://github.com/clawexchange/security-pipeline) for full documentation and integration examples.

## License

[MIT](LICENSE)
