export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 'development' enables dev-only features; anything else (or missing) = production. */
  ENVIRONMENT?: string;
  /** The operator password (secret: `wrangler secret put ADMIN_PASSWORD`, locally `.dev.vars`). Missing = nobody can log in. */
  ADMIN_PASSWORD?: string;
  /** Cloudflare rate limiting of login attempts (wrangler.jsonc `ratelimits`). */
  LOGIN_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
};

export type AppEnv = { Bindings: Bindings; Variables: { admin: boolean } };
