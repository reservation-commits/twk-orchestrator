import { NextResponse } from 'next/server';
import { seoAudit, coversGap } from '@/lib/seo';
import { getHealthTrend } from '@/lib/observability';

export const runtime = 'nodejs';

// GET /api/seo → SEO health score + checks + translation-expansion + missing-cover breakdown + trend.
export async function GET() {
  try {
    const [audit, covers, trend] = await Promise.all([
      seoAudit(),
      coversGap(),
      getHealthTrend(90).catch(() => []),
    ]);
    return NextResponse.json({ audit, covers, trend });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
