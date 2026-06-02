import type { AgentContext } from "../agents/base.js";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  type PlayActionIntent,
  type PlayActionIntentInput,
  type PlayMutation,
  type PlayMutationInput,
} from "../models/play.js";
import {
  PlayActionInterpreterAgent,
  PlaySceneRendererAgent,
  PlayWorldMutatorAgent,
  type PlaySceneRender,
} from "./play-agents.js";
import { createPlayDB } from "./play-db-factory.js";
import { applyPlayMutation, type PlayReducerDB } from "./play-reducer.js";
import { PlayStore } from "./play-store.js";

export interface PlayActionInterpreterLike {
  readonly interpret: (input: {
    readonly input: string;
    readonly sceneBrief: string;
    readonly language?: "zh" | "en";
  }) => Promise<PlayActionIntentInput>;
}

export interface PlayWorldMutatorLike {
  readonly proposeMutation: (input: {
    readonly turn: number;
    readonly input: string;
    readonly action: PlayActionIntentInput;
    readonly context: string;
    readonly language?: "zh" | "en";
  }) => Promise<PlayMutationInput>;
}

export interface PlaySceneRendererLike {
  readonly render: (input: {
    readonly input: string;
    readonly action: PlayActionIntentInput;
    readonly mutationSummary: string;
    readonly stateBrief: string;
    readonly mode?: "open" | "guided";
    readonly language?: "zh" | "en";
    readonly worldPremise?: string;
  }) => Promise<PlaySceneRender>;
}

export interface PlayRunnerOptions {
  readonly projectRoot: string;
  readonly worldId: string;
  readonly runId: string;
  readonly ctx?: AgentContext;
  readonly store?: PlayStore;
  readonly db?: PlayReducerDB;
  readonly agents?: {
    readonly actionInterpreter?: PlayActionInterpreterLike;
    readonly worldMutator?: PlayWorldMutatorLike;
    readonly sceneRenderer?: PlaySceneRendererLike;
  };
}

export interface PlayStepResult extends PlaySceneRender {
  readonly action: PlayActionIntent;
  readonly mutation: PlayMutation;
}

export class PlayRunner {
  private readonly store: PlayStore;
  private readonly db: PlayReducerDB;
  private readonly actionInterpreter: PlayActionInterpreterLike;
  private readonly worldMutator: PlayWorldMutatorLike;
  private readonly sceneRenderer: PlaySceneRendererLike;

  constructor(private readonly options: PlayRunnerOptions) {
    this.store = options.store ?? new PlayStore(options.projectRoot);
    this.db = options.db ?? createPlayDB(this.store.runDir(options.worldId, options.runId));
    if (!options.ctx && (!options.agents?.actionInterpreter || !options.agents.worldMutator || !options.agents.sceneRenderer)) {
      throw new Error("PlayRunner requires ctx when default play agents are used.");
    }
    const ctx = options.ctx;
    this.actionInterpreter = options.agents?.actionInterpreter ?? new PlayActionInterpreterAgent(ctx!);
    this.worldMutator = options.agents?.worldMutator ?? new PlayWorldMutatorAgent(ctx!);
    this.sceneRenderer = options.agents?.sceneRenderer ?? new PlaySceneRendererAgent(ctx!);
  }

  async step(input: string): Promise<PlayStepResult> {
    const rawInput = input.trim();
    if (!rawInput) throw new Error("Play input is empty.");

    await this.store.ensureRun(this.options.worldId, this.options.runId);
    const turn = (await this.store.readEvents(this.options.worldId, this.options.runId)).length + 1;
    const world = await this.store.loadWorld(this.options.worldId);
    const language = world?.language ?? "zh";
    const sceneBrief = await this.readOptionalProjection("projections/scene.md");
    const action = PlayActionIntentSchema.parse(await this.actionInterpreter.interpret({
      input: rawInput,
      sceneBrief: sceneBrief || (language === "en" ? "A new turn begins; carry over the current world state." : "新回合开始，沿用当前世界状态。"),
      language,
    }));
    const context = await this.buildContextBrief(sceneBrief, language);
    const mutation = PlayMutationSchema.parse(await this.worldMutator.proposeMutation({
      turn,
      input: rawInput,
      action,
      context,
      language,
    }));
    const stateBrief = renderStateBrief({ action, mutation });

    // Render BEFORE any commit. The renderer is fail-open (never throws), but the
    // ordering still matters: nothing about this turn (db mutation, event, state,
    // scene, transcript) is persisted until the scene is in hand — so a turn is
    // all-or-nothing and can never leave a "state advanced but tool failed" half-state.
    const render = await this.sceneRenderer.render({
      input: rawInput,
      action,
      mutationSummary: mutation.summary || mutation.blockedReason,
      stateBrief,
      mode: world?.mode ?? "open",
      language,
      worldPremise: world?.premise,
    });

    // Commit everything together, only after the scene succeeded.
    const applied = applyPlayMutation({
      db: this.db,
      mutation,
      rawInput,
    });
    await this.store.appendEvent(this.options.worldId, this.options.runId, applied.event);
    await this.store.writeProjection(this.options.worldId, this.options.runId, "projections/state.md", stateBrief);
    await this.store.saveCurrentState(this.options.worldId, this.options.runId, {
      turn,
      lastEventId: applied.event.id,
      lastAction: action,
      lastSummary: mutation.summary,
      blocked: mutation.blocked,
    });
    await this.store.writeProjection(this.options.worldId, this.options.runId, "projections/scene.md", `${render.sceneText}\n`);
    await this.store.appendTranscriptTurn(this.options.worldId, this.options.runId, {
      role: "user",
      content: rawInput,
      timestamp: Date.now(),
    });
    await this.store.appendTranscriptTurn(this.options.worldId, this.options.runId, {
      role: "assistant",
      content: render.sceneText,
      timestamp: Date.now(),
    });

    return {
      ...render,
      action,
      mutation,
    };
  }

  private async buildContextBrief(sceneBrief: string, language: "zh" | "en"): Promise<string> {
    const stateBrief = await this.readOptionalProjection("projections/state.md");
    const isEn = language === "en";
    const sceneLabel = isEn ? "Current scene:" : "当前场景：";
    const stateLabel = isEn ? "Current state:" : "当前状态：";
    return [
      sceneBrief ? `${sceneLabel}\n${sceneBrief}` : "",
      stateBrief ? `${stateLabel}\n${stateBrief}` : "",
    ].filter(Boolean).join("\n\n") || (isEn ? "No persisted state yet." : "暂无持久化状态。");
  }

  private async readOptionalProjection(relativePath: string): Promise<string> {
    try {
      return await this.store.readProjection(this.options.worldId, this.options.runId, relativePath);
    } catch {
      return "";
    }
  }
}

function renderStateBrief(input: {
  readonly action: PlayActionIntent;
  readonly mutation: PlayMutation;
}): string {
  const lines = [
    `# Play State`,
    "",
    `- action: ${input.action.actionKind} ${input.action.intent}`.trim(),
    `- summary: ${input.mutation.summary || input.mutation.blockedReason}`,
  ];
  if (input.mutation.entities.upsert.length > 0) {
    lines.push("", "## Entities");
    for (const entity of input.mutation.entities.upsert) {
      lines.push(`- ${entity.id} [${entity.type}]: ${entity.label}${entity.summary ? ` — ${entity.summary}` : ""}`);
    }
  }
  if (input.mutation.stateSlots.upsert.length > 0) {
    lines.push("", "## State Slots");
    for (const slot of input.mutation.stateSlots.upsert) {
      lines.push(`- ${slot.id}: ${JSON.stringify(slot.value)}`);
    }
  }
  if (input.mutation.evidence.transitions.length > 0) {
    lines.push("", "## Evidence");
    for (const transition of input.mutation.evidence.transitions) {
      lines.push(`- ${transition.entityId}: ${transition.to}${transition.reason ? ` — ${transition.reason}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
