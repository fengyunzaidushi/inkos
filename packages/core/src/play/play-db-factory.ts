import { PlayDB } from "./play-db.js";
import { PlayFileDB } from "./play-file-db.js";
import type { PlayReducerDB } from "./play-reducer.js";

export function createPlayDB(runDir: string): PlayReducerDB {
  try {
    return new PlayDB(runDir);
  } catch (error) {
    if (isMissingNodeSqliteError(error)) {
      return new PlayFileDB(runDir);
    }
    throw error;
  }
}

function isMissingNodeSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("node:sqlite") || message.includes("No such built-in module");
}
