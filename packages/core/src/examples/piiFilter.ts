/**
 * Example PII Filter Plugin
 *
 * Basic regex-based PII detection for development and testing.
 * For production use, install @clawsquare/security-patterns which provides
 * NLP-based entity recognition, international format support, and context analysis.
 */
import type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from '../plugins/types.js';

interface PiiPattern {
  id: string;
  description: string;
  regex: RegExp;
  score: number;
  labels: string[];
  redact: (text: string) => string;
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***.***';
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return '***-***-' + digits.slice(-4);
}

const PATTERNS: PiiPattern[] = [
  {
    id: 'email-address',
    description: 'Email address',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    score: 40,
    labels: ['EMAIL', 'PII'],
    redact: redactEmail,
  },
  {
    id: 'us-phone-number',
    description: 'US phone number (various formats)',
    regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    score: 35,
    labels: ['PHONE', 'PII'],
    redact: redactPhone,
  },
];

export const examplePiiFilter: DetectionPlugin = {
  id: 'example-pii-filter-v1',
  priority: 20,
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
          redacted: pattern.redact(matchedText),
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
