import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type AttachmentRecord,
  type AttachmentRepository,
  type AttachmentStore,
  attachmentPutCors,
  authorizedInlineImage,
  createAttachmentService,
  GET_EXPIRES_SECONDS,
  GLOBAL_QUOTA_BYTES,
  type ImageAttachment,
  MAX_REVISION_ATTACHMENTS,
  PUT_EXPIRES_SECONDS,
  type StoredFileRecord,
  type UploadIntentRecord,
  USER_QUOTA_BYTES,
} from "@/lib/attachments/attachments";
import {
  GIF_1x1,
  heicBytes,
  jpegBytes,
  PNG_1x1,
  webpBytes,
} from "./attachment-fixtures";

const USER_ID = "00000000-0000-4000-8000-000000000048";
const OTHER_USER = "00000000-0000-4000-8000-000000000049";
const INTENT_ID = "00000000-0000-4000-8000-000000000148";
const FILE_ID = "00000000-0000-4000-8000-000000000248";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000348";
const REVISION_ID = "00000000-0000-4000-8000-000000000448";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function memory() {
  const users = new Map<string, string>([[USER_ID, "active"]]);
  const intents = new Map<string, UploadIntentRecord>();
  const files = new Map<string, StoredFileRecord>();
  const attachments = new Map<string, AttachmentRecord>();
  const publicRevisions = new Set<string>([REVISION_ID]);
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const puts: Array<{ key: string; expiresSeconds: number }> = [];
  const gets: Array<{
    key: string;
    expiresSeconds: number;
    contentType: string;
  }> = [];
  let now = new Date("2026-04-01T00:00:00.000Z");
  let uuidIndex = 0;
  const ids = [INTENT_ID, FILE_ID, ATTACHMENT_ID];
  const store: AttachmentStore = {
    async presignPut({ key, contentType, contentLength, expiresSeconds }) {
      puts.push({ key, expiresSeconds });
      return {
        url: `https://spaces.example/${key}?put=1`,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(contentLength),
        },
      };
    },
    async presignGet({ key, contentType, expiresSeconds }) {
      gets.push({ key, expiresSeconds, contentType });
      return { url: `https://cdn-free.example/${key}?get=1` };
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? {
            contentLength: object.bytes.byteLength,
            contentType: object.contentType,
          }
        : undefined;
    },
    async get(key) {
      return objects.get(key)?.bytes;
    },
    async delete(key) {
      objects.delete(key);
    },
    async exists(key) {
      return objects.has(key);
    },
  };
  function quota(userId?: string) {
    let stored = 0;
    let pending = 0;
    for (const file of files.values()) {
      if (!userId || file.ownerUserId === userId) stored += file.byteSize;
    }
    for (const intent of intents.values()) {
      if (
        intent.storedFileId ||
        !["reserved", "uploaded", "validating"].includes(intent.state)
      )
        continue;
      if (!userId || intent.ownerUserId === userId)
        pending += intent.declaredByteSize;
    }
    return stored + pending;
  }
  const repository: AttachmentRepository = {
    async reserve(input) {
      const status = users.get(input.userId);
      if (!status)
        throw Object.assign(new Error("account-not-found"), {
          code: "account-not-found",
        });
      if (status !== "active")
        throw Object.assign(
          new Error(
            status === "onboarding"
              ? "onboarding-required"
              : `account-${status}`,
          ),
          {
            code:
              status === "onboarding"
                ? "onboarding-required"
                : status === "suspended"
                  ? "account-suspended"
                  : "account-closed",
          },
        );
      if (quota(input.userId) + input.declaredByteSize > USER_QUOTA_BYTES)
        throw Object.assign(new Error("quota-exceeded"), {
          code: "quota-exceeded",
        });
      if (quota() + input.declaredByteSize > GLOBAL_QUOTA_BYTES)
        throw Object.assign(new Error("global-quota-exceeded"), {
          code: "global-quota-exceeded",
        });
      intents.set(input.intentId, {
        id: input.intentId,
        ownerUserId: input.userId,
        objectKey: input.objectKey,
        declaredByteSize: input.declaredByteSize,
        declaredExtension: input.declaredExtension,
        declaredMime: input.declaredMime,
        state: "reserved",
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return { quotaUsedBytes: quota(input.userId) };
    },
    async getIntent(intentId) {
      return intents.get(intentId);
    },
    async markRejected(intentId, state) {
      const intent = intents.get(intentId);
      if (intent) {
        intent.state = state;
        intent.updatedAt = now;
      }
    },
    async beginValidation(intentId) {
      const intent = intents.get(intentId);
      if (
        !intent ||
        !["reserved", "uploaded"].includes(intent.state) ||
        intent.expiresAt.getTime() <= now.getTime()
      )
        throw Object.assign(new Error("upload-not-found"), {
          code: "upload-not-found",
        });
      intent.state = "validating";
      intent.updatedAt = now;
      return { ...intent };
    },
    async accept({ intentId, storedFile, reused }) {
      if (!reused) files.set(storedFile.id, storedFile);
      const intent = intents.get(intentId);
      if (intent) {
        intent.state = "accepted";
        intent.storedFileId = storedFile.id;
        intent.updatedAt = now;
      }
      return files.get(storedFile.id) ?? storedFile;
    },
    async findStoredFile(userId, digest) {
      return [...files.values()].find(
        (file) => file.ownerUserId === userId && file.sha256 === digest,
      );
    },
    async attachToRevision({ userId, revisionId, attachments: drafts }) {
      if (drafts.length > MAX_REVISION_ATTACHMENTS)
        throw Object.assign(new Error("too-many-attachments"), {
          code: "too-many-attachments",
        });
      const created: ImageAttachment[] = [];
      for (const draft of drafts) {
        const file = files.get(draft.storedFileId);
        if (!file || file.ownerUserId !== userId)
          throw Object.assign(new Error("invalid-attachment"), {
            code: "invalid-attachment",
          });
        const record = {
          id: draft.id,
          revisionId,
          storedFileId: file.id,
          filename: draft.filename,
          description: draft.description,
          mime: file.detectedMime,
        };
        attachments.set(record.id, record);
        created.push({
          id: record.id,
          storedFileId: record.storedFileId,
          filename: record.filename,
          description: record.description,
          mime: record.mime,
        });
      }
      return created;
    },
    async findPublicAttachment(attachmentId) {
      const attachment = attachments.get(attachmentId);
      if (!attachment || !publicRevisions.has(attachment.revisionId))
        return undefined;
      const file = files.get(attachment.storedFileId);
      if (!file) return undefined;
      return { attachment, objectKey: file.objectKey };
    },
    async listCleanupIntents(when) {
      return [...intents.values()].filter(
        (intent) =>
          ["rejected", "validation_error"].includes(intent.state) ||
          (!intent.storedFileId &&
            intent.expiresAt.getTime() <= when.getTime()),
      );
    },
    async deleteIntent(intentId) {
      intents.delete(intentId);
    },
  };
  const attachmentsService = createAttachmentService(repository, store, {
    now: () => now,
    randomUUID: () => ids[uuidIndex++] ?? crypto.randomUUID(),
  });
  return {
    attachments: attachmentsService,
    users,
    objects,
    puts,
    gets,
    files,
    intents,
    setNow(value: Date) {
      now = value;
    },
    hideRevision() {
      publicRevisions.delete(REVISION_ID);
    },
  };
}

async function accept(
  world: ReturnType<typeof memory>,
  bytes: Uint8Array,
  filename = "photo.jpg",
  mime = "image/jpeg",
) {
  const reservation = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: bytes.byteLength,
    filename,
    contentType: mime,
  });
  world.objects.set(reservation.objectKey, { bytes, contentType: mime });
  return world.attachments.completeUpload({
    userId: USER_ID,
    intentId: reservation.intentId,
  });
}

test("an active User reserves opaque bytes and receives a 15-minute private PUT", async () => {
  const world = memory();
  const reservation = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: jpegBytes().byteLength,
    filename: "Course notes.JPG",
    contentType: "image/jpeg",
  });
  expect(reservation.intentId).toBe(INTENT_ID);
  expect(reservation.objectKey).toBe(INTENT_ID);
  expect(reservation.objectKey).not.toContain(USER_ID);
  expect(reservation.objectKey.toLowerCase()).not.toContain("course");
  expect(reservation.objectKey).not.toContain("notes");
  expect(reservation.uploadUrl).toContain(reservation.objectKey);
  expect(reservation.expiresAt.toISOString()).toBe("2026-04-01T00:15:00.000Z");
  expect(world.puts).toEqual([
    { key: INTENT_ID, expiresSeconds: PUT_EXPIRES_SECONDS },
  ]);
  expect(reservation.quotaUsedBytes).toBe(jpegBytes().byteLength);
  expect(attachmentPutCors("https://rankings.example")).toEqual({
    allowedOrigins: ["https://rankings.example"],
    allowedMethods: ["PUT", "HEAD"],
    allowedHeaders: ["Content-Type", "Content-Length"],
    exposeHeaders: ["ETag"],
    allowCredentials: false,
    maxAgeSeconds: PUT_EXPIRES_SECONDS,
  });
});

test("pending reservations count toward the 32 MiB User quota and 128 GiB global cap", async () => {
  const world = memory();
  await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: USER_QUOTA_BYTES,
    filename: "full.jpg",
    contentType: "image/jpeg",
  });
  await expect(
    world.attachments.reserveUpload({
      userId: USER_ID,
      byteSize: 1,
      filename: "overflow.jpg",
      contentType: "image/jpeg",
    }),
  ).rejects.toMatchObject({ code: "quota-exceeded" });
  world.users.set(OTHER_USER, "active");
  world.intents.clear();
  const giant = {
    id: crypto.randomUUID(),
    ownerUserId: USER_ID,
    objectKey: crypto.randomUUID(),
    declaredByteSize: GLOBAL_QUOTA_BYTES,
    declaredExtension: "jpg",
    declaredMime: "image/jpeg",
    state: "reserved" as const,
    expiresAt: new Date("2026-04-01T00:15:00.000Z"),
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  };
  world.intents.set(giant.id, giant);
  await expect(
    world.attachments.reserveUpload({
      userId: OTHER_USER,
      byteSize: 1,
      filename: "overflow.jpg",
      contentType: "image/jpeg",
    }),
  ).rejects.toMatchObject({ code: "global-quota-exceeded" });
});

test("complete upload preserves exact bytes after ownership, size, and raster checks", async () => {
  const world = memory();
  const bytes = jpegBytes();
  const accepted = await accept(world, bytes);
  expect(accepted).toEqual({
    id: FILE_ID,
    sha256: sha256(bytes),
    byteSize: bytes.byteLength,
    mime: "image/jpeg",
    reused: false,
  });
  expect(world.files.get(FILE_ID)?.objectKey).toBe(INTENT_ID);
  expect(Buffer.from(world.objects.get(INTENT_ID)?.bytes ?? [])).toEqual(bytes);
});

test("HEAD mismatch, expiry, and failed raster validation keep uploads private", async () => {
  const world = memory();
  const bytes = jpegBytes();
  const reservation = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: bytes.byteLength,
    filename: "photo.jpg",
    contentType: "image/jpeg",
  });
  await expect(
    world.attachments.completeUpload({
      userId: USER_ID,
      intentId: reservation.intentId,
    }),
  ).rejects.toMatchObject({ code: "size-mismatch" });
  world.objects.set(reservation.objectKey, {
    bytes: Buffer.concat([bytes, Buffer.from("x")]),
    contentType: "image/jpeg",
  });
  await expect(
    world.attachments.completeUpload({
      userId: USER_ID,
      intentId: reservation.intentId,
    }),
  ).rejects.toMatchObject({ code: "size-mismatch" });
  const invalid = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: 4,
    filename: "photo.jpg",
    contentType: "image/jpeg",
  });
  world.objects.set(invalid.objectKey, {
    bytes: Buffer.from("nope"),
    contentType: "image/jpeg",
  });
  await expect(
    world.attachments.completeUpload({
      userId: USER_ID,
      intentId: invalid.intentId,
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });
  const expired = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: bytes.byteLength,
    filename: "later.jpg",
    contentType: "image/jpeg",
  });
  world.setNow(new Date("2026-04-01T00:16:00.000Z"));
  await expect(
    world.attachments.completeUpload({
      userId: USER_ID,
      intentId: expired.intentId,
    }),
  ).rejects.toMatchObject({ code: "upload-expired" });
});

test("reused Stored Files count once and every raster format can be accepted", async () => {
  const world = memory();
  const bytes = jpegBytes();
  const first = await accept(world, bytes);
  const second = await accept(world, bytes, "copy.jpeg", "image/jpeg");
  expect(second).toEqual({ ...first, reused: true });
  expect(world.files.size).toBe(1);
  expect(quotaUsed(world)).toBe(bytes.byteLength);
  const formats = [
    { bytes: PNG_1x1, filename: "dot.png", mime: "image/png" },
    { bytes: GIF_1x1, filename: "dot.gif", mime: "image/gif" },
    { bytes: webpBytes(), filename: "dot.webp", mime: "image/webp" },
    { bytes: heicBytes(), filename: "dot.heic", mime: "image/heic" },
  ] as const;
  for (const format of formats)
    expect(
      (await accept(world, format.bytes, format.filename, format.mime)).mime,
    ).toBe(format.mime);
});

function quotaUsed(world: ReturnType<typeof memory>) {
  return [...world.files.values()].reduce(
    (sum, file) => sum + file.byteSize,
    0,
  );
}

test("a Revision accepts at most four Image Attachments with normalized names", async () => {
  const world = memory();
  const stored = await accept(world, jpegBytes());
  const attached = await world.attachments.attachToRevision({
    userId: USER_ID,
    revisionId: REVISION_ID,
    attachments: [
      {
        storedFileId: stored.id,
        filename: "folder/Photo.JPG",
        description: "Lab setup",
      },
    ],
  });
  expect(attached).toEqual([
    {
      id: ATTACHMENT_ID,
      storedFileId: stored.id,
      filename: "Photo.JPG",
      description: "Lab setup",
      mime: "image/jpeg",
    },
  ]);
  await expect(
    world.attachments.attachToRevision({
      userId: USER_ID,
      revisionId: REVISION_ID,
      attachments: Array.from({ length: 5 }, () => ({
        storedFileId: stored.id,
        filename: "photo.jpg",
        description: "extra",
      })),
    }),
  ).rejects.toMatchObject({ code: "too-many-attachments" });
  expect(() =>
    world.attachments.normalizeDraft({
      storedFileId: stored.id,
      filename: "photo.jpg",
      description: "",
    }),
  ).toThrow(/description/i);
});

test("public resolver signs only accepted current Revision images", async () => {
  const world = memory();
  const stored = await accept(world, jpegBytes());
  const [attachment] = await world.attachments.attachToRevision({
    userId: USER_ID,
    revisionId: REVISION_ID,
    attachments: [
      {
        storedFileId: stored.id,
        filename: "photo.jpg",
        description: "Visible lab",
      },
    ],
  });
  const signed = await world.attachments.signPublicRead(attachment.id);
  expect(signed).toEqual({
    url: `https://cdn-free.example/${INTENT_ID}?get=1`,
    mime: "image/jpeg",
    expiresAt: new Date("2026-04-01T00:05:00.000Z"),
  });
  expect(world.gets).toEqual([
    {
      key: INTENT_ID,
      expiresSeconds: GET_EXPIRES_SECONDS,
      contentType: "image/jpeg",
    },
  ]);
  expect(
    authorizedInlineImage(`/attachments/${attachment.id}`, [attachment]),
  ).toEqual(attachment);
  expect(
    authorizedInlineImage("https://evil.example/photo.jpg", [attachment]),
  ).toBeUndefined();
  world.hideRevision();
  await expect(
    world.attachments.signPublicRead(attachment.id),
  ).rejects.toMatchObject({
    code: "attachment-not-found",
  });
});

test("rejected and expired uploads stay private and release quota after confirmed cleanup", async () => {
  const world = memory();
  const bytes = jpegBytes();
  const reservation = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: bytes.byteLength,
    filename: "photo.jpg",
    contentType: "image/jpeg",
  });
  world.objects.set(reservation.objectKey, {
    bytes: Buffer.from("nope"),
    contentType: "image/jpeg",
  });
  await world.attachments
    .completeUpload({ userId: USER_ID, intentId: reservation.intentId })
    .catch(() => {});
  expect(world.objects.has(reservation.objectKey)).toBe(true);
  const cleaned = await world.attachments.cleanupExpired();
  expect(cleaned).toBe(1);
  expect(world.objects.has(reservation.objectKey)).toBe(false);
  expect(world.intents.has(reservation.intentId)).toBe(false);
  const again = await world.attachments.reserveUpload({
    userId: USER_ID,
    byteSize: USER_QUOTA_BYTES,
    filename: "full.jpg",
    contentType: "image/jpeg",
  });
  expect(again.quotaUsedBytes).toBe(USER_QUOTA_BYTES);
});
