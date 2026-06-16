import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStoryboardCreation, type StoryboardAssetsManifest } from "../pipeline/script-storyboard-runner.js";
import type { AgentContext } from "../agents/base.js";

const chatCompletionMock = vi.hoisted(() => vi.fn());

vi.mock("../llm/provider.js", () => ({
  chatCompletion: chatCompletionMock,
}));

describe("storyboard creation runner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-storyboard-assets-"));
    chatCompletionMock.mockReset();
    chatCompletionMock.mockResolvedValue({
      content: [
        "# 冷库账页 分镜",
        "",
        "## 分镜表",
        "镜头 1：女出纳推开冷库门。",
        "镜头 2：手电光扫过旧账页。",
        "",
        "## 图像提示词",
        "1. 冷库门口，女出纳推门，冷色写实，9:16",
        "2. 旧账页特写，手电光扫过红章",
      ].join("\n"),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a first-class image asset manifest and asset directories", async () => {
    const result = await runStoryboardCreation({
      projectRoot: root,
      runtime: makeRuntime(root),
      title: "冷库账页",
      instruction: "把小说片段拆成分镜。",
      projectId: "cold-ledger",
      visualStyle: "写实冷色",
      aspectRatio: "9:16",
    });

    expect(result.assetsManifestPath).toBe("storyboards/cold-ledger/assets.json");
    expect(result.assetsDir).toBe("storyboards/cold-ledger/assets");
    expect((await stat(join(root, "storyboards/cold-ledger/assets/source"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/generated"))).isDirectory()).toBe(true);
    expect((await stat(join(root, "storyboards/cold-ledger/assets/selected"))).isDirectory()).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(root, result.assetsManifestPath), "utf-8"),
    ) as StoryboardAssetsManifest;
    expect(manifest.kind).toBe("storyboard_assets");
    expect(manifest.storyboardPath).toBe(result.storyboardPath);
    expect(manifest.imagePromptsPath).toBe(result.imagePromptsPath);
    expect(manifest.assets.map((asset) => [asset.shotId, asset.prompt])).toEqual([
      ["shot-001", "冷库门口，女出纳推门，冷色写实，9:16"],
      ["shot-002", "旧账页特写，手电光扫过红章"],
    ]);
  });
});

function makeRuntime(root: string): AgentContext {
  return {
    projectRoot: root,
    model: "test-model",
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: {
        temperature: 0.5,
        maxTokens: 4096,
        thinkingBudget: 0,
        extra: {},
      },
    },
  };
}
