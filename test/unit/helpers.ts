const encoder = new TextEncoder();

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "text/event-stream");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

export async function readRequestJson(request: Request): Promise<unknown> {
  const text = await request.clone().text();
  return text.length > 0 ? JSON.parse(text) : undefined;
}
