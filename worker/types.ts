export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 'development' enables dev-only features; anything else (or missing) = production. */
  ENVIRONMENT?: string;
};

export type AppEnv = { Bindings: Bindings };
