import { afterEach, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeScheduleGeneration, scheduleFixtureSha } from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("the local Schedule store retains a complete generation under tmp", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-local-store-"));
  temporaryDirectories.push(root);
  const directory = await makeScheduleGeneration(root);
  const { LocalScheduleStore } = await import("@/lib/schedule/runtime");
  const store = new LocalScheduleStore(join(root, "store"));
  const pointer = {
    activeSha: scheduleFixtureSha,
    acceptedAt: "2026-08-21T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T06:00:00.000Z",
  };
  const retired = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  await store.putGeneration(pointer.activeSha, directory);
  await mkdir(join(root, "store", retired));
  await store.writePointer(pointer);

  expect(await store.downloadGeneration(pointer.activeSha)).toBeString();
  expect(await store.downloadGeneration(retired)).toBeUndefined();
  expect(await store.readPointer()).toEqual(pointer);
});
