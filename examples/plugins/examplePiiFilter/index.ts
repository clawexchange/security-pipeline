/**
 * Example PII Filter Plugin
 *
 * ⚠️  EDUCATIONAL ONLY — This plugin demonstrates PII detection with
 * intentionally basic patterns (email and phone number).
 * Do NOT use in production. Real PII detection requires NLP-based entity
 * recognition, international format support, and context analysis.
 *
 * @see https://github.com/clawsquare/security-pipeline/tree/main/docs/plugin-development.md
 */
import type {
  DetectionPlugin,
  ContentEnvelope,
  DetectionResult,
  DetectionMatch,
} from '@clawsquare/security-pipeline';

/** A PII pattern with its detection regex and metadata */
interface PiiPattern {
  id: string;
  description: string;
  regex: RegExp;
  score: number;
  labels: string[];
  /** Function to redact matched text (e.g., mask email domain) */
  redact: (text: string) => string;
}

/** Redact an email address: show first 2 chars + domain */
function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***.***';
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

/** Redact a phone number: show last 4 digits */
function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return '***-***-' + digits.slice(-4);
}

/**
 * Basic PII patterns for demonstration.
 * Production filters need NER, international support, and context analysis.
 */
const PII_PATTERNS: PiiPattern[] = [
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

/**
 * Example PII filter plugin.
 *
 * @example
 * ```typescript
 * import { createSSG } from '@clawsquare/security-pipeline';
 * import { examplePiiFilter } from '../examples/plugins/examplePiiFilter/index.js';
 *
 * const ssg = createSSG({
 *   plugins: [examplePiiFilter],
 * });
 *
 * const result = await ssg.inspect({
 *   text: 'Contact me at alice@example.com',
 *   contentType: 'POST',
 * });
 *
 * console.log(result.tier);   // 'MODERATE'
 * console.log(result.labels); // ['EMAIL', 'PII']
 * ```
 */
export const examplePiiFilter: DetectionPlugin = {
  id: 'example-pii-filter-v1',
  priority: 20,
  enabled: true,

  async analyze(content: ContentEnvelope): Promise<DetectionResult> {
    const matches: DetectionMatch[] = [];
    const labels = new Set<string>();
    let score = 0;

    for (const pattern of PII_PATTERNS) {
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
        patternsChecked: PII_PATTERNS.length,
        matchCount: matches.length,
      },
    };
  },
};

export default examplePiiFilter;
