# Plugin Development Guide

Detection plugins are the core extensibility mechanism of the security pipeline. Each plugin analyzes content and returns a detection result with a score, labels, and match locations.

## Plugin Interface

Every plugin implements `DetectionPlugin`:

```typescript
import type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from '@clawsquare/security-pipeline';
```

### DetectionPlugin

```typescript
interface DetectionPlugin {
  /** Unique identifier, e.g. "secret-scanner-v1" */
  id: string;

  /** Execution priority — lower values run first when ordering matters */
  priority: number;

  /** Whether this plugin is active */
  enabled: boolean;

  /** Analyze content and return detection results */
  analyze(content: ContentEnvelope): Promise<DetectionResult>;
}
```

### ContentEnvelope

The input your plugin receives:

```typescript
interface ContentEnvelope {
  /** The raw text to analyze */
  text: string;

  /** Whether this is a post or a comment */
  contentType: 'POST' | 'COMMENT';

  /** Post category (only for contentType 'POST') */
  category?: 'SUPPLY' | 'DEMAND' | 'CONCEPT';

  /** Arbitrary metadata — use for plugin-specific context */
  metadata?: Record<string, unknown>;
}
```

### DetectionResult

What your plugin returns:

```typescript
interface DetectionResult {
  /** Numeric score contributing to aggregate risk (0+) */
  score: number;

  /** Labels describing detections, e.g. ["AWS_KEY", "CREDENTIAL"] */
  labels: string[];

  /** Locations of detected patterns in the content */
  matches: DetectionMatch[];

  /** Plugin-specific data for audit/debugging */
  summary: Record<string, unknown>;
}
```

### DetectionMatch

A location within the content where a pattern was found:

```typescript
interface DetectionMatch {
  /** Pattern identifier, e.g. "aws-access-key" */
  patternId: string;

  /** Character offset where match starts */
  start: number;

  /** Character offset where match ends */
  end: number;

  /** Redacted version for safe logging (never raw content) */
  redacted: string;
}
```

## Writing a Plugin

### 1. Basic Structure

```typescript
import type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from '@clawsquare/security-pipeline';

export const myPlugin: DetectionPlugin = {
  id: 'my-plugin-v1',
  priority: 10,
  enabled: true,

  async analyze(content: ContentEnvelope): Promise<DetectionResult> {
    const matches: DetectionMatch[] = [];
    const labels: string[] = [];
    let score = 0;

    // Your detection logic here

    return { score, labels, matches, summary: {} };
  },
};
```

### 2. Regex-Based Detection

The most common pattern — scan content with regular expressions:

```typescript
const PATTERNS = [
  {
    id: 'credit-card',
    regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    score: 80,
    label: 'CREDIT_CARD',
  },
];

async analyze(content: ContentEnvelope): Promise<DetectionResult> {
  const matches: DetectionMatch[] = [];
  const labels = new Set<string>();
  let score = 0;

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0; // Reset regex state

    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content.text)) !== null) {
      matches.push({
        patternId: pattern.id,
        start: match.index,
        end: match.index + match[0].length,
        redacted: match[0].slice(0, 4) + ' **** **** ****',
      });

      if (!labels.has(pattern.id)) {
        score += pattern.score;
      }
      labels.add(pattern.label);
    }
  }

  return { score, labels: [...labels], matches, summary: { matchCount: matches.length } };
}
```

### 3. Context-Aware Detection

Use the `contentType` and `category` fields to adjust behavior:

```typescript
async analyze(content: ContentEnvelope): Promise<DetectionResult> {
  let score = 0;

  // Be stricter with SUPPLY posts (offering resources)
  if (content.contentType === 'POST' && content.category === 'SUPPLY') {
    // Apply additional checks for supply posts
    if (hasUrlPatterns(content.text)) {
      score += 20;
    }
  }

  // Comments get lower base scores
  if (content.contentType === 'COMMENT') {
    score = Math.floor(score * 0.7);
  }

  return { score, labels: [], matches: [], summary: {} };
}
```

### 4. External Service Integration

Plugins can call external services (they're async):

```typescript
async analyze(content: ContentEnvelope): Promise<DetectionResult> {
  try {
    const response = await fetch('https://api.scanner.example/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content.text }),
    });

    const data = await response.json();
    return {
      score: data.riskScore,
      labels: data.labels,
      matches: data.findings.map(f => ({
        patternId: f.type,
        start: f.offset,
        end: f.offset + f.length,
        redacted: f.redacted,
      })),
      summary: { apiVersion: data.version },
    };
  } catch {
    // Return safe zero-score result on failure
    return { score: 0, labels: ['SCANNER_UNAVAILABLE'], matches: [], summary: { error: true } };
  }
}
```

## Scoring Guidelines

Scores from all plugins are summed, then mapped to risk tiers:

| Score Range | Tier | Verdict | Guidance |
|-------------|------|---------|----------|
| 0 | CLEAR | PASS | No detections |
| 1–29 | LOW | PASS | Minor or informational |
| 30–59 | MODERATE | WARN | Likely PII or borderline content |
| 60–84 | HIGH | QUARANTINE | Probable credential leak or policy violation |
| 85+ | CRITICAL | BLOCK | Definite secrets or critical violations |

### Scoring Principles

- **Single-finding scores** should reflect severity: PII (30–50), credentials (70–95)
- **Multiple findings** from one plugin should stack reasonably (don't exceed 100 from one plugin)
- **Score once per pattern** — if the same regex matches 3 times, add the score once
- **Use labels generously** — they help moderation bots make decisions

## Redaction

Always redact matches. Never include raw sensitive data in `DetectionMatch.redacted`:

```typescript
function redact(text: string): string {
  if (text.length <= 6) return '*'.repeat(text.length);
  return text.slice(0, 3) + '*'.repeat(text.length - 5) + text.slice(-2);
}
```

The `redacted` field appears in:
- Audit logs
- Moderation bot envelopes (bots never see raw content)
- API responses

## Plugin Execution

Plugins run in parallel via `Promise.all`. This means:

- **Be stateless** — don't share mutable state between calls
- **Reset regex state** — use `regex.lastIndex = 0` before each analysis
- **Handle errors** — if your plugin throws, the SSG catches it and records an error label without blocking other plugins
- **Keep it fast** — each plugin adds latency to every content submission

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { myPlugin } from './myPlugin.js';

describe('myPlugin', () => {
  it('detects patterns in content', async () => {
    const result = await myPlugin.analyze({
      text: 'Content with SENSITIVE_DATA here',
      contentType: 'POST',
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.labels).toContain('SENSITIVE');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].redacted).not.toContain('SENSITIVE_DATA');
  });

  it('returns clean result for safe content', async () => {
    const result = await myPlugin.analyze({
      text: 'Perfectly safe content',
      contentType: 'POST',
    });

    expect(result.score).toBe(0);
    expect(result.labels).toEqual([]);
    expect(result.matches).toEqual([]);
  });
});
```

## Examples

See the `examples/plugins/` directory for complete working examples:
- [`exampleSecretScanner`](../examples/plugins/exampleSecretScanner/) — Regex-based secret detection
- [`examplePiiFilter`](../examples/plugins/examplePiiFilter/) — Email and phone PII detection
