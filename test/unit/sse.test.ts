import { describe, expect, it, vi } from "vitest";

import { createHueClient } from "../../src/index";
import { SseParser } from "../../src/internal/sse";
import { sseResponse } from "./helpers";

describe("SSE support", () => {
  it("parses fragmented server-sent events", () => {
    const parser = new SseParser();

    expect(parser.push('id: 1770343753:0\ndata: [{"id":"event-1","type":"update","creationtime":"2026-02-06T02:09:13Z","data":[]}')).toEqual([]);
    expect(parser.push(']\n\n')).toEqual([
      {
        data: '[{"id":"event-1","type":"update","creationtime":"2026-02-06T02:09:13Z","data":[]}]',
        id: '1770343753:0',
      },
    ]);
  });

  it("streams typed event messages and forwards If-None-Match", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.headers.get("If-None-Match")).toBe("1770336203:0");
      return sseResponse([
        'id: 1770343753:0\n',
        'data: [{"id":"event-1","type":"update","creationtime":"2026-02-06T02:09:13Z","data":[]}]\n\n',
      ]);
    });

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    const messages: Array<{ events: Array<{ id: string; type: string }>; id?: string }> = [];
    for await (const message of client.events.stream({ reconnect: false, since: "1770336203:0" })) {
      messages.push(message as Array<{ events: Array<{ id: string; type: string }>; id?: string }>[number]);
    }

    expect(messages).toEqual([
      {
        events: [{ creationtime: "2026-02-06T02:09:13Z", data: [], id: "event-1", type: "update" }],
        id: "1770343753:0",
      },
    ]);
  });

  it("flushes trailing UTF-8 decoder state before finishing the SSE parser", async () => {
    const encoded = new TextEncoder().encode(
      'id: 1770343753:0\ndata: [{"id":"event-1","type":"update","creationtime":"2026-02-06T02:09:13Z","data":[{"name":"Café"}]}]\n\n',
    );
    const splitIndex = encoded.lastIndexOf(0xc3);
    expect(splitIndex).toBeGreaterThan(0);

    const fetch = vi.fn(async () =>
      sseResponse([
        encoded.slice(0, splitIndex + 1),
        encoded.slice(splitIndex + 1),
      ]),
    );

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    const iterator = client.events.stream({ reconnect: false })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        events: [
          {
            data: [{ name: "Café" }],
            id: "event-1",
            type: "update",
          },
        ],
        id: "1770343753:0",
      },
    });
  });

  it("fails fast on malformed JSON event payloads", async () => {
    const fetch = vi.fn(async () => sseResponse(['id: 1\n', 'data: {bad json}\n\n']));

    const client = createHueClient({
      applicationKey: "test-key",
      bridgeUrl: "https://bridge.local",
      fetch,
    });

    const iterator = client.events.stream({ reconnect: false })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow();
  });
});
