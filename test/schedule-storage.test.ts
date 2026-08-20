import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { makeScheduleGeneration, scheduleFixtureSha } from "./schedule-fixture";

mock.module("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const name of [
    "SCHEDULE_SPACE_ENDPOINT",
    "SCHEDULE_SPACE_BUCKET",
    "SCHEDULE_SPACE_ACCESS_KEY_ID",
    "SCHEDULE_SPACE_SECRET_ACCESS_KEY",
  ])
    delete process.env[name];
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("immutable Schedule objects use conditional creation and compare races", async () => {
  const root = await mkdtemp(join(tmpdir(), "schedule-store-"));
  temporaryDirectories.push(root);
  const directory = await makeScheduleGeneration(root);
  process.env.SCHEDULE_SPACE_ENDPOINT = "https://sgp1.example.test";
  process.env.SCHEDULE_SPACE_BUCKET = "private-test";
  process.env.SCHEDULE_SPACE_ACCESS_KEY_ID = "test-access";
  process.env.SCHEDULE_SPACE_SECRET_ACCESS_KEY = "test-secret";

  const filenames = ["manifest.json", "classes.parquet", "courses.parquet"];
  const existing = new Map<string, Buffer>(
    await Promise.all(
      filenames.map(
        async (filename) =>
          [
            `schedule/generations/${scheduleFixtureSha}/${filename}`,
            await readFile(join(directory, filename)),
          ] as const,
      ),
    ),
  );
  const conditionalPuts: string[] = [];
  const client = {
    async send(command: PutObjectCommand | GetObjectCommand) {
      if (command instanceof PutObjectCommand) {
        expect(command.input.IfNoneMatch).toBe("*");
        conditionalPuts.push(String(command.input.Key));
        throw Object.assign(new Error("created concurrently"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      const body = existing.get(String(command.input.Key));
      if (!body)
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        ContentLength: body.length,
        Body: {
          transformToWebStream() {
            return new Blob([new Uint8Array(body)]).stream();
          },
        },
      };
    },
  };
  const { SpacesScheduleStore } = await import("@/lib/schedule/runtime");
  const store = new SpacesScheduleStore(client as unknown as S3Client);

  await expect(
    store.putGeneration(scheduleFixtureSha, directory),
  ).resolves.toBeUndefined();
  expect(conditionalPuts).toHaveLength(3);

  existing.set(
    `schedule/generations/${scheduleFixtureSha}/classes.parquet`,
    Buffer.from("different bytes"),
  );
  await expect(
    store.putGeneration(scheduleFixtureSha, directory),
  ).rejects.toThrow("different bytes");
});
