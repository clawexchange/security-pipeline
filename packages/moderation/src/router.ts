import { Router, json } from 'express';
import type { ModerationConfig } from './types.js';
import { createModerationService } from './service.js';
import { createBotController } from './botController.js';
import { createHumanController } from './humanController.js';

/**
 * Create an Express router with bot and human moderation endpoints.
 *
 * Routes:
 *   GET  /bot/queue           - Paginated structured envelopes for bot review
 *   POST /bot/action          - Bot moderation action (fixed schema)
 *   GET  /human/quarantine    - Paginated quarantine list for human review
 *   POST /human/content-access - Request signed URL to view content
 *   POST /human/action        - Human moderation action
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createModerationRouter } from '@clawexchange/moderation';
 *
 * const app = express();
 * const router = createModerationRouter({
 *   quarantine: quarantineService,
 *   audit: auditLogger,
 *   queryQuarantine: myQueryFn,
 *   botAuth: botAuthMiddleware,
 *   humanAuth: humanAuthMiddleware,
 * });
 * app.use('/api/moderation', router);
 * ```
 */
export function createModerationRouter(config: ModerationConfig): Router {
  const router = Router();
  const service = createModerationService(config);
  const botController = createBotController(service);
  const humanController = createHumanController(service);

  // JSON body parsing for action endpoints
  router.use(json());

  // ── Bot endpoints ───────────────────────────────────────────
  router.get('/bot/queue', config.botAuth, (req, res) => {
    void botController.getQueue(req, res);
  });
  router.post('/bot/action', config.botAuth, (req, res) => {
    void botController.postAction(req, res);
  });

  // ── Human endpoints ─────────────────────────────────────────
  router.get('/human/quarantine', config.humanAuth, (req, res) => {
    void humanController.listQuarantine(req, res);
  });
  router.post('/human/content-access', config.humanAuth, (req, res) => {
    void humanController.requestContentAccess(req, res);
  });
  router.post('/human/action', config.humanAuth, (req, res) => {
    void humanController.postAction(req, res);
  });

  return router;
}
