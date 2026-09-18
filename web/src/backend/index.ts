import type { Backend } from "./types";

export const IS_HOSTED = import.meta.env.VITE_BACKEND === "hosted";

/** The build decides which backend ships: the other one is never bundled. */
export const backendReady: Promise<Backend> = IS_HOSTED
  ? import("./hosted").then((m) => m.createHostedBackend())
  : import("./local").then((m) => m.createLocalBackend());
