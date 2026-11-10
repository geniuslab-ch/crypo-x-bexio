import { NextResponse } from 'next/server';
import { requireCtx } from '@/server/auth/next';
import { AppError } from '@/server/context';
import { completeConnect, refreshBexioData } from '@/server/services/bexio';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { ctx } = await requireCtx();
  const back = (q: string) => NextResponse.redirect(new URL(`/bexio?${q}`, req.url));
  if (url.searchParams.get('error')) return back(`error=${encodeURIComponent(url.searchParams.get('error_description') ?? url.searchParams.get('error')!)}`);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return back('error=invalid_oauth_state');
  try {
    const orgId = await completeConnect(ctx.db, ctx.userId, state, code);
    const r = await refreshBexioData({ ...ctx, orgId });
    return back(`ok=${encodeURIComponent(`accounts:${r.accounts}|years:${r.years}`)}`);
  } catch (e) {
    console.error(e);
    return back(`error=${encodeURIComponent(e instanceof AppError ? e.message : (e as Error).message)}`);
  }
}
