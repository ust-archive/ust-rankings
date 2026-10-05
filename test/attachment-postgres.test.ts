import { createHash } from "node:crypto";
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

      const reserved = (
        succeeded[0] as PromiseFulfilledResult<{ intentId: string }>
      ).value;
      objects.set(reserved.intentId, new Uint8Array(80));
      for (const state of ["rejected", "validation_error"] as const) {
        await repository.markRejected(reserved.intentId, state);
        await expect(
          attachments.reserveUpload({
            userId: userA,
            byteSize: 21,
            filename: "new.jpg",
            contentType: "image/jpeg",
          }),
        ).rejects.toMatchObject({ code: "quota-exceeded" });
        await expect(
          attachments.reserveUpload({
            userId: userB,
            byteSize: 71,
            filename: "new.jpg",
            contentType: "image/jpeg",
          }),
        ).rejects.toMatchObject({ code: "global-quota-exceeded" });
      }
      expect(objects.has(reserved.intentId)).toBe(true);
      await sql`UPDATE upload_intents SET expires_at = now() - interval '1 minute'`;
      expect(await attachments.cleanupExpired()).toBe(1);
      expect(objects.has(reserved.intentId)).toBe(false);
      await expect(
        attachments.reserveUpload({
          userId: userA,
          byteSize: 80,
          filename: "new.jpg",
          contentType: "image/jpeg",
        }),
      ).resolves.toMatchObject({ quotaUsedBytes: 80 });

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
      await sql`UPDATE upload_intents SET expires_at = now() - interval '1 minute'
                WHERE id = ${reservation.intentId}`;
      await attachments.cleanupExpired();
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

      // An accepted duplicate's signed PUT can recreate its staging bytes.
      objects.set(copy.objectKey, bytes);
      await expect(
        attachments.reserveUpload({
          userId: userA,
          byteSize: 100 - 2 * bytes.byteLength + 1,
          filename: "another.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "quota-exceeded" });
      await expect(
        attachments.reserveUpload({
          userId: userB,
          byteSize: 150 - 2 * bytes.byteLength + 1,
          filename: "another.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "global-quota-exceeded" });

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
      objects.set(copy.objectKey, Buffer.alloc(bytes.length));
      objects.set(`verified/${copy.intentId}`, bytes);
      expect(await attachments.cleanupExpired()).toBe(0);
      await sql`UPDATE upload_intents SET expires_at = now() - interval '1 minute'`;
      expect(await attachments.cleanupExpired()).toBe(2);
      expect(objects.has(copy.objectKey)).toBe(false);
      expect(objects.has(`verified/${copy.intentId}`)).toBe(false);
      expect(objects.get(legacyIntent)).toEqual(bytes);
      const publishedKey = new URL(signed.url).pathname.slice(1);
      expect(objects.get(publishedKey)).toEqual(bytes);
      await expect(
        attachments.reserveUpload({
          userId: userA,
          byteSize: 100 - bytes.byteLength,
          filename: "after-cleanup.jpg",
          contentType: "image/jpeg",
        }),
      ).resolves.toMatchObject({ quotaUsedBytes: 100 });
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
  test("orphan cleanup preserves recent reuse/history and releases quota only after confirmed deletion", async () => {
    await withPostgresSchema("attachment_orphan", async ({ sql }) => {
      const { PostgresAttachmentRepository } = await import(
        "@/lib/attachments/postgres"
      );
      const owner = crypto.randomUUID();
      await sql`INSERT INTO contribution_users (id, status, public_display_name) VALUES (${owner}, 'active', 'Uploader')`;
      const bytes = jpegBytes();
      const digest = createHash("sha256").update(bytes).digest("hex");
      const files = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const [orphanId, reusedId, historicalId] = files;
      const objects = new Map<string, Uint8Array>(
        files.map((id) => [`verified/${id}`, bytes]),
      );
      for (const [index, id] of files.entries()) {
        await sql`
          INSERT INTO stored_files (id, owner_user_id, object_key, byte_size, sha256, detected_mime, last_upload_completed_at)
          VALUES (${id}, ${owner}, ${`verified/${id}`}, ${bytes.length}, ${index === 1 ? digest : String(index).repeat(64)}, 'image/jpeg', now() - interval '2 days')
        `;
      }
      const review = crypto.randomUUID();
      const revision = crypto.randomUUID();
      await sql`SELECT publish_review(${review}, ${revision}, ${owner}, 'COMP', '2000', NULL, NULL, NULL, 'Historical Review', 'attributed', 'test-v1')`;
      await sql`INSERT INTO attachments (id, revision_id, stored_file_id, public_filename, description) VALUES (${crypto.randomUUID()}, ${revision}, ${historicalId}, 'past.jpg', 'Historical file')`;
      await sql`SELECT withdraw_review(${review}, ${revision}, ${owner})`;
      const repository = new PostgresAttachmentRepository(sql, {
        userQuota: 200,
        globalQuota: 1000,
      });
      let deletionConfirmed = false;
      const attachments = createAttachmentService(repository, {
        async presignPut({ key }) {
          return { url: `https://space.test/${key}`, headers: {} };
        },
        async presignGet({ key }) {
          return { url: `https://space.test/${key}` };
        },
        async head(key) {
          const value = objects.get(key);
          return value
            ? { contentLength: value.length, contentType: "image/jpeg" }
            : undefined;
        },
        async get(key) {
          return objects.get(key);
        },
        async put(key, value) {
          objects.set(key, value);
        },
        async delete(key) {
          if (key !== `verified/${orphanId}` || deletionConfirmed)
            objects.delete(key);
        },
        async exists(key) {
          return objects.has(key);
        },
      });
      const upload = await attachments.reserveUpload({
        userId: owner,
        byteSize: bytes.length,
        filename: "reuse.jpg",
        contentType: "image/jpeg",
      });
      objects.set(upload.objectKey, bytes);
      expect(
        await attachments.completeUpload({
          userId: owner,
          intentId: upload.intentId,
        }),
      ).toMatchObject({ id: reusedId, reused: true });
      await sql`UPDATE upload_intents SET expires_at = now() - interval '1 minute'`;
      await attachments.cleanupExpired();
      expect(
        await repository.findStoredFile(owner, "0".repeat(64)),
      ).toBeUndefined();
      const [queued] =
        await sql`SELECT removal_requested_at, removed_at FROM stored_files WHERE id = ${orphanId}`;
      expect(queued.removal_requested_at).not.toBeNull();
      expect(queued.removed_at).toBeNull();
      const lateUpload = await attachments.reserveUpload({
        userId: owner,
        byteSize: bytes.length,
        filename: "late.jpg",
        contentType: "image/jpeg",
      });
      await repository.beginValidation(lateUpload.intentId);
      await expect(
        repository.accept({
          intentId: lateUpload.intentId,
          reused: true,
          storedFile: {
            id: orphanId,
            ownerUserId: owner,
            objectKey: `verified/${orphanId}`,
            byteSize: bytes.length,
            sha256: "0".repeat(64),
            detectedMime: "image/jpeg",
          },
        }),
      ).rejects.toMatchObject({ code: "validation-failed" });
      await sql`UPDATE upload_intents SET state = 'rejected', expires_at = now() - interval '1 minute' WHERE id = ${lateUpload.intentId}`;
      await expect(
        attachments.reserveUpload({
          userId: owner,
          byteSize: 100,
          filename: "next.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "quota-exceeded" });
      await expect(
        repository.attachToRevision({
          userId: owner,
          revisionId: revision,
          attachments: [
            {
              id: crypto.randomUUID(),
              storedFileId: orphanId,
              filename: "old.jpg",
              description: "Too late",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "invalid-attachment" });
      deletionConfirmed = true;
      expect(await attachments.cleanupExpired()).toBe(2);
      const retained =
        await sql`SELECT id, removed_at FROM stored_files ORDER BY id`;
      expect(
        retained.find((row) => row.id === orphanId)?.removed_at,
      ).not.toBeNull();
      expect(
        retained.find((row) => row.id === reusedId)?.removed_at,
      ).toBeNull();
      expect(
        retained.find((row) => row.id === historicalId)?.removed_at,
      ).toBeNull();
      expect(objects.has(`verified/${orphanId}`)).toBe(false);
      expect(objects.has(`verified/${reusedId}`)).toBe(true);
      expect(objects.has(`verified/${historicalId}`)).toBe(true);
      await expect(
        attachments.reserveUpload({
          userId: owner,
          byteSize: 100,
          filename: "next.jpg",
          contentType: "image/jpeg",
        }),
      ).resolves.toMatchObject({ quotaUsedBytes: 2 * bytes.length + 100 });
    });
  });

  test("Attachment insertion wins its Stored File lock before orphan cleanup", async () => {
    await withPostgresSchema(
      "attachment_cleanup_race",
      async ({ sql, connect }) => {
        const { PostgresAttachmentRepository } = await import(
          "@/lib/attachments/postgres"
        );
        const owner = crypto.randomUUID();
        const file = crypto.randomUUID();
        const review = crypto.randomUUID();
        const revision = crypto.randomUUID();
        await sql`INSERT INTO contribution_users (id, status, public_display_name) VALUES (${owner}, 'active', 'Uploader')`;
        await sql`INSERT INTO stored_files (id, owner_user_id, object_key, byte_size, sha256, detected_mime, last_upload_completed_at) VALUES (${file}, ${owner}, ${`verified/${file}`}, 46, ${"a".repeat(64)}, 'image/jpeg', now() - interval '2 days')`;
        await sql`SELECT publish_review(${review}, ${revision}, ${owner}, 'COMP', '2000', NULL, NULL, NULL, 'Review', 'attributed', 'test-v1')`;
        let inserted!: () => void;
        const ready = new Promise<void>((resolve) => {
          inserted = resolve;
        });
        let commit!: () => void;
        const release = new Promise<void>((resolve) => {
          commit = resolve;
        });
        const writing = connect(1).begin(async (transaction) => {
          await transaction`INSERT INTO attachments (id, revision_id, stored_file_id, public_filename, description) VALUES (${crypto.randomUUID()}, ${revision}, ${file}, 'photo.jpg', 'Accepted attachment')`;
          inserted();
          await release;
        });
        await ready;
        const repository = new PostgresAttachmentRepository(sql);
        try {
          await repository.queueOrphanedFiles(new Date());
          expect(await repository.listRemovalQueue()).toEqual([]);
        } finally {
          commit();
        }
        await writing;
        await repository.queueOrphanedFiles(new Date());
        expect(await repository.listRemovalQueue()).toEqual([]);
        expect(
          await sql`SELECT id FROM attachments WHERE stored_file_id = ${file}`,
        ).toHaveLength(1);
      },
    );
  });
}
