import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { webSearch, fetchUrl, findSocialMedia } from '@/lib/scraper';

const SearchSchema = z.object({ query: z.string().min(1), count: z.number().default(5) });
const FetchSchema = z.object({ url: z.string().url() });
const SocialSchema = z.object({ name: z.string().min(1), city: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'search': {
        const { query, count } = SearchSchema.parse(body);
        const results = await webSearch(query, count);
        return NextResponse.json({ results });
      }
      case 'fetch': {
        const { url } = FetchSchema.parse(body);
        const data = await fetchUrl(url);
        return NextResponse.json(data);
      }
      case 'social': {
        const { name, city } = SocialSchema.parse(body);
        const profiles = await findSocialMedia(name, city);
        return NextResponse.json({ profiles });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
