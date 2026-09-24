import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { capturePhotos, RestaurantForCapture } from '@/lib/photo-curator';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST /api/photos/capture  { restaurant_id }  → SSE stream of progress + final candidates
export async function POST(req: NextRequest) {
  const { restaurant_id } = (await req.json()) as { restaurant_id: string };

  const ac = new AbortController();
  req.signal.addEventListener('abort', () => ac.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const row = (await query<RestaurantForCapture>(
          `SELECT restaurant_id, name, city, site_url, place_id FROM public.db_restaurants WHERE restaurant_id = $1`,
          [restaurant_id]
        )).rows[0];
        if (!row) { send({ type: 'error', error: 'Restaurante não encontrado.' }); controller.close(); return; }

        send({ type: 'start', restaurant: { id: row.restaurant_id, name: row.name, city: row.city } });

        const result = await capturePhotos(
          row,
          (ev) => send({ type: 'progress', ...ev }),
          ac.signal
        );

        send({ type: 'result', ...result });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        send({ type: 'error', error: String(err) });
      } finally {
        controller.close();
      }
    },
    cancel() { ac.abort(); },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
