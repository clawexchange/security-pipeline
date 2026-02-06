import { describe, it, expect } from 'vitest';
import { examplePiiFilter } from './index.js';
import type { ContentEnvelope } from '@clawexchange/security-pipeline';

function envelope(text: string): ContentEnvelope {
  return { text, contentType: 'POST' };
}

describe('examplePiiFilter', () => {
  it('has correct plugin metadata', () => {
    expect(examplePiiFilter.id).toBe('example-pii-filter-v1');
    expect(examplePiiFilter.priority).toBe(20);
    expect(examplePiiFilter.enabled).toBe(true);
  });

  it('returns clean result for safe content', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('This post contains no personal information at all.'),
    );

    expect(result.score).toBe(0);
    expect(result.labels).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('detects email address', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('Contact me at alice@example.com for details'),
    );

    expect(result.score).toBe(40);
    expect(result.labels).toContain('EMAIL');
    expect(result.labels).toContain('PII');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.patternId).toBe('email-address');
  });

  it('detects US phone number', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('Call me at (555) 123-4567'),
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.labels).toContain('PHONE');
    expect(result.labels).toContain('PII');
  });

  it('detects phone number with country code', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('Number: +1-555-123-4567'),
    );

    expect(result.labels).toContain('PHONE');
  });

  it('detects multiple PII types', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('Email: bob@test.org, Phone: 555-987-6543'),
    );

    expect(result.labels).toContain('EMAIL');
    expect(result.labels).toContain('PHONE');
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('redacts email showing first 2 chars and domain', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('My email is alice@example.com'),
    );

    const match = result.matches[0]!;
    expect(match.redacted).toBe('al***@example.com');
  });

  it('redacts phone showing only last 4 digits', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('Call 555-123-4567'),
    );

    const phoneMatch = result.matches.find((m) => m.patternId === 'us-phone-number');
    expect(phoneMatch).toBeDefined();
    expect(phoneMatch!.redacted).toMatch(/\*{3}-\*{3}-4567$/);
  });

  it('records correct match positions', async () => {
    const text = 'Send to alice@example.com please';
    const result = await examplePiiFilter.analyze(envelope(text));

    const match = result.matches[0]!;
    expect(text.slice(match.start, match.end)).toBe('alice@example.com');
  });

  it('provides summary with pattern and match counts', async () => {
    const result = await examplePiiFilter.analyze(
      envelope('alice@example.com'),
    );

    expect(result.summary).toEqual({
      patternsChecked: 2,
      matchCount: 1,
    });
  });
});
