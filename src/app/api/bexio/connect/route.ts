import { NextResponse } from 'next/server';
import { requireCtx } from '@/server/auth/next';
import { AppError } from '@/server/context';
import { canonicalRedirect } from '@/integrations/bexio/oauth';
import { startConnect } from '@/server/services/bexio';

export async function GET(req: Request) {
  // The session cookie is per host. If the flow starts on another host than APP_URL (apex vs www, old domain,
  // *.vercel.app), bexio sends the user back to APP_URL without that cookie and the connection is lost.
  // Restart the flow on the APP_URL host first.
  const canonical = canonicalRedirect(req, '/api/bexio/connect');
  if (canonical) return NextResponse.redirect(canonical);
  const { ctx } = await requireCtx();
  try {
    return NextResponse.redirect(await startConnect(ctx));
  } catch (e) {
    const code = e instanceof AppError ? e.message : 'unexpected_error';
    return NextResponse.redirect(new URL(`/bexio?error=${code}`, req.url));
  }
}
