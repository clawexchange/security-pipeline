import type { QuarantineRecordAttributes } from '@clawsquare/quarantine';
import type { StructuredEnvelope, RedactedMatch } from './types.js';

/**
 * Redact a matched pattern string by keeping only the first and last
 * characters visible, replacing the middle with asterisks.
 * Short strings (<=4 chars) are fully redacted.
 *
 * @example
 * redactPattern("AKIAIOSFODNN7EXAMPLE") → "A*******************E"
 * redactPattern("abc") → "***"
 */
export function redactPattern(raw: string): string {
  if (raw.length <= 4) {
    return '*'.repeat(raw.length);
  }
  return raw[0] + '*'.repeat(raw.length - 2) + raw[raw.length - 1]!;
}

/**
 * Generate a human-readable summary of detection results.
 * Describes what was found without exposing actual content.
 */
export function generateSummary(
  tier: string,
  labels: string[],
  matchCount: number,
): string {
  if (labels.length === 0 && matchCount === 0) {
    return `Content flagged at ${tier} tier with no specific pattern matches.`;
  }

  const parts: string[] = [`${tier} risk.`];

  if (labels.length > 0) {
    parts.push(`Detected: ${labels.join(', ')}.`);
  }

  if (matchCount > 0) {
    parts.push(`${matchCount} pattern match${matchCount === 1 ? '' : 'es'} found.`);
  }

  return parts.join(' ');
}

/**
 * Build a structured envelope from a quarantine record.
 * The envelope NEVER contains raw content — only metadata,
 * redacted matches, and a generated summary.
 *
 * @param record - Quarantine record metadata
 * @param matches - Redacted match information (already redacted by SSG plugins)
 * @returns Structured envelope safe for bot consumption
 */
export function buildEnvelope(
  record: QuarantineRecordAttributes,
  matches: RedactedMatch[] = [],
): StructuredEnvelope {
  return {
    id: record.id,
    tier: record.tier,
    labels: record.labels,
    matches,
    summary: generateSummary(record.tier, record.labels, matches.length),
    contentType: record.contentType,
    sourceId: record.sourceId,
    quarantinedAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}
