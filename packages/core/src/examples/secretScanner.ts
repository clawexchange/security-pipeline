/**
 * Example Secret Scanner Plugin
 *
 * Basic regex-based secret detection for development and testing.
 * For production use, install @clawexchange/security-patterns which provides
 * entropy analysis, context-aware matching, and regularly updated patterns.
 */
import type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from '../plugins/types.js';

interface SecretPattern {
  id: string;
  description: string;
  regex: RegExp;
  score: number;
  labels: string[];
}

const PATTERNS: SecretPattern[] = [
  {
    id: 'aws-access-key',
    description: 'AWS Access Key ID (starts with AKIA)',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    score: 90,
    labels: ['AWS_KEY', 'CREDENTIAL'],
  },
  {
    id: 'generic-api-key',
    description: 'Generic API key assignment',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["']([a-zA-Z0-9_\-]{20,})["']/gi,
    score: 70,
    labels: ['API_KEY', 'CREDENTIAL'],
  },
  {
    id: 'github-token',
    description: 'GitHub Personal Access Token',
    regex: /\bghp_[a-zA-Z0-9]{36}\b/g,
    score: 90,
    labels: ['GITHUB_TOKEN', 'CREDENTIAL'],
  },
  {
    id: 'private-key-header',
    description: 'PEM private key header',
    regex: /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----/g,
    score: 95,
    labels: ['PRIVATE_KEY', 'CREDENTIAL'],
  },
  {
    id: 'slack-webhook',
    description: 'Slack incoming webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+/g,
    score: 80,
    labels: ['SLACK_WEBHOOK', 'CREDENTIAL'],
  },
];

function redact(text: string): string {
  if (text.length <= 8) {
    return text.slice(0, 2) + '*'.repeat(text.length - 2);
  }
  return text.slice(0, 4) + '*'.repeat(text.length - 6) + text.slice(-2);
}

export const exampleSecretScanner: DetectionPlugin = {
  id: 'example-secret-scanner-v1',
  priority: 10,
  enabled: true,

  async analyze(content: ContentEnvelope): Promise<DetectionResult> {
    const matches: DetectionMatch[] = [];
    const labels = new Set<string>();
    let score = 0;

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(content.text)) !== null) {
        const matchedText = match[0];
        matches.push({
          patternId: pattern.id,
          start: match.index,
          end: match.index + matchedText.length,
          redacted: redact(matchedText),
        });

        if (!labels.has(pattern.id)) {
          score += pattern.score;
        }

        for (const label of pattern.labels) {
          labels.add(label);
        }
      }
    }

    return {
      score,
      labels: [...labels],
      matches,
      summary: {
        patternsChecked: PATTERNS.length,
        matchCount: matches.length,
      },
    };
  },
};
