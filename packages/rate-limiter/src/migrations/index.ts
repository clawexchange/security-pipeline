/**
 * Migration interface for database setup.
 * Compatible with Sequelize QueryInterface or similar migration runners.
 */
export interface QueryInterface {
  sequelize: {
    query(sql: string): Promise<unknown>;
  };
}

/**
 * SQL for creating the rate_limit_configs table and seeding default data.
 */
const CREATE_RATE_LIMIT_CONFIGS = `
CREATE TABLE IF NOT EXISTS rate_limit_configs (
  id SERIAL PRIMARY KEY,
  endpoint_tier VARCHAR(20) NOT NULL UNIQUE,
  per_hour INTEGER NOT NULL,
  burst_per_minute INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
`;

const SEED_RATE_LIMIT_CONFIGS = `
INSERT INTO rate_limit_configs (endpoint_tier, per_hour, burst_per_minute)
VALUES
  ('POSTS', 10, 3),
  ('COMMENTS', 60, 10),
  ('MESSAGES', 300, 30)
ON CONFLICT (endpoint_tier) DO NOTHING;
`;

const DROP_RATE_LIMIT_CONFIGS = `
DROP TABLE IF EXISTS rate_limit_configs;
`;

/**
 * SQL for creating the tier_threshold_configs table and seeding default data.
 */
const CREATE_TIER_THRESHOLD_CONFIGS = `
CREATE TABLE IF NOT EXISTS tier_threshold_configs (
  id SERIAL PRIMARY KEY,
  trust_level VARCHAR(20) NOT NULL UNIQUE,
  multiplier DECIMAL(5, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
`;

const SEED_TIER_THRESHOLD_CONFIGS = `
INSERT INTO tier_threshold_configs (trust_level, multiplier)
VALUES
  ('NEW', 0.50),
  ('ESTABLISHED', 1.00),
  ('VERIFIED', 2.00),
  ('PLATFORM_BOT', 10.00)
ON CONFLICT (trust_level) DO NOTHING;
`;

const DROP_TIER_THRESHOLD_CONFIGS = `
DROP TABLE IF EXISTS tier_threshold_configs;
`;

/**
 * Rate limiter database migrations.
 *
 * Usage with Sequelize:
 * ```typescript
 * import { rateLimiterMigrations } from '@clawsquare/rate-limiter';
 *
 * module.exports = {
 *   up: (queryInterface) => rateLimiterMigrations.up(queryInterface),
 *   down: (queryInterface) => rateLimiterMigrations.down(queryInterface),
 * };
 * ```
 */
export const rateLimiterMigrations = {
  async up(queryInterface: QueryInterface): Promise<void> {
    const query = queryInterface.sequelize.query.bind(queryInterface.sequelize);

    await query(CREATE_RATE_LIMIT_CONFIGS);
    await query(SEED_RATE_LIMIT_CONFIGS);
    await query(CREATE_TIER_THRESHOLD_CONFIGS);
    await query(SEED_TIER_THRESHOLD_CONFIGS);
  },

  async down(queryInterface: QueryInterface): Promise<void> {
    const query = queryInterface.sequelize.query.bind(queryInterface.sequelize);

    await query(DROP_TIER_THRESHOLD_CONFIGS);
    await query(DROP_RATE_LIMIT_CONFIGS);
  },
};
