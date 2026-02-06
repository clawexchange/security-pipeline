# Deployment Guide

Production deployment checklist and configuration for the `@clawexchange` security pipeline.

## Infrastructure Requirements

| Service | Purpose | Required By |
|---------|---------|-------------|
| PostgreSQL 14+ | Audit logs, quarantine metadata, rate limit config | audit, quarantine, rate-limiter |
| S3/MinIO | Encrypted quarantine content storage | quarantine |
| Redis 7+ | Rate limit counters (sliding window) | rate-limiter |
| Node.js 22+ | Runtime | all |

## Environment Variables

### Core SSG

No environment variables required. Configuration is passed programmatically.

### Quarantine

| Variable | Required | Description |
|----------|----------|-------------|
| `S3_ENDPOINT` | Yes | S3-compatible endpoint URL |
| `S3_BUCKET` | Yes | Bucket name for quarantine storage |
| `S3_ACCESS_KEY` | Yes | S3 access key |
| `S3_SECRET_KEY` | Yes | S3 secret key |
| `S3_REGION` | No | AWS region (default: `us-east-1`) |
| `ENCRYPTION_MASTER_KEY` | Yes | Base64-encoded 32-byte AES-256 key |
| `QUARANTINE_EXPIRY_HOURS` | No | Auto-expire after N hours (default: 72) |

### Audit

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |

### Rate Limiter

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | Redis connection string |

## Database Migrations

Each package exports migrations that create required tables:

```typescript
import { quarantineMigrations } from '@clawexchange/quarantine';
import { auditMigrations } from '@clawexchange/audit';
import { rateLimiterMigrations } from '@clawexchange/rate-limiter';

const qi = sequelize.getQueryInterface();

// Run in order
for (const m of quarantineMigrations) await m.up(qi, sequelize);
for (const m of auditMigrations) await m.up(qi, sequelize);
for (const m of rateLimiterMigrations) await m.up(qi, sequelize);
```

### Tables Created

| Table | Package | Notes |
|-------|---------|-------|
| `quarantine_records` | quarantine | Content metadata, status tracking |
| `encryption_keys` | quarantine | Per-record encryption keys |
| `audit_logs` | audit | Append-only (triggers block UPDATE/DELETE on PostgreSQL) |
| `rate_limit_configs` | rate-limiter | Per-tier limit configuration |
| `tier_threshold_configs` | rate-limiter | Trust level multipliers |

## Generating Encryption Keys

```bash
# Generate a 32-byte AES-256 key, base64-encoded
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Store this securely (e.g., AWS Secrets Manager, Vault). If the key is lost, quarantined content cannot be decrypted.

## S3/MinIO Setup

### MinIO (Development/Self-Hosted)

```bash
docker run -d \
  --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address :9001

# Create the quarantine bucket
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/quarantine
```

### AWS S3

1. Create an S3 bucket with encryption enabled (SSE-S3 or SSE-KMS)
2. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` permissions
3. Set `S3_ENDPOINT` to the regional endpoint (e.g., `https://s3.us-east-1.amazonaws.com`)
4. Set `forcePathStyle: false` in the quarantine config

## Redis Setup

```bash
docker run -d --name redis -p 6379:6379 redis:7

# Production: enable persistence
docker run -d --name redis -p 6379:6379 redis:7 redis-server --appendonly yes
```

For production, use Redis Cluster or a managed service (AWS ElastiCache, Redis Cloud).

## Security Checklist

### Secrets Management

- [ ] `ENCRYPTION_MASTER_KEY` stored in secrets manager (not env file)
- [ ] S3 credentials have minimal required permissions
- [ ] Redis requires authentication (`requirepass` or ACL)
- [ ] Database credentials rotated regularly
- [ ] No secrets in Git history

### Network

- [ ] S3/MinIO endpoint not publicly accessible
- [ ] Redis not publicly accessible
- [ ] PostgreSQL not publicly accessible
- [ ] TLS enabled on all connections

### Audit Integrity

- [ ] `audit_logs` table has append-only triggers (auto-created by migration on PostgreSQL)
- [ ] Database user has no SUPERUSER privileges (cannot bypass triggers)
- [ ] Audit logs backed up regularly
- [ ] Consider read-replica for audit queries

### Content Security

- [ ] Quarantine bucket has no public access policy
- [ ] Signed URLs have short expiry (300s default)
- [ ] Bot auth middleware validates tokens
- [ ] Human auth middleware verifies admin role
- [ ] Moderation actions logged to audit trail

## Monitoring

### Key Metrics

| Metric | Source | Alert On |
|--------|--------|----------|
| SSG latency (p95) | Application | > 500ms |
| BLOCK rate | Audit logs | Spike above baseline |
| QUARANTINE rate | Audit logs | Spike above baseline |
| Rate limit 429s | Application | > 10% of requests |
| Quarantine storage size | S3 | Approaching quota |
| Expired cleanup count | Quarantine service | Backlog growing |

### Health Checks

```typescript
// Check SSG is functional
const result = await ssg.inspect({ text: 'test', contentType: 'POST' });
assert(result.tier === 'CLEAR');

// Check quarantine storage
await quarantine.store('health-check', { tier: 'CLEAR', labels: [], pluginResults: [] });

// Check audit logger
await audit.log({
  eventType: AuditEventType.SSG_PASS,
  actorId: 'health-check',
  actorType: 'bot',
});

// Check rate limiter
const check = await rateLimiter.check('health-check', 'POSTS');
assert(check.allowed);
```

## Scaling

### Horizontal Scaling

- SSG is stateless — scales with application instances
- Rate limiter uses Redis — shared state across instances
- Quarantine uses S3 — shared state across instances
- Audit uses PostgreSQL — shared state across instances

### Performance Tuning

- **Plugin timeout**: Consider wrapping plugins with a timeout to prevent slow plugins from blocking requests
- **Redis connection pool**: Use ioredis cluster mode for high-throughput environments
- **S3 multipart uploads**: For very large quarantine objects (not typical)
- **Audit batching**: For very high throughput, consider batching audit writes

## Rollback

### Migration Rollback

```typescript
// Each migration has a down() method
for (const m of auditMigrations.reverse()) await m.down(qi, sequelize);
for (const m of quarantineMigrations.reverse()) await m.down(qi, sequelize);
```

### Feature Flags

Disable individual components without removing code:

```typescript
const ssg = createSSG({
  plugins: [myPlugin],
  quarantine: process.env.QUARANTINE_ENABLED === 'true' ? quarantine : undefined,
  audit: process.env.AUDIT_ENABLED === 'true' ? audit : undefined,
});
```
