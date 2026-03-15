import type { HueClient } from "../index";

import { applyGroupState, applyLightState, type HueInventory, recallScene, resolveGroup, resolveLight, resolveScene } from "./hue-service";
import type { PromptAdapter, WorkflowDefinition, WorkflowStep } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorkflow(options: {
  client: HueClient;
  dryRun?: boolean;
  inventory: HueInventory;
  workflow: WorkflowDefinition;
}): Promise<Array<{ kind: WorkflowStep["kind"]; targetId?: string }>> {
  const executed: Array<{ kind: WorkflowStep["kind"]; targetId?: string }> = [];

  for (const step of options.workflow.steps) {
    executed.push({ kind: step.kind, targetId: "targetId" in step ? step.targetId : undefined });
    if (options.dryRun) {
      continue;
    }

    switch (step.kind) {
      case "delay":
        await sleep(step.ms);
        break;
      case "light.set":
        await applyLightState(options.client, step.targetId, step);
        break;
      case "room.set": {
        const room = await resolveGroup(options.inventory, "room", step.targetId);
        await applyGroupState(options.client, room, step);
        break;
      }
      case "scene.recall": {
        const scene = await resolveScene(options.inventory, step.targetId);
        await recallScene(options.client, scene, { action: step.action, duration: step.duration });
        break;
      }
      case "zone.set": {
        const zone = await resolveGroup(options.inventory, "zone", step.targetId);
        await applyGroupState(options.client, zone, step);
        break;
      }
    }
  }

  return executed;
}

function parseXY(input: string | undefined): { x: number; y: number } | undefined {
  if (!input) {
    return undefined;
  }

  const [xText, yText] = input.split(",");
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }

  return { x, y };
}

async function promptLightStep(prompt: PromptAdapter, inventory: HueInventory): Promise<WorkflowStep> {
  const light = await resolveLight(inventory, undefined, prompt);
  const brightness = await prompt.text("Brightness (blank to skip)");
  const mirek = await prompt.text("Color temperature mirek (blank to skip)");
  const xy = await prompt.text("XY color as x,y (blank to skip)");
  const on = await prompt.select("Power state", [
    { title: "Leave unchanged", value: "skip" },
    { title: "On", value: "on" },
    { title: "Off", value: "off" },
  ]);

  return {
    ...(brightness ? { brightness: Number(brightness) } : {}),
    ...(mirek ? { colorTemperatureMirek: Number(mirek) } : {}),
    ...(xy ? { xy: parseXY(xy) } : {}),
    kind: "light.set",
    ...(on === "on" ? { on: true } : on === "off" ? { on: false } : {}),
    targetId: light.id,
  };
}

async function promptGroupStep(prompt: PromptAdapter, inventory: HueInventory, kind: "room" | "zone"): Promise<WorkflowStep> {
  const group = await resolveGroup(inventory, kind, undefined, prompt);
  const brightness = await prompt.text("Brightness (blank to skip)");
  const mirek = await prompt.text("Color temperature mirek (blank to skip)");
  const xy = await prompt.text("XY color as x,y (blank to skip)");
  const on = await prompt.select("Power state", [
    { title: "Leave unchanged", value: "skip" },
    { title: "On", value: "on" },
    { title: "Off", value: "off" },
  ]);

  return {
    ...(brightness ? { brightness: Number(brightness) } : {}),
    ...(mirek ? { colorTemperatureMirek: Number(mirek) } : {}),
    ...(xy ? { xy: parseXY(xy) } : {}),
    kind: `${kind}.set`,
    ...(on === "on" ? { on: true } : on === "off" ? { on: false } : {}),
    targetId: group.id,
  } as WorkflowStep;
}

async function promptSceneStep(prompt: PromptAdapter, inventory: HueInventory): Promise<WorkflowStep> {
  const scene = await resolveScene(inventory, undefined, prompt);
  const action = await prompt.select("Scene action", [
    { title: "active", value: "active" },
    { title: "dynamic_palette", value: "dynamic_palette" },
    { title: "static", value: "static" },
  ]);
  const duration = await prompt.text("Transition duration ms (blank to skip)");

  return {
    ...(action ? { action } : {}),
    ...(duration ? { duration: Number(duration) } : {}),
    kind: "scene.recall",
    targetId: scene.id,
  };
}

export async function createWorkflowDefinition(prompt: PromptAdapter, inventory: HueInventory): Promise<WorkflowDefinition> {
  const description = await prompt.text("Workflow description (optional)");
  const steps: WorkflowStep[] = [];

  while (true) {
    const choice = await prompt.select("Add workflow step", [
      { title: "Light set", value: "light.set" },
      { title: "Room set", value: "room.set" },
      { title: "Zone set", value: "zone.set" },
      { title: "Scene recall", value: "scene.recall" },
      { title: "Delay", value: "delay" },
      { title: "Finish", value: "finish" },
    ]);

    if (!choice || choice === "finish") {
      break;
    }

    switch (choice) {
      case "delay": {
        const ms = await prompt.text("Delay in milliseconds", "1000");
        steps.push({ kind: "delay", ms: Number(ms ?? "1000") });
        break;
      }
      case "light.set":
        steps.push(await promptLightStep(prompt, inventory));
        break;
      case "room.set":
        steps.push(await promptGroupStep(prompt, inventory, "room"));
        break;
      case "scene.recall":
        steps.push(await promptSceneStep(prompt, inventory));
        break;
      case "zone.set":
        steps.push(await promptGroupStep(prompt, inventory, "zone"));
        break;
    }
  }

  return {
    ...(description ? { description } : {}),
    steps,
  };
}
