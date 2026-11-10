import { NextResponse } from 'next/server';
import { requireCtx } from '@/server/auth/next';
import { AppError } from '@/server/context';
import { startConnect } from '@/server/services/bexio';

export async function GET(req: Request) {
  const { ctx } = await requireCtx();
  try {
    return NextResponse.redirect(await startConnect(ctx));
  } catch (e) {
    const code = e instanceof AppError ? e.message : 'unexpected_error';
    return NextResponse.redirect(new URL(`/bexio?error=${code}`, req.url));
  }
}
