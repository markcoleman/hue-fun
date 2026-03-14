# Event Streaming

Hue exposes `/eventstream/clip/v2` for bridge events. The client supports both JSON polling and streaming SSE messages.

## Polling

```ts
const events = await client.events.poll({
  since: "1770336203:0",
});
```

## Streaming

```ts
for await (const message of client.events.stream({
  reconnect: true,
  since: "1770336203:0",
})) {
  console.log(message.id, message.events);
}
```

## Behavior

- `since` is forwarded as `If-None-Match`
- SSE messages are parsed into `{ id, events }`
- reconnect is enabled by default for dropped event streams
- malformed SSE JSON fails fast so calling code can decide how to recover
