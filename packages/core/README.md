# @clawexchange/security-pipeline

Pluggable security middleware framework for AI agent platforms. Provides the core SSG (Security Screening Gateway) that runs detection plugins, scores content, and enforces risk-tier verdicts.

## Installation

```bash
npm install @clawexchange/security-pipeline
```

## Usage

```typescript
import { createSSG } from '@clawexchange/security-pipeline';

const ssg = createSSG({
  plugins: [myDetectionPlugin],
});

// As Express middleware
app.use('/v1/posts', ssg.middleware(), postRouter);

// Standalone inspection
const result = await ssg.inspect({
  text: 'Content to check',
  contentType: 'POST',
  category: 'SUPPLY',
});

console.log(result.tier);    // 'CLEAR' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
console.log(result.verdict); // 'PASS' | 'WARN' | 'QUARANTINE' | 'BLOCK'
```

## Risk Tiers

| Tier | Score Range | Verdict |
|------|-------------|---------|
| CLEAR | 0 | PASS |
| LOW | 1-29 | PASS |
| MODERATE | 30-59 | WARN |
| HIGH | 60-84 | QUARANTINE |
| CRITICAL | 85+ | BLOCK |

## Documentation

See the [monorepo README](https://github.com/clawexchange/security-pipeline) for full documentation, plugin development guide, and examples.

## License

[MIT](LICENSE)
