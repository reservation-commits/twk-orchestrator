import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  searchRestaurantsByCity,
  getPlaceDetails,
  enrichFromMichelinGuide,
  mapPlaceToDBSchema,
  getPlacePhotoUrls,
} from '@/lib/places';
import Anthropic from '@anthropic-ai/sdk';

// Cliente único por processo: evita recriar conexão/keep-alive a cada request.
let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

// Extrai o primeiro bloco de texto com segurança (content[0] pode não ser texto).
function firstTextBlock(res: Anthropic.Message): string | undefined {
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return block?.text;
}

const SearchSchema = z.object({
  city: z.string().min(1),
  cuisine: z.string().default('fine dining'),
  count: z.number().int().min(1).max(60).default(20),
});

const DetailsSchema = z.object({
  place_id: z.string().min(1),
  city: z.string().min(1),
  enrich_michelin: z.boolean().default(false),
  generate_description: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'search': {
        const { city, cuisine, count } = SearchSchema.parse(body);
        const results = await searchRestaurantsByCity(city, cuisine, count);
        return NextResponse.json({ results, total: results.length });
      }

      case 'details': {
        const { place_id, city, enrich_michelin, generate_description } = DetailsSchema.parse(body);
        const details = await getPlaceDetails(place_id);

        let michelinData;
        if (enrich_michelin) {
          michelinData = await enrichFromMichelinGuide(details.name, city);
        }

        let description: string | undefined;
        if (generate_description) {
          const anthropic = getAnthropic();
          const cuisineTypes = (details.types ?? [])
            .filter((t) => !['establishment', 'food', 'point_of_interest'].includes(t))
            .join(', ');
          const res = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: `Write a 2-3 sentence luxury editorial description for "${details.name}" in ${city}${cuisineTypes ? `, specialising in ${cuisineTypes}` : ''}${details.editorial_summary?.overview ? `. Note: ${details.editorial_summary.overview}` : ''}. Tone: elegant, evocative, aspirational. Language: English.`,
            }],
          });
          description = firstTextBlock(res);
        }

        const mapped = mapPlaceToDBSchema(details, city, description, michelinData);
        const photos = details.photos ? getPlacePhotoUrls(details.photos, 800, 5) : [];

        return NextResponse.json({ details, mapped, photos, michelin: michelinData });
      }

      case 'batch_enrich': {
        const { restaurants, city } = body as {
          restaurants: { place_id: string; name: string }[];
          city: string;
        };
        const MAX_BATCH = 25;
        if (!Array.isArray(restaurants) || !restaurants.length) {
          return NextResponse.json({ error: 'restaurants deve ser um array não vazio' }, { status: 400 });
        }
        if (restaurants.length > MAX_BATCH) {
          return NextResponse.json({ error: `batch_enrich aceita no máximo ${MAX_BATCH} itens por chamada` }, { status: 400 });
        }
        const MAX_CONCURRENT = 5;
        const results = [];

        for (let i = 0; i < restaurants.length; i += MAX_CONCURRENT) {
          const batch = restaurants.slice(i, i + MAX_CONCURRENT);
          const settled = await Promise.allSettled(
            batch.map(async (r) => {
              const details = await getPlaceDetails(r.place_id);
              const michelin = await enrichFromMichelinGuide(r.name, city);

              const anthropic = getAnthropic();
              const res = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 200,
                messages: [{
                  role: 'user',
                  content: `Write a 2-sentence luxury description for "${r.name}" in ${city}. Elegant, aspirational tone. English.`,
                }],
              });
              const description = firstTextBlock(res);
              return mapPlaceToDBSchema(details, city, description, michelin);
            })
          );
          results.push(...settled);
          if (i + MAX_CONCURRENT < restaurants.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        const fulfilled = results
          .filter((r): r is PromiseFulfilledResult<ReturnType<typeof mapPlaceToDBSchema>> => r.status === 'fulfilled')
          .map((r) => r.value);
        const failed = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => r.reason?.message ?? String(r.reason));

        return NextResponse.json({ enriched: fulfilled, failed, total: results.length });
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
