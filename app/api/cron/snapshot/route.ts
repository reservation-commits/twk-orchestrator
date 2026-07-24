import { NextRequest, NextResponse } from 'next/server';
import { captureSnapshot } from '@/lib/observability';
import { timingSafeEqualStr } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Scheduled health snapshot. Point an external cron (EasyPanel/cron-job.org) at this daily.
// FAIL-CLOSED: sem CRON_SECRET configurado a rota recusa tudo. Somente header
// `Authorization: Bearer <secret>` — nunca query string (vaza em logs de acesso).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') ?? '';
  return timingSafeEqualStr(auth, `Bearer ${secret}`);
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
