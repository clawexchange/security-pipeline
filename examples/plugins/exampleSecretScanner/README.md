# Example Secret Scanner Plugin

**For education and testing only.** This plugin demonstrates how to implement the `DetectionPlugin` interface with simple regex-based secret detection.

## What It Detects

| Pattern | Description | Score |
|---------|-------------|-------|
| `aws-access-key` | AWS Access Key IDs (AKIA...) | 90 |
| `generic-api-key` | Key-value pairs like `api_key="..."` | 70 |
| `github-token` | GitHub personal access tokens (ghp_...) | 90 |
| `private-key-header` | PEM private key headers | 95 |
| `slack-webhook` | Slack incoming webhook URLs | 80 |

## Usage

```typescript
import { createSSG } from '@clawsquare/security-pipeline';
import { exampleSecretScanner } from '../examples/plugins/exampleSecretScanner/index.js';

const ssg = createSSG({
  plugins: [exampleSecretScanner],
});

const result = await ssg.inspect({
  text: 'My key is AKIAIOSFODNN7EXAMPLE',
  contentType: 'POST',
});

console.log(result.verdict); // 'BLOCK' (score 90 >= 85 threshold)
console.log(result.labels);  // ['AWS_KEY', 'CREDENTIAL']
```

## Why Not Production-Ready

Real secret scanners need:

- **Entropy analysis** — detect high-entropy strings that don't match known formats
- **Context-aware matching** — distinguish code examples from real credentials
- **Broad pattern coverage** — hundreds of patterns across cloud providers, databases, APIs
- **Regular updates** — new token formats appear frequently
- **Performance optimization** — compiled regex engines, streaming analysis
- **False positive tuning** — allowlists, test-key exclusions

See `@clawsquare/security-patterns` (private) for production-grade detection.

## Writing Your Own Plugin

See the [Plugin Development Guide](../../../docs/plugin-development.md) for the full interface reference.
