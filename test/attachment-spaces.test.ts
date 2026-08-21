import { expect, mock, test } from "bun:test";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  GET_EXPIRES_SECONDS,
  PUT_EXPIRES_SECONDS,
} from "@/lib/attachments/attachments";

mock.module("server-only", () => ({}));

test("Spaces adapter signs origin PUT/GET for opaque keys without User or filename data", async () => {
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

if (!process.env.TEST_ATTACHMENTS_SPACE_BUCKET) {
  test.skip("non-production Spaces contract (TEST_ATTACHMENTS_SPACE_BUCKET is not configured)", () => {});
}
