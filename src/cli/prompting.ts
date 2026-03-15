import prompts from "prompts";

import type { PromptAdapter, PromptChoice } from "./types";

export function createPromptAdapter(): PromptAdapter {
  return {
    async confirm(message, initial = false) {
      const result = await prompts({ initial, message, name: "value", type: "confirm" });
      return result.value === true;
    },
    async multiselect<T extends string>(message: string, choices: PromptChoice<T>[]) {
      const result = await prompts({
        choices,
        message,
        name: "value",
        type: "multiselect",
      });
      return Array.isArray(result.value) ? (result.value as T[]) : [];
    },
    async select<T extends string>(message: string, choices: PromptChoice<T>[]) {
      const result = await prompts({
        choices,
        message,
        name: "value",
        type: "select",
      });
      return typeof result.value === "string" ? (result.value as T) : undefined;
    },
    async text(message, initial) {
      const result = await prompts({ initial, message, name: "value", type: "text" });
      return typeof result.value === "string" ? result.value : undefined;
    },
  };
}
