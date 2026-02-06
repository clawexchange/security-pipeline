import type { Request, Response } from 'express';
import type { ModerationService, HumanActionRequest, HumanAction } from './types.js';

/**
 * Create human admin endpoint handlers.
 * Human endpoints can access content via signed URLs (with audit logging).
 */
export function createHumanController(service: ModerationService) {
  return {
    /**
     * GET /human/quarantine
     * List quarantine records with metadata for human review.
     * Query params: status, tier, offset, limit
     */
    async listQuarantine(req: Request, res: Response): Promise<void> {
      try {
        const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
        const tier = typeof req.query['tier'] === 'string' ? req.query['tier'] : undefined;
        const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;
        const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;

        const result = await service.listQuarantine({ status, tier, offset, limit });
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        res.status(500).json({ error: message });
      }
    },

    /**
     * POST /human/content-access
     * Request a signed URL for viewing quarantined content.
     * Body: { quarantineId: string }
     * The access is logged in the audit trail.
     */
    async requestContentAccess(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown>;

        if (typeof body['quarantineId'] !== 'string' || body['quarantineId'] === '') {
          res.status(400).json({ error: 'quarantineId is required and must be a non-empty string' });
          return;
        }

        // Extract admin ID from authenticated request (set by humanAuth middleware)
        const adminId = (req as Request & { adminId?: string }).adminId ?? 'unknown-admin';

        const result = await service.getContentAccess(body['quarantineId'] as string, adminId);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        if (message.includes('not found')) {
          res.status(404).json({ error: message });
          return;
        }
        res.status(500).json({ error: message });
      }
    },

    /**
     * POST /human/action
     * Execute a moderation action from a human admin.
     * Body: { quarantineId: string, action: 'release' | 'delete', notes?: string }
     */
    async postAction(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown>;

        if (typeof body['quarantineId'] !== 'string' || body['quarantineId'] === '') {
          res.status(400).json({ error: 'quarantineId is required and must be a non-empty string' });
          return;
        }
        if (typeof body['action'] !== 'string') {
          res.status(400).json({ error: 'action is required and must be a string' });
          return;
        }
        if (body['notes'] !== undefined && typeof body['notes'] !== 'string') {
          res.status(400).json({ error: 'notes must be a string if provided' });
          return;
        }

        // Extract admin ID from authenticated request (set by humanAuth middleware)
        const adminId = (req as Request & { adminId?: string }).adminId ?? 'unknown-admin';

        const request: HumanActionRequest = {
          quarantineId: body['quarantineId'] as string,
          action: body['action'] as HumanAction,
          notes: body['notes'] as string | undefined,
        };

        const result = await service.executeHumanAction(request, adminId);

        if (!result.success) {
          res.status(400).json({ error: result.message, status: result.newStatus });
          return;
        }

        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        res.status(500).json({ error: message });
      }
    },
  };
}
