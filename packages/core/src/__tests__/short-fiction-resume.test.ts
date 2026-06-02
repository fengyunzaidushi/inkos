import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShortFictionOutlineAgent,
  ShortFictionOutlineReviewerAgent,
  ShortFictionOutlineReviserAgent,
  ShortFictionWriterAgent,
  ShortFictionDraftReviewerAgent,
  ShortFictionDraftReviserAgent,
  ShortFictionPackagingAgent,
  parseShortFictionBatchDraft,
} from "../agents/short-fiction.js";
import { runShortFictionProduction } from "../pipeline/short-fiction-runner.js";

const CH = 12;
const DRAFT_MD = `
=== SHORT_FICTION_TITLE ===
电梯多一层
${Array.from({ length: CH }, (_, i) => `=== CHAPTER ${i + 1} TITLE ===
第${i + 1}章
=== CHAPTER ${i + 1} CONTENT ===
${"深夜的电梯停在不存在的十三层，门开了。".repeat(20)}`).join("\n")}
`;

function ctx(projectRoot: string) {
  return { client: { provider: "openai" } as never, model: "fake", projectRoot };
}
function runtimes(projectRoot: string) {
  const c = ctx(projectRoot);
  return { planner: c, outlineReview: c, writer: c, draftReview: c, revise: c, package: c };
}

describe("short fiction resume + failure marker (C2)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "inkos-shortc2-")); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  function stubDownstream() {
    const draft = parseShortFictionBatchDraft(DRAFT_MD, { expectedChapters: CH });
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionDraftReviewerAgent.prototype, "reviewDraft").mockResolvedValue("looks fine");
    vi.spyOn(ShortFictionDraftReviserAgent.prototype, "reviseDraft").mockResolvedValue(draft);
    vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage").mockResolvedValue({
      title: "电梯多一层", intro: "钩子", sellingPoints: ["反转"], coverPrompt: "", rawContent: "",
    });
  }

  it("resumes from an existing outline/v002.md, skipping the three outline stages", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## 既有大纲\n12章完整方案", "utf-8");

    const createOutline = vi.spyOn(ShortFictionOutlineAgent.prototype, "createOutline");
    const reviewOutline = vi.spyOn(ShortFictionOutlineReviewerAgent.prototype, "reviewOutline");
    stubDownstream();

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "恐怖短篇", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(createOutline).not.toHaveBeenCalled();   // outline resumed from disk
    expect(reviewOutline).not.toHaveBeenCalled();
    await expect(access(join(root, "shorts", "elevator", "final", "full.md"))).resolves.toBeUndefined();
    expect(result.storyId).toBe("elevator");
  });

  it("writes a failure marker (status.json) when a stage throws, instead of orphaning a silent partial", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## 既有大纲", "utf-8");
    // Writer stage fails with a transient-style upstream error.
    vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft").mockRejectedValue(new Error("503 temporarily unavailable"));

    await expect(runShortFictionProduction({
      projectRoot: root, direction: "恐怖短篇", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    })).rejects.toThrow(/503/);

    const status = JSON.parse(await readFile(join(root, "shorts", "elevator", "status.json"), "utf-8"));
    expect(status.status).toBe("failed");
    expect(status.error).toContain("503");
  });

  it("returns the existing short untouched when final/full.md already exists (idempotent)", async () => {
    await mkdir(join(root, "shorts", "elevator", "final"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "final", "full.md"), "# done", "utf-8");
    const writeDraft = vi.spyOn(ShortFictionWriterAgent.prototype, "writeDraft");

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "恐怖短篇", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(writeDraft).not.toHaveBeenCalled();       // nothing regenerated
    expect(result.coverError).toBe("already-complete");
  });

  it("does not skip a previously failed run just because final/full.md exists", async () => {
    await mkdir(join(root, "shorts", "elevator", "outline"), { recursive: true });
    await mkdir(join(root, "shorts", "elevator", "final"), { recursive: true });
    await writeFile(join(root, "shorts", "elevator", "outline", "v002.md"), "## 既有大纲", "utf-8");
    await writeFile(join(root, "shorts", "elevator", "final", "full.md"), "# partial final", "utf-8");
    await writeFile(join(root, "shorts", "elevator", "status.json"), JSON.stringify({ status: "failed", error: "package failed" }), "utf-8");
    stubDownstream();
    const packageSpy = vi.spyOn(ShortFictionPackagingAgent.prototype, "generatePackage");

    const result = await runShortFictionProduction({
      projectRoot: root, direction: "恐怖短篇", storyId: "elevator",
      chapterCount: CH, charsPerChapter: 1000, cover: false, runtimes: runtimes(root),
    });

    expect(result.coverError).toBe("disabled");
    expect(packageSpy).toHaveBeenCalled();
    await expect(access(join(root, "shorts", "elevator", "final", "sales-package.md"))).resolves.toBeUndefined();
  });
});
