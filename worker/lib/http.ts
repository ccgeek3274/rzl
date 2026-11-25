import { HTTPException } from 'hono/http-exception';

/** Throw a JSON error with a Czech message (handled in index.ts). */
export function fail(status: 400 | 404 | 409 | 422 | 429 | 502 | 503, message: string): never {
  throw new HTTPException(status, { message });
}

export const now = () => Date.now();
