export interface ServerSentEventMessage {
  data?: string;
  id?: string;
}

function finalizeBlock(block: string): ServerSentEventMessage | undefined {
  const lines = block.split(/\r?\n/);
  let dataLines: string[] = [];
  let id: string | undefined;

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") {
      dataLines.push(value);
      continue;
    }

    if (field === "id") {
      id = value;
    }
  }

  if (dataLines.length === 0 && id === undefined) {
    return undefined;
  }

  return {
    data: dataLines.length > 0 ? dataLines.join("\n") : undefined,
    id,
  };
}

/**
 * Incremental parser for Server-Sent Events.
 */
export class SseParser {
  #buffer = "";

  push(chunk: string): ServerSentEventMessage[] {
    this.#buffer += chunk;
    return this.#drain(false);
  }

  finish(): ServerSentEventMessage[] {
    return this.#drain(true);
  }

  #drain(flush: boolean): ServerSentEventMessage[] {
    const messages: ServerSentEventMessage[] = [];
    const pattern = /\r?\n\r?\n/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(this.#buffer)) !== null) {
      const block = this.#buffer.slice(lastIndex, match.index);
      lastIndex = match.index + match[0].length;
      const message = finalizeBlock(block);
      if (message) {
        messages.push(message);
      }
    }

    this.#buffer = this.#buffer.slice(lastIndex);

    if (flush && this.#buffer.trim().length > 0) {
      const message = finalizeBlock(this.#buffer);
      if (message) {
        messages.push(message);
      }
      this.#buffer = "";
    }

    return messages;
  }
}
