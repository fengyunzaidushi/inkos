import { z } from "zod";
import { BaseAgent, type AgentContext } from "../agents/base.js";
import {
  PlayActionIntentSchema,
  PlayMutationSchema,
  type PlayActionIntent,
  type PlayActionIntentInput,
  type PlayMutation,
  type PlayMutationInput,
} from "../models/play.js";

export interface PlayActionInterpreterInput {
  readonly input: string;
  readonly sceneBrief: string;
}

export interface PlayWorldMutatorInput {
  readonly turn: number;
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly context: string;
}

export interface PlaySceneRenderInput {
  readonly input: string;
  readonly action: PlayActionIntentInput;
  readonly mutationSummary: string;
  readonly stateBrief: string;
}

const PlaySceneRenderSchema = z.object({
  sceneText: z.string().min(1),
  suggestedActions: z.array(z.string().min(1)).min(0).max(4).default([]),
});
export type PlaySceneRender = z.infer<typeof PlaySceneRenderSchema>;

export class PlayActionInterpreterAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-action-interpreter";
  }

  async interpret(input: PlayActionInterpreterInput): Promise<PlayActionIntent> {
    const response = await this.chat([
      { role: "system", content: buildActionInterpreterSystemPrompt() },
      { role: "user", content: buildActionInterpreterUserPrompt(input) },
    ], { temperature: 0.15, maxTokens: 1024 });
    return PlayActionIntentSchema.parse(parseJson(response.content));
  }
}

export class PlayWorldMutatorAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-world-mutator";
  }

  async proposeMutation(input: PlayWorldMutatorInput): Promise<PlayMutation> {
    const response = await this.chat([
      { role: "system", content: buildWorldMutatorSystemPrompt() },
      { role: "user", content: buildWorldMutatorUserPrompt(input) },
    ], { temperature: 0.25, maxTokens: 4096 });
    return PlayMutationSchema.parse(parseJson(response.content));
  }
}

export class PlaySceneRendererAgent extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "play-scene-renderer";
  }

  async render(input: PlaySceneRenderInput): Promise<PlaySceneRender> {
    const response = await this.chat([
      { role: "system", content: buildSceneRendererSystemPrompt() },
      { role: "user", content: buildSceneRendererUserPrompt(input) },
    ], { temperature: 0.45, maxTokens: 2048 });
    return PlaySceneRenderSchema.parse(parseJson(response.content));
  }
}

function buildActionInterpreterSystemPrompt(): string {
  return [
    "你是互动小说动作理解器。",
    "你的任务是把玩家一句自然语言，归一成五类动作之一：look / say / move / do / wait。",
    "不要替玩家加戏，不要直接推进剧情，不要写场景正文。",
    "look=观察/检查/回忆线索；say=说话/试探/质问；move=移动到地点；do=执行动作/使用物品/调查；wait=等待/拖延/旁观。",
    "输出严格 JSON，不要解释。",
  ].join("\n");
}

function buildActionInterpreterUserPrompt(input: PlayActionInterpreterInput): string {
  return [
    "当前场景：",
    input.sceneBrief,
    "",
    "玩家输入：",
    input.input,
    "",
    "输出字段：actionKind, targetEntityLabel?, targetLocationLabel?, intent, manner, risk, ambiguity, secondaryActions。",
  ].join("\n");
}

function buildWorldMutatorSystemPrompt(): string {
  return [
    "你是互动小说世界状态草案员。",
    "你只根据玩家动作和当前上下文，提出本回合可能发生的状态变化草案。",
    "不要写最终正文；不要越权替 reducer 落库；不要凭空让关键证据直接完成全部生命周期。",
    "实体包括 actor/location/item/evidence/clue/claim/proof_chain/organization/rule/scene/event。",
    "证据和线索要用状态递进：hinted/seen/collected/verified/weaponized/exposed/exhausted。",
    "如果玩家动作无效或信息不足，blocked=true 并写 blockedReason。",
    "输出严格 JSON，必须符合 PlayMutation：eventId, turn, actionKind, summary, entities, edges, stateSlots, evidence, blocked, blockedReason, notes。",
  ].join("\n");
}

function buildWorldMutatorUserPrompt(input: PlayWorldMutatorInput): string {
  return [
    `turn: ${input.turn}`,
    "玩家原话：",
    input.input,
    "",
    "动作理解：",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    "当前上下文：",
    input.context,
    "",
    "要求：eventId 使用 evt-" + input.turn + "；所有新增或引用的实体 id 要稳定、可读、短小。",
  ].join("\n");
}

function buildSceneRendererSystemPrompt(): string {
  return [
    "你是互动小说场景回应作者。",
    "你只能根据已经应用后的状态写回应，不要推翻 reducer 结果。",
    "回应要像可玩的小说：有动作、感官、压迫、选择余地；不要写成系统日志。",
    "建议动作给 2-4 个，短句即可；开放模式下建议动作只是参考，不限制玩家输入。",
    "输出严格 JSON：sceneText, suggestedActions。",
  ].join("\n");
}

function buildSceneRendererUserPrompt(input: PlaySceneRenderInput): string {
  return [
    "玩家原话：",
    input.input,
    "",
    "动作：",
    JSON.stringify(PlayActionIntentSchema.parse(input.action), null, 2),
    "",
    "已应用的本回合变化：",
    input.mutationSummary,
    "",
    "当前状态摘要：",
    input.stateBrief,
  ].join("\n");
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Play agent did not return JSON.");
  }
}
