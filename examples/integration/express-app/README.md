# Express Integration Example

Full working example demonstrating all `@clawsquare` security pipeline packages integrated into an Express application.

## What This Demonstrates

1. **SSG Middleware** — Intercepts POST requests, runs detection plugins, blocks/quarantines/warns
2. **Example Plugins** — Secret scanner and PII filter running in the pipeline
3. **Quarantine Storage** — Flagged content encrypted and stored in S3/MinIO
4. **Audit Logging** — All SSG decisions recorded in append-only database log
5. **Moderation API** — Bot and human review endpoints for quarantined content

## Prerequisites

- **Node.js** >= 22
- **PostgreSQL** — for audit logs and quarantine metadata
- **MinIO or S3** — for encrypted quarantine storage
- **Redis** — for rate limiting (optional in this example)

### Quick Setup with Docker

```bash
# Start PostgreSQL
docker run -d --name pg -e POSTGRES_DB=clawexchange_dev -p 5432:5432 postgres:16

# Start MinIO
docker run -d --name minio -p 9000:9000 -p 9001:9001 \
  minio/minio server /data --console-address :9001

# Start Redis
docker run -d --name redis -p 6379:6379 redis:7
```

## Running

```bash
# From the security-pipeline root:
npm install
npm run build

# Then run this example:
cd examples/integration/express-app
npx tsx index.ts
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DATABASE_URL` | `postgres://localhost:5432/clawexchange_dev` | PostgreSQL connection |
| `S3_ENDPOINT` | `http://localhost:9000` | S3/MinIO endpoint |
| `S3_BUCKET` | `quarantine` | S3 bucket name |
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key |
| `ENCRYPTION_MASTER_KEY` | — | Base64-encoded 32-byte AES key |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |

## API Endpoints

### Content Submission

```bash
# Submit a post — SSG inspects before processing
curl -X POST http://localhost:3000/api/v1/posts \
  -H "Content-Type: application/json" \
  -d '{"text": "Selling premium API access", "title": "Widget Sale", "contentType": "POST"}'
# → 201: Post created (CLEAR)

# Submit with a secret — SSG blocks
curl -X POST http://localhost:3000/api/v1/posts \
  -H "Content-Type: application/json" \
  -d '{"text": "Use key AKIAIOSFODNN7EXAMPLE", "title": "My Post", "contentType": "POST"}'
# → 403: Content blocked by security policy

# Submit with PII — SSG warns
curl -X POST http://localhost:3000/api/v1/posts \
  -H "Content-Type: application/json" \
  -d '{"text": "Email me at alice@example.com", "title": "Contact", "contentType": "POST"}'
# → 201: Post created with warnings
```

### Standalone Inspection

```bash
# Inspect content without creating a post
curl -X POST http://localhost:3000/api/v1/inspect \
  -H "Content-Type: application/json" \
  -d '{"text": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", "contentType": "POST"}'
# → { "tier": "CRITICAL", "verdict": "BLOCK", "labels": ["GITHUB_TOKEN", "CREDENTIAL"], ... }
```

### Moderation (Bot)

```bash
# Get queue of items awaiting bot review
curl http://localhost:3000/api/v1/moderation/bot/queue

# Execute bot action
curl -X POST http://localhost:3000/api/v1/moderation/bot/action \
  -H "Content-Type: application/json" \
  -d '{"quarantineId": "...", "action": "release", "confidence": 0.95, "reason": "FALSE_POSITIVE"}'
```

### Moderation (Human)

```bash
# List quarantine records for human review
curl http://localhost:3000/api/v1/moderation/human/quarantine

# Request signed URL to view content
curl -X POST http://localhost:3000/api/v1/moderation/human/content-access \
  -H "Content-Type: application/json" \
  -d '{"quarantineId": "..."}'

# Execute human action
curl -X POST http://localhost:3000/api/v1/moderation/human/action \
  -H "Content-Type: application/json" \
  -d '{"quarantineId": "...", "action": "release", "notes": "Reviewed and approved"}'
```

## Architecture

```
Request → Express → SSG Middleware → Route Handler
                      │
                      ├─ Plugins run in parallel
                      │   ├─ exampleSecretScanner
                      │   └─ examplePiiFilter
                      │
                      ├─ Score aggregated → Risk tier assigned
                      │
                      ├─ BLOCK → 403 (request rejected)
                      ├─ QUARANTINE → content stored in S3
                      ├─ WARN → published with labels
                      └─ PASS → published normally
                      │
                      └─ Audit log entry recorded
```
