import { NextRequest, NextResponse } from 'next/server';
import { runAgentStream, AgentMessage } from '@/lib/agent';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { messages } = await req.json() as { messages: AgentMessage[] };

  // Abort the agent loop (and the upstream Anthropic request) if the client disconnects.
  const ac = new AbortController();
  req.signal.addEventListener('abort', () => ac.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        // The agent yields structured events ({type:'text'|'thinking'|'tool_start'|'tool_end'|'usage'|'error'}).
        for await (const event of runAgentStream(messages, undefined, ac.signal)) {
          send(event);
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        send({ type: 'error', error: String(err) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
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
