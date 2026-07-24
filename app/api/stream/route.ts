import { NextRequest } from 'next/server';
import { bus, type AgentEvent } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send recent history first
      const history = bus.getRecent(20);
      for (const ev of history.reverse()) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }

      // Subscribe to live events
      const unsubscribe = bus.subscribe((event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* connection closed */ }
      });

      // Heartbeat to keep connection alive
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(`:heartbeat ${Date.now()}\n\n`)); }
        catch { clearInterval(hb); unsubscribe(); }
      }, 15000);

      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(hb);
        unsubscribe();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
