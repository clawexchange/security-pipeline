import { describe, it, expect } from 'vitest';
import { redactPattern, generateSummary, buildEnvelope } from './envelopeBuilder.js';
import type { QuarantineRecordAttributes } from '@clawexchange/quarantine';

describe('redactPattern', () => {
  it('fully redacts strings of 4 chars or fewer', () => {
    expect(redactPattern('abc')).toBe('***');
    expect(redactPattern('abcd')).toBe('****');
    expect(redactPattern('a')).toBe('*');
    expect(redactPattern('ab')).toBe('**');
  });

  it('keeps first and last char for strings longer than 4', () => {
    expect(redactPattern('AKIAIOSFODNN7EXAMPLE')).toBe('A******************E');
    expect(redactPattern('hello')).toBe('h***o');
    expect(redactPattern('12345')).toBe('1***5');
  });

  it('handles empty string', () => {
    expect(redactPattern('')).toBe('');
  });
});

describe('generateSummary', () => {
  it('generates summary with no labels or matches', () => {
    const result = generateSummary('HIGH', [], 0);
    expect(result).toBe('Content flagged at HIGH tier with no specific pattern matches.');
  });

  it('generates summary with labels only', () => {
    const result = generateSummary('CRITICAL', ['AWS_KEY', 'HIGH_ENTROPY'], 0);
    expect(result).toBe('CRITICAL risk. Detected: AWS_KEY, HIGH_ENTROPY.');
  });

  it('generates summary with matches only', () => {
    const result = generateSummary('MODERATE', [], 3);
    expect(result).toBe('MODERATE risk. 3 pattern matches found.');
  });

  it('generates summary with both labels and matches', () => {
    const result = generateSummary('HIGH', ['PII_SSN'], 1);
    expect(result).toBe('HIGH risk. Detected: PII_SSN. 1 pattern match found.');
  });

  it('uses singular "match" for count of 1', () => {
    const result = generateSummary('LOW', ['SECRET'], 1);
    expect(result).toContain('1 pattern match found');
    expect(result).not.toContain('matches');
  });

  it('uses plural "matches" for count > 1', () => {
    const result = generateSummary('LOW', [], 5);
    expect(result).toContain('5 pattern matches found');
  });
});

describe('buildEnvelope', () => {
  const mockRecord: QuarantineRecordAttributes = {
    id: 'q-123',
    s3Key: 'quarantine/2026/02/06/q-123',
    status: 'QUARANTINED',
    tier: 'HIGH',
    labels: ['AWS_KEY', 'CREDENTIAL'],
    contentType: 'POST',
    sourceId: 'post-456',
    encryptionKeyId: 'ek-789',
    contentHash: 'sha256abc',
    sizeBytes: 1024,
    expiresAt: new Date('2026-02-09T00:00:00Z'),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    createdAt: new Date('2026-02-06T00:00:00Z'),
    updatedAt: new Date('2026-02-06T00:00:00Z'),
  };

  it('builds envelope with correct fields from record', () => {
    const envelope = buildEnvelope(mockRecord);

    expect(envelope.id).toBe('q-123');
    expect(envelope.tier).toBe('HIGH');
    expect(envelope.labels).toEqual(['AWS_KEY', 'CREDENTIAL']);
    expect(envelope.contentType).toBe('POST');
    expect(envelope.sourceId).toBe('post-456');
    expect(envelope.quarantinedAt).toBe('2026-02-06T00:00:00.000Z');
    expect(envelope.expiresAt).toBe('2026-02-09T00:00:00.000Z');
  });

  it('includes empty matches array when no matches provided', () => {
    const envelope = buildEnvelope(mockRecord);
    expect(envelope.matches).toEqual([]);
  });

  it('includes provided matches', () => {
    const matches = [
      { patternId: 'aws-key', redacted: 'A***E' },
      { patternId: 'pii-ssn', redacted: '***-**-1234' },
    ];
    const envelope = buildEnvelope(mockRecord, matches);
    expect(envelope.matches).toEqual(matches);
  });

  it('generates summary from record metadata', () => {
    const envelope = buildEnvelope(mockRecord);
    expect(envelope.summary).toContain('HIGH risk');
    expect(envelope.summary).toContain('AWS_KEY');
  });

  it('does NOT include raw content, s3Key, or encryption details', () => {
    const envelope = buildEnvelope(mockRecord);
    const keys = Object.keys(envelope);
    expect(keys).not.toContain('s3Key');
    expect(keys).not.toContain('encryptionKeyId');
    expect(keys).not.toContain('contentHash');
    expect(keys).not.toContain('sizeBytes');
    expect(keys).not.toContain('reviewedBy');
    expect(keys).not.toContain('reviewedAt');
    expect(keys).not.toContain('reviewNotes');
  });

  it('handles null contentType and sourceId', () => {
    const record = { ...mockRecord, contentType: null, sourceId: null };
    const envelope = buildEnvelope(record);
    expect(envelope.contentType).toBeNull();
    expect(envelope.sourceId).toBeNull();
  });
});
