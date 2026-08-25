import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("node_modules/@duckdb/duckdb-wasm/dist");
const destination = resolve("public/duckdb/1.32.0");
const assets = [
  "duckdb-browser-eh.worker.js",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-mvp.wasm",
] as const;

await rm(resolve("public/duckdb"), { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await Promise.all(
  assets.map((name) => cp(resolve(source, name), resolve(destination, name))),
);
