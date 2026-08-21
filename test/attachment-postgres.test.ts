import { expect, mock, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { createAttachmentService } from "@/lib/attachments/attachments";
import { jpegBytes } from "./attachment-fixtures";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("Attachment PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Attachment PostgreSQL contract enforces quota races, reuse, Revision limits, and public current Revision reads", async () => {
    const schema = `attachment_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 4,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    const objects = new Map<string, Uint8Array>();
    try {
      for (const name of (
        await readdir(join(process.cwd(), "contributions", "migrations"))
      ).sort())
        await sql.unsafe(
          await readFile(
            join(process.cwd(), "contributions", "migrations", name),
            "utf8",
          ),
        );
      const { PostgresAttachmentRepository } = await import(
        "@/lib/attachments/postgres"
      );
      const repository = new PostgresAttachmentRepository(sql, {
        userQuota: 100,
        globalQuota: 150,
      });
      const attachments = createAttachmentService(repository, {
        async presignPut({ key }) {
          return { url: `https://space.test/${key}`, headers: {} };
        },
        async presignGet({ key }) {
          return { url: `https://space.test/${key}?get=1` };
        },
        async head(key) {
          const bytes = objects.get(key);
          return bytes
            ? { contentLength: bytes.byteLength, contentType: "image/jpeg" }
            : undefined;
        },
        async get(key) {
          return objects.get(key);
        },
        async delete(key) {
          objects.delete(key);
        },
        async exists(key) {
          return objects.has(key);
        },
      });
      const userA = crypto.randomUUID();
      const userB = crypto.randomUUID();
      await sql`
        INSERT INTO contribution_users (id, status, public_display_name)
        VALUES
          (${userA}, 'active', 'Uploader A'),
          (${userB}, 'active', 'Uploader B')
      `;
      const bytes = jpegBytes();
      expect(bytes.byteLength).toBeLessThan(100);

      const racing = await Promise.allSettled([
        (async () => {
          const client = postgres(connection, {
            max: 1,
            connection: { search_path: schema },
            onnotice: () => {},
          });
          try {
            return await createAttachmentService(
              new PostgresAttachmentRepository(client, {
                userQuota: 100,
                globalQuota: 150,
              }),
              {
                async presignPut({ key }) {
                  return { url: `https://space.test/${key}`, headers: {} };
                },
                async presignGet({ key }) {
                  return { url: `https://space.test/${key}`, headers: {} };
                },
                async head() {
                  return undefined;
                },
                async get() {
                  return undefined;
                },
                async delete() {},
                async exists() {
                  return false;
                },
              },
            ).reserveUpload({
              userId: userA,
              byteSize: 80,
              filename: "a.jpg",
              contentType: "image/jpeg",
            });
          } finally {
            await client.end({ timeout: 0 });
          }
        })(),
        (async () => {
          const client = postgres(connection, {
            max: 1,
            connection: { search_path: schema },
            onnotice: () => {},
          });
          try {
            return await createAttachmentService(
              new PostgresAttachmentRepository(client, {
                userQuota: 100,
                globalQuota: 150,
              }),
              {
                async presignPut({ key }) {
                  return { url: `https://space.test/${key}`, headers: {} };
                },
                async presignGet({ key }) {
                  return { url: `https://space.test/${key}`, headers: {} };
                },
                async head() {
                  return undefined;
                },
                async get() {
                  return undefined;
                },
                async delete() {},
                async exists() {
                  return false;
                },
              },
            ).reserveUpload({
              userId: userA,
              byteSize: 80,
              filename: "b.jpg",
              contentType: "image/jpeg",
            });
          } finally {
            await client.end({ timeout: 0 });
          }
        })(),
      ]);
      const succeeded = racing.filter(
        (result) => result.status === "fulfilled",
      );
      const failed = racing.filter((result) => result.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "quota-exceeded",
      });

      await sql`DELETE FROM upload_intents`;
      await attachments.reserveUpload({
        userId: userA,
        byteSize: 80,
        filename: "a.jpg",
        contentType: "image/jpeg",
      });
      await expect(
        attachments.reserveUpload({
          userId: userB,
          byteSize: 80,
          filename: "b.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "global-quota-exceeded" });

      await sql`DELETE FROM upload_intents`;
      const reservation = await attachments.reserveUpload({
        userId: userA,
        byteSize: bytes.byteLength,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });
      objects.set(reservation.objectKey, bytes);
      const stored = await attachments.completeUpload({
        userId: userA,
        intentId: reservation.intentId,
      });
      const copy = await attachments.reserveUpload({
        userId: userA,
        byteSize: bytes.byteLength,
        filename: "copy.jpg",
        contentType: "image/jpeg",
      });
      objects.set(copy.objectKey, bytes);
      const reused = await attachments.completeUpload({
        userId: userA,
        intentId: copy.intentId,
      });
      expect(reused).toMatchObject({ id: stored.id, reused: true });
      expect(objects.has(copy.objectKey)).toBe(false);

      const reviewId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      await sql`
        SELECT publish_review(
          ${reviewId}, ${revisionId}, ${userA},
          'COMP', '2000', NULL, NULL, NULL,
          'Useful labs.', 'attributed', 'review-test-v1'
        )
      `;
      const [attachment] = await attachments.attachToRevision({
        userId: userA,
        revisionId,
        attachments: [
          {
            storedFileId: stored.id,
            filename: "photo.jpg",
            description: "Lab bench",
          },
        ],
      });
      const signed = await attachments.signPublicRead(attachment.id);
      expect(signed.mime).toBe("image/jpeg");
      await sql`UPDATE reviews SET publication_state = 'withdrawn' WHERE id = ${reviewId}`;
      await expect(
        attachments.signPublicRead(attachment.id),
      ).rejects.toMatchObject({ code: "attachment-not-found" });

      await sql`UPDATE reviews SET publication_state = 'active' WHERE id = ${reviewId}`;
      expect(await attachments.removeStoredFile(stored.id)).toEqual({
        removed: true,
      });
      await expect(
        attachments.signPublicRead(attachment.id),
      ).rejects.toMatchObject({ code: "attachment-unavailable" });
    } finally {
      await sql.end({ timeout: 0 });
      const drop = postgres(connection, { max: 1, onnotice: () => {} });
      await drop.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await drop.end({ timeout: 0 });
    }
  });
}
