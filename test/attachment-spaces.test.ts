import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { expect, test, vi } from "vitest";
import {
  GET_EXPIRES_SECONDS,
  PUT_EXPIRES_SECONDS,
} from "@/lib/attachments/attachments";

vi.mock("server-only", () => ({}));

test("Spaces adapter prepares PUT/GET signing requests with opaque keys", async () => {
  const commands: unknown[] = [];
  const { SpacesAttachmentStore } = await import("@/lib/attachments/spaces");
  const store = new SpacesAttachmentStore({
    bucket: "private-attachments",
    prefix: "attachments",
    client: {
      send: async (command: { input?: { Key?: string } }) => {
        commands.push(command);
        if (command.constructor?.name === "HeadObjectCommand")
          return { ContentLength: 12, ContentType: "image/jpeg" };
        if (command.constructor?.name === "DeleteObjectCommand") return {};
        return {
          Body: { transformToByteArray: async () => new Uint8Array(12) },
        };
      },
    } as never,
    sign: async (_client, command, options) => {
      commands.push({ command, options });
      const input = (
        command as { input: { Key: string; ContentType?: string } }
      ).input;
      return `https://sgp1.digitaloceanspaces.com/private-attachments/${input.Key}?expires=${options?.expiresIn}`;
    },
  });

  const put = await store.presignPut({
    key: "00000000-0000-4000-8000-000000000148",
    contentType: "image/jpeg",
    contentLength: 12,
    expiresSeconds: PUT_EXPIRES_SECONDS,
  });
  const get = await store.presignGet({
    key: "00000000-0000-4000-8000-000000000148",
    contentType: "image/jpeg",
    expiresSeconds: GET_EXPIRES_SECONDS,
  });
  const validatedBytes = new Uint8Array([1, 2, 3]);
  await store.put("verified/opaque-id", validatedBytes, "image/jpeg");
  expect(
    commands.find((command) => command instanceof PutObjectCommand),
  ).toMatchObject({
    input: {
      Key: "attachments/verified/opaque-id",
      Body: validatedBytes,
      ContentLength: 3,
      ContentType: "image/jpeg",
    },
  });

  expect(put.url).toContain("attachments/00000000-0000-4000-8000-000000000148");
  expect(put.url).not.toContain("user");
  expect(put.url).not.toContain(".jpg");
  expect(put.url).toContain(`expires=${PUT_EXPIRES_SECONDS}`);
  expect(get.url).toContain(`expires=${GET_EXPIRES_SECONDS}`);
  expect(
    commands.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "command" in item &&
        (item as { command: unknown }).command instanceof PutObjectCommand,
    ),
  ).toBe(true);
  expect(
    commands.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "command" in item &&
        (item as { command: unknown }).command instanceof GetObjectCommand,
    ),
  ).toBe(true);
});
test("Spaces forwards the validation lease cancellation signal to origin HEAD/GET/PUT", async () => {
  const { SpacesAttachmentStore } = await import("@/lib/attachments/spaces");
  const requests: Array<{ name: string; signal?: AbortSignal }> = [];
  const signal = new AbortController().signal;
  const store = new SpacesAttachmentStore({
    bucket: "private-attachments",
    client: {
      send: async (
        command: object,
        options?: { abortSignal?: AbortSignal },
      ) => {
        requests.push({
          name: command.constructor.name,
          signal: options?.abortSignal,
        });
        return {
          ContentLength: 1,
          Body: { transformToByteArray: async () => new Uint8Array([1]) },
        };
      },
    } as never,
  });
  await store.head("staging", signal);
  await store.get("staging", 1, signal);
  await store.put("verified/lease", new Uint8Array([1]), "image/jpeg", signal);
  expect(requests.map((request) => request.name)).toEqual([
    "HeadObjectCommand",
    "GetObjectCommand",
    "PutObjectCommand",
  ]);
  expect(requests.every((request) => request.signal === signal)).toBe(true);
});
