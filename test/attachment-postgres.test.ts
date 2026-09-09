import { expect, test, vi } from "vitest";
import { createAttachmentService } from "@/lib/attachments/attachments";
import { jpegBytes } from "./attachment-fixtures";
import { withPostgresSchema } from "./postgres-fixture";

vi.mock("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("Attachment PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("Attachment PostgreSQL contract enforces quota races, reuse, Revision limits, and public current Revision reads", async () => {
    await withPostgresSchema("attachment", async ({ sql }) => {
      const objects = new Map<string, Uint8Array>();
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
        async put(key, bytes) {
          objects.set(key, bytes);
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
        attachments.reserveUpload({
          userId: userA,
          byteSize: 80,
          filename: "a.jpg",
          contentType: "image/jpeg",
        }),
        attachments.reserveUpload({
          userId: userA,
          byteSize: 80,
          filename: "b.jpg",
          contentType: "image/jpeg",
        }),
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

      // Expiry cleanup removes replayable staging and a raced deduplication
      // candidate while retaining accepted bytes and pre-fix legacy objects.
      const legacyIntent = crypto.randomUUID();
      const legacyFile = crypto.randomUUID();
      await repository.reserve({
        userId: userB,
        intentId: legacyIntent,
        objectKey: legacyIntent,
        declaredByteSize: bytes.length,
        declaredExtension: "jpg",
        declaredMime: "image/jpeg",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await repository.beginValidation(legacyIntent);
      await repository.accept({
        intentId: legacyIntent,
        reused: false,
        storedFile: {
          id: legacyFile,
          ownerUserId: userB,
          objectKey: legacyIntent,
          byteSize: bytes.length,
          sha256: "ab".repeat(32),
          detectedMime: "image/jpeg",
        },
      });
      objects.set(legacyIntent, bytes);
      objects.set(reservation.objectKey, Buffer.alloc(bytes.length));
      objects.set(`verified/${copy.intentId}`, bytes);
      expect(await attachments.cleanupExpired()).toBe(0);
      await sql`UPDATE upload_intents SET expires_at = now() - interval '1 minute'`;
      expect(await attachments.cleanupExpired()).toBe(3);
      expect(objects.has(reservation.objectKey)).toBe(false);
      expect(objects.has(`verified/${copy.intentId}`)).toBe(false);
      expect(objects.get(legacyIntent)).toEqual(bytes);
      const publishedKey = new URL(signed.url).pathname.slice(1);
      expect(objects.get(publishedKey)).toEqual(bytes);
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
    });
  });
}
