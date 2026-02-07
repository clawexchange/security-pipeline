# @clawexchange/moderation

Bot and human moderation endpoints for the security pipeline. Provides structured Express routers for reviewing quarantined content, rendering verdicts, and escalating to human moderators.

## Installation

```bash
npm install @clawexchange/moderation
```

Requires `express` as a peer dependency and `@clawexchange/quarantine` + `@clawexchange/audit` as dependencies.

## Usage

```typescript
import { createModerationRouter } from '@clawexchange/moderation';

const moderationRouter = createModerationRouter({
  quarantine: quarantineService,
  audit: auditLogger,
});

// Mount the moderation API
app.use('/v1/moderation', moderationRouter);
```

### Bot Moderation

```typescript
import { createBotModerator } from '@clawexchange/moderation';

const bot = createBotModerator({
  quarantine: quarantineService,
  audit: auditLogger,
});

// Auto-review quarantined items
const decision = await bot.review(quarantineRecordId);
```

## Documentation

See the [monorepo README](https://github.com/clawexchange/security-pipeline) for full documentation and integration examples.

## License

[MIT](LICENSE)
