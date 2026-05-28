import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayFileDB } from "../play/play-file-db.js";

describe("PlayFileDB", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inkos-play-file-db-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists graph state across instances", () => {
    const db = new PlayFileDB(dir);
    db.upsertEntity({ id: "player", type: "actor", label: "宋词" });
    db.recordEvent({
      id: "evt-1",
      turn: 1,
      actionKind: "look",
      rawInput: "看导航",
      outcomeSummary: "发现地址统计",
      createdAt: "2026-05-28T00:00:00.000Z",
    });
    db.close();

    const reopened = new PlayFileDB(dir);
    expect(reopened.getEntity("player")?.label).toBe("宋词");
    expect(reopened.getEvent("evt-1")?.rawInput).toBe("看导航");
  });

  it("rolls back transaction mutations when validation fails inside the transaction", () => {
    const db = new PlayFileDB(dir);

    expect(() => db.transaction(() => {
      db.upsertEntity({ id: "temp", type: "actor", label: "临时角色" });
      throw new Error("fail");
    })).toThrow("fail");

    expect(db.getEntity("temp")).toBeNull();
  });
});
