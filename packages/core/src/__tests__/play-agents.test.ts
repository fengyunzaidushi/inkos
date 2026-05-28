import { describe, expect, it, vi } from "vitest";
import {
  PlayActionInterpreterAgent,
  PlaySceneRendererAgent,
  PlayWorldMutatorAgent,
} from "../play/play-agents.js";

const ctx = {
  client: { provider: "openai" } as never,
  model: "test-model",
  projectRoot: "/tmp/inkos-play-test",
};

describe("play agents", () => {
  it("interprets free user text into a bounded play action", async () => {
    const agent = new PlayActionInterpreterAgent(ctx);
    vi.spyOn(agent as unknown as { chat: PlayActionInterpreterAgent["chat"] }, "chat").mockResolvedValue({
      content: JSON.stringify({
        actionKind: "look",
        targetEntityLabel: "导航记录",
        intent: "查看常用地址统计",
        manner: "不让丈夫发现",
      }),
    } as never);

    await expect(agent.interpret({
      input: "我假装看天气，顺手点开车机导航记录",
      sceneBrief: "车内，丈夫刚把东西放进后备箱。",
    })).resolves.toMatchObject({
      actionKind: "look",
      targetEntityLabel: "导航记录",
      intent: "查看常用地址统计",
    });
  });

  it("rejects mutator output that is not a valid mutation", async () => {
    const agent = new PlayWorldMutatorAgent(ctx);
    vi.spyOn(agent as unknown as { chat: PlayWorldMutatorAgent["chat"] }, "chat").mockResolvedValue({
      content: JSON.stringify({ eventId: "", turn: -1, actionKind: "teleport" }),
    } as never);

    await expect(agent.proposeMutation({
      turn: 1,
      input: "我打开导航",
      action: { actionKind: "look", intent: "查看导航" },
      context: "车内。",
    })).rejects.toThrow();
  });

  it("renders the applied state as prose plus suggested actions", async () => {
    const agent = new PlaySceneRendererAgent(ctx);
    vi.spyOn(agent as unknown as { chat: PlaySceneRendererAgent["chat"] }, "chat").mockResolvedValue({
      content: JSON.stringify({
        sceneText: "车机屏幕亮了一下，常用地址统计弹出一行冷冰冰的数字。",
        suggestedActions: ["继续翻看医院记录", "套徐晋安的话"],
      }),
    } as never);

    await expect(agent.render({
      input: "看导航",
      action: { actionKind: "look", intent: "查看导航" },
      mutationSummary: "发现新城花园 187 次。",
      stateBrief: "证据：常用地址统计=seen。",
    })).resolves.toMatchObject({
      sceneText: expect.stringContaining("车机屏幕"),
      suggestedActions: ["继续翻看医院记录", "套徐晋安的话"],
    });
  });
});
