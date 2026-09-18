import type { Tree, TreeStorage } from "@shared/types";

const DB = "tree-learn";
const TREES = "trees";

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TREES, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("This browser blocked local storage for the site."));
  });
  return opening;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(TREES, mode).objectStore(TREES));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Topics live in this browser's IndexedDB: same shape as the JSON files of local mode. */
export function createIdbStorage(): TreeStorage {
  // Ask the browser not to evict our data under storage pressure. Best effort.
  void navigator.storage?.persist?.().catch(() => {});
  return {
    ids: async () => (await tx("readonly", (s) => s.getAllKeys())) as string[],
    load: async (id) => (await tx<Tree | undefined>("readonly", (s) => s.get(id))) ?? undefined,
    save: async (tree) => void (await tx("readwrite", (s) => s.put(structuredClone(tree)))),
    remove: async (id) => void (await tx("readwrite", (s) => s.delete(id))),
  };
}
