// Single shared password, no user accounts. The password is a Worker secret (ADMIN_PASSWORD: `wrangler secret put`,
// locally `.dev.vars`), never in the repo. Login sets a signed session cookie (HMAC-SHA256 keyed by the password, so
// changing the password logs everyone out): HttpOnly, Secure, SameSite=Strict. Without it the API is read-only.
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../types';

const COOKIE = 'rzl_admin';
const MAX_AGE = 30 * 24 * 3600; // s

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, msg: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`rzl-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(msg));
}

/** Constant-time comparison of two strings (compares their SHA-256 digests). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(x, y);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

async function sessionToken(secret: string, exp: number): Promise<string> {
  return `${exp}.${b64url(await hmac(secret, String(exp)))}`;
}

async function validSession(secret: string | undefined, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const exp = Number(token.split('.')[0]);
  if (!exp || exp < Date.now() / 1000) return false;
  return safeEqual(token, await sessionToken(secret, exp));
}

/** Sets c.var.admin; changes (anything but GET/HEAD) and the operator-only views need it. */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const admin = await validSession(c.env.ADMIN_PASSWORD, getCookie(c, COOKIE));
  c.set('admin', admin);
  if (!admin) {
    const path = c.req.path.replace(/^\/api\/v1/, '');
    const write = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    const operatorView = /^\/seasons\/\d+\/(instances|issues|history)$/.test(path) || path === '/players/search';
    if ((write && !path.startsWith('/auth/')) || operatorView) return c.json({ error: 'Pro změny se přihlaste (zámek vpravo nahoře)' }, 401);
  }
  await next();
};

export async function login(c: Context<AppEnv>): Promise<Response> {
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  const secret = c.env.ADMIN_PASSWORD;
  // Cloudflare rate limiting (binding LOGIN_LIMIT, per client IP) against guessing.
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if (c.env.LOGIN_LIMIT && !(await c.env.LOGIN_LIMIT.limit({ key: ip })).success) return c.json({ error: 'Příliš mnoho pokusů, zkuste to za chvíli' }, 429);
  if (!secret || !password || !(await safeEqual(password, secret))) {
    await new Promise((r) => setTimeout(r, 700));
    return c.json({ error: secret ? 'Nesprávné heslo' : 'Přihlášení není nastavené (chybí ADMIN_PASSWORD)' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  setCookie(c, COOKIE, await sessionToken(secret, exp), { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: MAX_AGE });
  return c.json({ admin: true });
}

export function logout(c: Context<AppEnv>): Response {
  deleteCookie(c, COOKIE, { path: '/', secure: true });
  return c.json({ admin: false });
}
