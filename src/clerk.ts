import { verifyToken } from '@clerk/backend';
import type { Env } from './types';

/** Verifica el token de sesión de Clerk y devuelve el user_id (sub) o null. */
export async function getAuthUserId(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const payload = await verifyToken(m[1]!, {
      secretKey: env.CLERK_SECRET_KEY,
      authorizedParties: env.APP_BASE_URL ? [env.APP_BASE_URL] : undefined,
    });
    return (payload.sub as string | undefined) ?? null;
  } catch (err) {
    console.error('clerk.verifyToken:', (err as Error).message);
    return null;
  }
}

export interface ClerkUser {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  image_url: string | null;
}

/** Consulta los datos públicos del usuario en Clerk (nombre, correo, foto). */
export async function fetchClerkUser(env: Env, userId: string): Promise<ClerkUser | null> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    });
    if (!res.ok) {
      console.error('clerk.fetchUser status', res.status);
      return null;
    }
    const u = (await res.json()) as {
      first_name?: string | null;
      last_name?: string | null;
      image_url?: string | null;
      primary_email_address_id?: string | null;
      email_addresses?: Array<{ id: string; email_address: string }>;
    };
    const primary = u.email_addresses?.find((e) => e.id === u.primary_email_address_id);
    const email = primary?.email_address ?? u.email_addresses?.[0]?.email_address ?? null;
    return {
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
      email,
      image_url: u.image_url ?? null,
    };
  } catch (err) {
    console.error('clerk.fetchUser:', (err as Error).message);
    return null;
  }
}
