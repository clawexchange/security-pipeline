import { describe, it, expect } from 'vitest';
import { exampleSecretScanner } from './index.js';
import type { ContentEnvelope } from '@clawexchange/security-pipeline';

function envelope(text: string): ContentEnvelope {
  return { text, contentType: 'POST' };
}

describe('exampleSecretScanner', () => {
  it('has correct plugin metadata', () => {
    expect(exampleSecretScanner.id).toBe('example-secret-scanner-v1');
    expect(exampleSecretScanner.priority).toBe(10);
    expect(exampleSecretScanner.enabled).toBe(true);
  });

  it('returns clean result for safe content', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('This is a perfectly normal post about trading widgets.'),
    );

    expect(result.score).toBe(0);
    expect(result.labels).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('detects AWS access key', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('My AWS key is AKIAIOSFODNN7EXAMPLE and it works great'),
    );

    expect(result.score).toBe(90);
    expect(result.labels).toContain('AWS_KEY');
    expect(result.labels).toContain('CREDENTIAL');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.patternId).toBe('aws-access-key');
    expect(result.matches[0]!.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects GitHub token', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('Use this token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'),
    );

    expect(result.score).toBe(90);
    expect(result.labels).toContain('GITHUB_TOKEN');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.patternId).toBe('github-token');
  });

  it('detects generic API key assignment', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('config: api_key="sk_test_abc123def456ghi789jkl"'),
    );

    expect(result.score).toBeGreaterThan(0);
    expect(result.labels).toContain('API_KEY');
  });

  it('detects PEM private key header', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('-----BEGIN RSA PRIVATE KEY-----\nMIIEowI...'),
    );

    expect(result.score).toBe(95);
    expect(result.labels).toContain('PRIVATE_KEY');
  });

  it('detects Slack webhook URL', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope('Send alerts to https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnop'),
    );

    expect(result.score).toBe(80);
    expect(result.labels).toContain('SLACK_WEBHOOK');
  });

  it('detects multiple secrets and sums scores', async () => {
    const result = await exampleSecretScanner.analyze(
      envelope(
        'AWS: AKIAIOSFODNN7EXAMPLE\n' +
        'GitHub: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      ),
    );

    // AWS (90) + GitHub (90) = 180
    expect(result.score).toBe(180);
    expect(result.labels).toContain('AWS_KEY');
    expect(result.labels).toContain('GITHUB_TOKEN');
    expect(result.matches).toHaveLength(2);
  });

  it('redacts matched text in output', async () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const result = await exampleSecretScanner.analyze(
      envelope(`Key: ${key}`),
    );

    expect(result.matches[0]!.redacted).not.toBe(key);
    // Redacted should preserve first 4 and last 2 chars
    expect(result.matches[0]!.redacted).toMatch(/^AKIA\*+LE$/);
  });

  it('records correct match positions', async () => {
    const text = 'Prefix AKIAIOSFODNN7EXAMPLE suffix';
    const result = await exampleSecretScanner.analyze(envelope(text));

    const match = result.matches[0]!;
    expect(text.slice(match.start, match.end)).toBe('AKIAIOSFODNN7EXAMPLE');
  });
});
