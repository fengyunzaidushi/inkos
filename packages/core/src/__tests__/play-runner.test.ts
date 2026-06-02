import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlayActionIntentInput,
  PlayEdgeInput,
  PlayEntity,
  PlayEntityInput,
  PlayEventInput,
  PlayMutationInput,
  PlayStateSlot,
  PlayStateSlotInput,
} from "../models/play.js";
import { PlayRunner } from "../play/play-runner.js";
import type { PlaySceneRender } from "../play/play-agents.js";

class FakePlayDB {
  entities = new Map<string, PlayEntity>();
  edges = new Map<string, PlayEdgeInput>();
  stateSlots = new Map<string, PlayStateSlot>();
  events: PlayEventInput[] = [];

  transaction<T>(fn: () => T): T {
    return fn();
  }

  upsertEntity(entity: PlayEntityInput): void {
    this.entities.set(entity.id, { summary: "", status: "", ...entity });
  }

  getEntity(id: string): PlayEntity | null {
    return this.entities.get(id) ?? null;
  }

  upsertEdge(edge: PlayEdgeInput): void {
    this.edges.set(edge.id, edge);
  }

  expireEdge(edgeId: string, validUntilEventId: string): void {
    const edge = this.edges.get(edgeId);
    if (edge) this.edges.set(edgeId, { ...edge, validUntilEventId });
  }

  upsertStateSlot(slot: PlayStateSlotInput): void {
    this.stateSlots.set(slot.id, { ownerEntityId: null, ...slot });
  }

  getStateSlotsForEntity(entityId: string): PlayStateSlot[] {
    return [...this.stateSlots.values()].filter((slot) => slot.ownerEntityId === entityId);
  }

  recordEvent(event: PlayEventInput): void {
    this.events.push(event);
  }
}

describe("PlayRunner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-play-runner-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs one player action end to end and persists event, transcript, and projections", async () => {
    const db = new FakePlayDB();
    const action: PlayActionIntentInput = {
      actionKind: "look",
      targetEntityLabel: "导航记录",
      intent: "查看常用地址统计",
    };
    const mutation: PlayMutationInput = {
      eventId: "evt-1",
      turn: 1,
      actionKind: "look",
      summary: "发现新城花园 187 次。",
      entities: {
        upsert: [
          { id: "player", type: "actor", label: "宋词" },
          { id: "nav-stats", type: "evidence", label: "常用地址统计" },
        ],
      },
      stateSlots: {
        upsert: [{
          id: "pressure:player:danger",
          ownerEntityId: "player",
          kind: "pressure",
          label: "被发现风险",
          value: { current: 20, min: 0, max: 100 },
          updatedEventId: "evt-1",
        }],
      },
      evidence: {
        transitions: [{
          entityId: "nav-stats",
          to: "seen",
          reason: "车机弹出统计。",
        }],
      },
    };
    const render: PlaySceneRender = {
      sceneText: "屏幕弹出新城花园 187 次，宋词握着手机没有抬头。",
      suggestedActions: ["继续看医院记录", "问徐晋安今晚去哪"],
    };

    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "betrayal-car",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => action) },
        worldMutator: { proposeMutation: vi.fn(async () => mutation) },
        sceneRenderer: { render: vi.fn(async () => render) },
      },
    });

    const result = await runner.step("我假装看天气，顺手点开车机导航记录");

    expect(result.sceneText).toContain("新城花园");
    expect(result.suggestedActions).toEqual(["继续看医院记录", "问徐晋安今晚去哪"]);
    expect(db.events).toHaveLength(1);
    expect(db.entities.get("nav-stats")?.type).toBe("evidence");
    expect(db.stateSlots.get("evidence:nav-stats:status")?.value).toMatchObject({ status: "seen" });

    const runDir = join(root, "worlds", "betrayal-car", "runs", "run-1");
    await expect(readFile(join(runDir, "events.jsonl"), "utf-8"))
      .resolves.toContain("\"id\":\"evt-1\"");
    await expect(readFile(join(runDir, "transcript.jsonl"), "utf-8"))
      .resolves.toContain("我假装看天气");
    await expect(readFile(join(runDir, "projections", "state.md"), "utf-8"))
      .resolves.toContain("发现新城花园 187 次");
    await expect(readFile(join(runDir, "projections", "scene.md"), "utf-8"))
      .resolves.toContain("屏幕弹出新城花园 187 次");
  });

  it("does not persist a one-sided user transcript when mutation application fails", async () => {
    const db = new FakePlayDB();
    const runner = new PlayRunner({
      projectRoot: root,
      worldId: "bad-turn",
      runId: "run-1",
      db,
      agents: {
        actionInterpreter: { interpret: vi.fn(async () => ({ actionKind: "look", intent: "看墙上的钟" })) },
        worldMutator: {
          proposeMutation: vi.fn(async () => ({
            eventId: "evt-1",
            turn: 1,
            actionKind: "look",
            summary: "错误地引用了不存在的人。",
            stateSlots: {
              upsert: [{
                id: "slot_missing",
                ownerEntityId: "missing_actor",
                kind: "pressure",
                label: "压力",
                value: 10,
                updatedEventId: "evt-1",
              }],
            },
          })),
        },
        sceneRenderer: { render: vi.fn(async () => ({ sceneText: "钟停在十二点。", suggestedActions: [] })) },
      },
    });

    await expect(runner.step("我看墙上的钟")).rejects.toThrow(/missing entity/);
    await expect(readFile(join(root, "worlds", "bad-turn", "runs", "run-1", "transcript.jsonl"), "utf-8"))
      .rejects
      .toThrow();
  });
});
