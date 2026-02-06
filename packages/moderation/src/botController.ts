import type { Request, Response } from 'express';
import type { ModerationService, BotActionRequest, BotAction, BotActionReason } from './types.js';

/**
 * Create bot endpoint handlers.
 * Bot endpoints only expose structured envelopes — NEVER raw content.
 */
export function createBotController(service: ModerationService) {
  return {
    /**
     * GET /bot/queue
     * Returns a paginated list of structured envelopes for bot review.
     * Query params: tier, offset, limit
     */
    async getQueue(req: Request, res: Response): Promise<void> {
      try {
        const tier = typeof req.query['tier'] === 'string' ? req.query['tier'] : undefined;
        const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;
        const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;

        const result = await service.getQueue({ tier, offset, limit });
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        res.status(500).json({ error: message });
      }
    },

    /**
     * POST /bot/action
     * Execute a moderation action from a bot.
     * Body must conform to BotActionRequest fixed schema.
     */
    async postAction(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as Record<string, unknown>;

        // Validate required fields
        if (typeof body['quarantineId'] !== 'string' || body['quarantineId'] === '') {
          res.status(400).json({ error: 'quarantineId is required and must be a non-empty string' });
          return;
        }
        if (typeof body['action'] !== 'string') {
          res.status(400).json({ error: 'action is required and must be a string' });
          return;
        }
        if (typeof body['confidence'] !== 'number') {
          res.status(400).json({ error: 'confidence is required and must be a number' });
          return;
        }
        if (typeof body['reason'] !== 'string') {
          res.status(400).json({ error: 'reason is required and must be a string' });
          return;
        }

        // Extract bot ID from authenticated request (set by botAuth middleware)
        const botId = (req as Request & { botId?: string }).botId ?? 'unknown-bot';

        const request: BotActionRequest = {
          quarantineId: body['quarantineId'] as string,
          action: body['action'] as BotAction,
          confidence: body['confidence'] as number,
          reason: body['reason'] as BotActionReason,
        };

        const result = await service.executeBotAction(request, botId);

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
