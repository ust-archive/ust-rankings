import { expect, test, vi } from "vitest";
import {
  type AttachmentStore,
  createAttachmentService,
} from "@/lib/attachments/attachments";
import { jpegBytes } from "./attachment-fixtures";
import { withPostgresSchema } from "./postgres-fixture";

vi.mock("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

function memoryStore() {
  const objects = new Map<string, Uint8Array>();
  const store: AttachmentStore = {
    async presignPut({ key }) {
      return { url: `https://space.test/${key}`, headers: {} };
    },
    async presignGet({ key }) {
      return { url: `https://space.test/${key}` };
    },
    async head(key) {
      const bytes = objects.get(key);
      return bytes
        ? { contentLength: bytes.length, contentType: "image/jpeg" }
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
  };
  return { store, objects };
}

if (!connection) {
  test.skip("Upload completion PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  for (const failure of ["get", "put", "accept"] as const) {
    test(`completion retries a transient ${failure} failure without abandoning the intent`, async () => {
      await withPostgresSchema("completion_retry", async ({ sql }) => {
        const { PostgresAttachmentRepository } = await import(
          "@/lib/attachments/postgres"
        );
        const repository = new PostgresAttachmentRepository(sql);
        const { store, objects } = memoryStore();
        const attachments = createAttachmentService(repository, store);
        const userId = crypto.randomUUID();
        await sql`INSERT INTO contribution_users (id, status, public_display_name)
                  VALUES (${userId}, 'active', 'Uploader')`;
        const bytes = jpegBytes();
        const reserved = await attachments.reserveUpload({
          userId,
          byteSize: bytes.length,
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });
        objects.set(reserved.objectKey, bytes);
        let restore: () => void = () => {};
        if (failure === "accept") {
          await sql.unsafe(`CREATE FUNCTION fail_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'temporary storage/database failure'; END; $$;
            CREATE TRIGGER fail_acceptance BEFORE UPDATE ON upload_intents
            FOR EACH ROW WHEN (NEW.state = 'accepted') EXECUTE FUNCTION fail_acceptance()`);
        } else if (failure === "get") {
          const spy = vi
            .spyOn(store, "get")
            .mockRejectedValueOnce(
              new Error("temporary storage/database failure"),
            );
          restore = () => spy.mockRestore();
        } else {
          const spy = vi
            .spyOn(store, "put")
            .mockImplementationOnce(async (key, candidate) => {
              objects.set(key, candidate); // Provider stored bytes but its response was lost.
              throw new Error("temporary storage/database failure");
            });
          restore = () => spy.mockRestore();
        }
        await expect(
          attachments.completeUpload({ userId, intentId: reserved.intentId }),
        ).rejects.toThrow("temporary storage/database failure");
        expect((await repository.getIntent(reserved.intentId))?.state).toBe(
          "validation_error",
        );
        expect(await sql`SELECT id FROM stored_files`).toHaveLength(0);
        if (failure === "accept")
          await sql.unsafe("DROP TRIGGER fail_acceptance ON upload_intents");
        restore();
        const accepted = await attachments.completeUpload({
          userId,
          intentId: reserved.intentId,
        });
        expect(accepted).toMatchObject({
          byteSize: bytes.length,
          reused: false,
        });
        // A lost success response can be retried after staging deletion.
        expect(
          await attachments.completeUpload({
            userId,
            intentId: reserved.intentId,
          }),
        ).toEqual(accepted);
        expect(await sql`SELECT id FROM stored_files`).toHaveLength(1);
      });
    });
  }

  test("lease takeover fences late writes, state changes, and replayed staging bytes", async () => {
    await withPostgresSchema("completion_race", async ({ sql }) => {
      const { PostgresAttachmentRepository } = await import(
        "@/lib/attachments/postgres"
      );
      const repository = new PostgresAttachmentRepository(sql);
      const { store, objects } = memoryStore();
      const attachments = createAttachmentService(repository, store);
      const userId = crypto.randomUUID();
      await sql`INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${userId}, 'active', 'Uploader')`;
      const original = jpegBytes();
      const replacement = jpegBytes();
      replacement[43] = 1;
      const reserved = await attachments.reserveUpload({
        userId,
        byteSize: original.length,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });
      objects.set(reserved.objectKey, original);
      let release!: () => void;
      let started!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const get = store.get.bind(store);
      vi.spyOn(store, "get").mockImplementationOnce(async (key) => {
        const captured = objects.get(key);
        started();
        await paused; // Deliberately model a provider finishing despite cancellation.
        return captured;
      });
      const stale = attachments.completeUpload({
        userId,
        intentId: reserved.intentId,
      });
      // Attach a rejection handler before releasing the stale worker.
      const staleResult = stale.catch((error: unknown) => error);
      await entered;
      await expect(
        attachments.completeUpload({ userId, intentId: reserved.intentId }),
      ).rejects.toMatchObject({ code: "validation-in-progress" });
      await sql`UPDATE upload_intents SET validation_lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${reserved.intentId}`;
      objects.set(reserved.objectKey, replacement);
      store.get = get;
      const winner = await attachments.completeUpload({
        userId,
        intentId: reserved.intentId,
      });
      release();
      expect(await staleResult).toMatchObject({
        code: "validation-lease-lost",
      });
      expect((await repository.getIntent(reserved.intentId))?.state).toBe(
        "accepted",
      );
      const files = await sql<
        { objectKey: string }[]
      >`SELECT object_key AS "objectKey" FROM stored_files`;
      expect(files).toHaveLength(1);
      expect(objects.get(files[0].objectKey)).toEqual(replacement);
      expect(
        [...objects.keys()].filter((key) => key.startsWith("verified/")),
      ).toHaveLength(2);
      expect(
        await attachments.completeUpload({
          userId,
          intentId: reserved.intentId,
        }),
      ).toEqual(winner);
      await sql`UPDATE upload_intents SET expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${reserved.intentId}`;
      expect(await attachments.cleanupExpired()).toBe(0);
      await sql`UPDATE upload_intents SET updated_at = clock_timestamp() - interval '25 hours'
        WHERE id = ${reserved.intentId}`;
      expect(await attachments.cleanupExpired()).toBe(1);
      expect([...objects.keys()]).toEqual([files[0].objectKey]);
    });
  });

  test("failed candidate keeps its full cleanup grace after retry deduplicates to another accepted file", async () => {
    await withPostgresSchema("completion_dedup_grace", async ({ sql }) => {
      const { PostgresAttachmentRepository } = await import(
        "@/lib/attachments/postgres"
      );
      const repository = new PostgresAttachmentRepository(sql);
      const { store, objects } = memoryStore();
      const attachments = createAttachmentService(repository, store);
      const userId = crypto.randomUUID();
      await sql`INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${userId}, 'active', 'Uploader')`;
      const bytes = jpegBytes();
      const first = await attachments.reserveUpload({
        userId,
        byteSize: bytes.length,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });
      objects.set(first.objectKey, bytes);
      const put = vi
        .spyOn(store, "put")
        .mockImplementationOnce(async (key, candidate) => {
          objects.set(key, candidate);
          throw new Error("lost PUT response");
        });
      await expect(
        attachments.completeUpload({ userId, intentId: first.intentId }),
      ).rejects.toThrow("lost PUT response");
      put.mockRestore();
      // A separate completion now accepts the same bytes while the failed
      // attempt's private candidate remains eligible for a late provider write.
      const other = await attachments.reserveUpload({
        userId,
        byteSize: bytes.length,
        filename: "copy.jpg",
        contentType: "image/jpeg",
      });
      objects.set(other.objectKey, bytes);
      const stored = await attachments.completeUpload({
        userId,
        intentId: other.intentId,
      });
      const reused = await attachments.completeUpload({
        userId,
        intentId: first.intentId,
      });
      expect(reused).toMatchObject({ id: stored.id, reused: true });
      const [intent] = await sql<{ keys: string[]; attempts: number }[]>`
        SELECT validation_keys AS keys, validation_attempts AS attempts
        FROM upload_intents WHERE id = ${first.intentId}`;
      expect(intent.attempts).toBe(2);
      expect(intent.keys).toHaveLength(1); // The retry never PUT its own candidate.
      const failedKey = intent.keys[0];
      expect(objects.get(failedKey)).toEqual(bytes);
      await sql`UPDATE upload_intents SET expires_at = clock_timestamp() - interval '1 second',
        updated_at = clock_timestamp() - interval '23 hours' WHERE id = ${first.intentId}`;
      expect(await attachments.cleanupExpired()).toBe(0);
      expect(await repository.getIntent(first.intentId)).toBeDefined();
      expect(objects.get(failedKey)).toEqual(bytes);
      expect((await repository.getAccepted(first.intentId))?.id).toBe(
        stored.id,
      );
      const capped = createAttachmentService(
        new PostgresAttachmentRepository(sql, {
          userQuota: 1000,
          globalQuota: bytes.length * 4,
        }),
        store,
      );
      await expect(
        capped.reserveUpload({
          userId,
          byteSize: 1,
          filename: "more.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "global-quota-exceeded" });
      await sql`UPDATE upload_intents SET updated_at = clock_timestamp() - interval '25 hours'
        WHERE id = ${first.intentId}`;
      expect(await attachments.cleanupExpired()).toBe(1);
      expect(await repository.getIntent(first.intentId)).toBeUndefined();
      expect(objects.has(failedKey)).toBe(false);
      const [retained] = await sql<
        { key: string }[]
      >`SELECT object_key AS key FROM stored_files WHERE id = ${stored.id}`;
      expect(objects.get(retained.key)).toEqual(bytes);
      await expect(
        capped.reserveUpload({
          userId,
          byteSize: 1,
          filename: "more.jpg",
          contentType: "image/jpeg",
        }),
      ).resolves.toBeDefined();
    });
  });

  test("retry count and physical reservation cap remain bounded until confirmed cleanup", async () => {
    await withPostgresSchema("completion_limits", async ({ sql }) => {
      const { PostgresAttachmentRepository } = await import(
        "@/lib/attachments/postgres"
      );
      const bytes = jpegBytes();
      const repository = new PostgresAttachmentRepository(sql, {
        userQuota: 100,
        globalQuota: bytes.length * 2,
      });
      const { store, objects } = memoryStore();
      const attachments = createAttachmentService(repository, store);
      const userId = crypto.randomUUID();
      await sql`INSERT INTO contribution_users (id, status, public_display_name)
        VALUES (${userId}, 'active', 'Uploader')`;
      const reserved = await attachments.reserveUpload({
        userId,
        byteSize: bytes.length,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });
      objects.set(reserved.objectKey, bytes);
      const first = await repository.beginValidation(reserved.intentId);
      objects.set(first.validationObjectKey, bytes);
      await repository.markRejected(
        reserved.intentId,
        "validation_error",
        first.validationLeaseId,
      );
      await expect(
        repository.beginValidation(reserved.intentId),
      ).rejects.toMatchObject({ code: "global-quota-exceeded" });
      await expect(
        attachments.reserveUpload({
          userId,
          byteSize: 1,
          filename: "more.jpg",
          contentType: "image/jpeg",
        }),
      ).rejects.toMatchObject({ code: "global-quota-exceeded" });
      const unbounded = new PostgresAttachmentRepository(sql);
      for (let attempt = 2; attempt <= 3; attempt++) {
        const lease = await unbounded.beginValidation(reserved.intentId);
        await unbounded.markRejected(
          reserved.intentId,
          "validation_error",
          lease.validationLeaseId,
        );
      }
      await expect(
        unbounded.beginValidation(reserved.intentId),
      ).rejects.toMatchObject({ code: "validation-retry-exhausted" });
      await sql`UPDATE upload_intents SET expires_at = clock_timestamp() - interval '1 second',
        updated_at = clock_timestamp() - interval '25 hours' WHERE id = ${reserved.intentId}`;
      const remove = store.delete.bind(store);
      store.delete = async () => {};
      expect(await attachments.cleanupExpired()).toBe(0);
      expect(await repository.getIntent(reserved.intentId)).toBeDefined();
      store.delete = remove;
      expect(await attachments.cleanupExpired()).toBe(1);
      expect(objects.size).toBe(0);
      await expect(
        attachments.reserveUpload({
          userId,
          byteSize: bytes.length,
          filename: "again.jpg",
          contentType: "image/jpeg",
        }),
      ).resolves.toBeDefined();
    });
  });
}
