import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tree, TreeStorage } from "../shared/types.ts";

/** One pretty-printed JSON file per topic: easy to read, grep, back up and sync. */
export function createFsStorage(dir: string): TreeStorage {
  const queues = new Map<string, Promise<void>>();
  const fileFor = (id: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("bad id");
    return path.join(dir, `${id}.json`);
  };
  return {
    async ids() {
      await fs.mkdir(dir, { recursive: true });
      return (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    },
    async load(id) {
      try {
        return JSON.parse(await fs.readFile(fileFor(id), "utf8")) as Tree;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    save(tree) {
      // Serialise writes per tree and replace the file atomically so a crash never leaves half a topic.
      const json = JSON.stringify(tree, null, 2);
      const next = (queues.get(tree.id) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          await fs.mkdir(dir, { recursive: true });
          const tmp = `${fileFor(tree.id)}.${process.pid}.tmp`;
          await fs.writeFile(tmp, json);
          await fs.rename(tmp, fileFor(tree.id));
        });
      queues.set(tree.id, next);
      return next;
    },
    async remove(id) {
      await (queues.get(id) ?? Promise.resolve()).catch(() => {});
      await fs.rm(fileFor(id), { force: true });
    },
  };
}
