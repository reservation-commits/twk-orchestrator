import { NextRequest, NextResponse } from 'next/server';
import { captureSnapshot } from '@/lib/observability';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Scheduled health snapshot. Point an external cron (EasyPanel/cron-job.org) at this daily.
// Locked with CRON_SECRET when set (header `Authorization: Bearer <secret>` or `?secret=`);
// if the env var is unset it stays open (aggregate score only — no sensitive data).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret;
}

async function run(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  try {
    const snapshot = await captureSnapshot();
    return NextResponse.json({ ok: true, at: new Date().toISOString(), snapshot });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
