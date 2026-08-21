import { createHash } from "node:crypto";
import type { AttachmentKind } from "./validation";

export const USER_QUOTA_BYTES = 32 * 1024 * 1024;
export const GLOBAL_QUOTA_BYTES = 128 * 1024 * 1024 * 1024;
export const USAGE_ALERT_BYTES = Math.floor(GLOBAL_QUOTA_BYTES * 0.8);
export const PUT_EXPIRES_SECONDS = 15 * 60;
export const GET_EXPIRES_SECONDS = 5 * 60;
export const MAX_REVISION_ATTACHMENTS = 4;
export const MAX_FILENAME_GRAPHEMES = 100;
export const MAX_DESCRIPTION_GRAPHEMES = 300;

export type { AttachmentKind };

export type ImageAttachment = {
  id: string;
  storedFileId: string;
  filename: string;
  description: string;
  mime: string;
  kind: AttachmentKind;
  available: boolean;
};

export type AttachmentDraft = {
  storedFileId: string;
  filename: string;
  description: string;
};

export type UploadIntentState =
  | "reserved"
  | "uploaded"
  | "validating"
  | "accepted"
  | "rejected"
  | "validation_error";

export type UploadIntentRecord = {
  id: string;
  ownerUserId: string;
  objectKey: string;
  declaredByteSize: number;
  declaredExtension: string;
  declaredMime: string;
  state: UploadIntentState;
  storedFileId?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredFileRecord = {
  id: string;
  ownerUserId: string;
  objectKey: string;
  byteSize: number;
  sha256: string;
  detectedMime: string;
};

export type AttachmentRecord = ImageAttachment & { revisionId: string };

export interface AttachmentStore {
  presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(input: {
    key: string;
    contentType: string;
    expiresSeconds: number;
    contentDisposition?: string;
  }): Promise<{ url: string }>;
  head(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string } | undefined>;
  get(key: string, maxBytes: number): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface AttachmentRepository {
  reserve(input: {
    userId: string;
    intentId: string;
    objectKey: string;
    declaredByteSize: number;
    declaredExtension: string;
    declaredMime: string;
    expiresAt: Date;
  }): Promise<{ quotaUsedBytes: number; globalUsedBytes: number }>;
  getIntent(intentId: string): Promise<UploadIntentRecord | undefined>;
  markRejected(
    intentId: string,
    state: "rejected" | "validation_error",
  ): Promise<void>;
  beginValidation(intentId: string): Promise<UploadIntentRecord>;
  findStoredFile(
    userId: string,
    sha256: string,
  ): Promise<StoredFileRecord | undefined>;
  accept(input: {
    intentId: string;
    storedFile: StoredFileRecord;
    reused: boolean;
  }): Promise<StoredFileRecord>;
  attachToRevision(input: {
    userId: string;
    revisionId: string;
    attachments: Array<{
      id: string;
      storedFileId: string;
      filename: string;
      description: string;
    }>;
  }): Promise<ImageAttachment[]>;
  findPublicAttachment(attachmentId: string): Promise<
    | {
        attachment: ImageAttachment;
        objectKey?: string;
      }
    | undefined
  >;
  listCleanupIntents(now: Date): Promise<UploadIntentRecord[]>;
  deleteIntent(intentId: string): Promise<void>;
  requestRemoval(storedFileId: string): Promise<StoredFileRecord>;
  listRemovalQueue(): Promise<StoredFileRecord[]>;
  markRemoved(storedFileId: string): Promise<void>;
}

export type AttachmentWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "cross-origin"
  | "quota-exceeded"
  | "global-quota-exceeded"
  | "invalid-upload"
  | "upload-not-found"
  | "upload-expired"
  | "size-mismatch"
  | "validation-failed"
  | "too-many-attachments"
  | "invalid-attachment"
  | "attachment-not-found"
  | "attachment-unavailable"
  | "uploads-disabled";

export class AttachmentWriteError extends Error {
  constructor(
    public readonly code: AttachmentWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentWriteError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
const INVISIBLE_OR_CONTROL = /\p{C}/u;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/u;
const ATTACHMENT_SRC =
  /^\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

const DECLARATIONS: Record<string, { mime: string; kind: AttachmentKind }> = {
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  heic: { mime: "image/heic", kind: "image" },
  heif: { mime: "image/heif", kind: "image" },
  pdf: { mime: "application/pdf", kind: "document" },
  txt: { mime: "text/plain", kind: "document" },
  md: { mime: "text/markdown", kind: "document" },
  csv: { mime: "text/csv", kind: "document" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
  },
  odt: { mime: "application/vnd.oasis.opendocument.text", kind: "document" },
  ods: {
    mime: "application/vnd.oasis.opendocument.spreadsheet",
    kind: "document",
  },
  odp: {
    mime: "application/vnd.oasis.opendocument.presentation",
    kind: "document",
  },
};

export function attachmentKind(mime: string): AttachmentKind {
  return mime.startsWith("image/") ? "image" : "document";
}

export function contentTypeForFilename(filename: string) {
  return DECLARATIONS[extensionOf(filename)]?.mime;
}

export function attachmentPutCors(origin: string) {
  return {
    allowedOrigins: [origin],
    allowedMethods: ["PUT", "HEAD"],
    allowedHeaders: ["Content-Type", "Content-Length"],
    exposeHeaders: ["ETag"],
    allowCredentials: false,
    maxAgeSeconds: PUT_EXPIRES_SECONDS,
  };
}

export function authorizedInlineImage(
  src: string | undefined,
  attachments: Array<{
    id: string;
    description: string;
    kind?: AttachmentKind;
    available?: boolean;
    mime?: string;
  }>,
) {
  if (typeof src !== "string") return undefined;
  const match = ATTACHMENT_SRC.exec(src);
  const id = match?.[1]?.toLowerCase();
  if (!id) return undefined;
  const attachment = attachments.find(
    (candidate) => candidate.id.toLowerCase() === id,
  );
  if (!attachment || attachment.available === false) return undefined;
  if (attachment.kind === "document") return undefined;
  if (attachment.mime && !attachment.mime.startsWith("image/"))
    return undefined;
  return attachment;
}

export function contentDisposition(
  type: "inline" | "attachment",
  filename: string,
) {
  const fallback = filename
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\]/gu, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function graphemeCount(value: string) {
  return [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      value,
    ),
  ].length;
}

function extensionOf(filename: string) {
  const base = filename.split(/[/\\]/u).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function normalizeAttachmentFilename(input: string) {
  if (typeof input !== "string" || LINE_BREAK.test(input) || BIDI.test(input))
    throw new AttachmentWriteError(
      "invalid-attachment",
      "Attachment filename is malformed",
    );
  const filename = (input.split(/[/\\]/u).pop() ?? "").normalize("NFC");
  if (
    !filename ||
    /[/\\]/u.test(filename) ||
    INVISIBLE_OR_CONTROL.test(filename) ||
    !DECLARATIONS[extensionOf(filename)] ||
    graphemeCount(filename) > MAX_FILENAME_GRAPHEMES
  )
    throw new AttachmentWriteError(
      "invalid-attachment",
      "Attachment filename is malformed",
    );
  return filename;
}

export function normalizeAttachmentDescription(input: string) {
  if (typeof input !== "string" || LINE_BREAK.test(input) || BIDI.test(input))
    throw new AttachmentWriteError(
      "invalid-attachment",
      "Attachment description is malformed",
    );
  const description = input.normalize("NFC").trim();
  const length = graphemeCount(description);
  if (
    !description ||
    INVISIBLE_OR_CONTROL.test(description) ||
    length < 1 ||
    length > MAX_DESCRIPTION_GRAPHEMES
  )
    throw new AttachmentWriteError(
      "invalid-attachment",
      "Attachment description is malformed",
    );
  return description;
}

function declaredFormat(filename: string, contentType: string) {
  const extension = extensionOf(filename);
  const declared = DECLARATIONS[extension];
  if (!declared || declared.mime !== contentType)
    throw new AttachmentWriteError(
      "invalid-upload",
      "Only approved image and document formats are accepted",
    );
  return {
    extension: extension === "jpeg" ? "jpg" : extension,
    mime: declared.mime,
  };
}

function wrap(error: unknown): never {
  if (error instanceof AttachmentWriteError) throw error;
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code: string }).code;
    const allowed: AttachmentWriteErrorCode[] = [
      "account-not-found",
      "onboarding-required",
      "account-suspended",
      "account-closed",
      "quota-exceeded",
      "global-quota-exceeded",
      "upload-not-found",
      "upload-expired",
      "too-many-attachments",
      "invalid-attachment",
      "uploads-disabled",
      "attachment-unavailable",
    ];
    if (allowed.includes(code as AttachmentWriteErrorCode))
      throw new AttachmentWriteError(
        code as AttachmentWriteErrorCode,
        String((error as { message?: unknown }).message ?? code),
      );
  }
  throw error;
}

export function createAttachmentService(
  repository: AttachmentRepository,
  store: AttachmentStore,
  options?: {
    now?: () => Date;
    randomUUID?: () => string;
    uploadsDisabled?: boolean;
    alert?: (event: { type: "usage"; globalUsedBytes: number }) => void;
  },
) {
  const now = options?.now ?? (() => new Date());
  const randomUUID = options?.randomUUID ?? crypto.randomUUID.bind(crypto);
  const uploadsDisabled =
    options?.uploadsDisabled ??
    process.env.ATTACHMENTS_UPLOADS_DISABLED === "1";
  const alert =
    options?.alert ??
    ((event) => {
      console.warn(
        JSON.stringify({
          type: "attachment-usage-alert",
          globalUsedBytes: event.globalUsedBytes,
          cap: GLOBAL_QUOTA_BYTES,
        }),
      );
    });

  return {
    normalizeDraft(input: AttachmentDraft): AttachmentDraft {
      if (!UUID.test(input.storedFileId))
        throw new AttachmentWriteError(
          "invalid-attachment",
          "Stored File is malformed",
        );
      return {
        storedFileId: input.storedFileId.toLowerCase(),
        filename: normalizeAttachmentFilename(input.filename),
        description: normalizeAttachmentDescription(input.description),
      };
    },

    async reserveUpload(input: {
      userId: string;
      byteSize: number;
      filename: string;
      contentType: string;
    }) {
      if (uploadsDisabled)
        throw new AttachmentWriteError(
          "uploads-disabled",
          "New Attachment uploads are disabled",
        );
      if (!UUID.test(input.userId))
        throw new AttachmentWriteError(
          "account-not-found",
          "User was not found",
        );
      const filename = normalizeAttachmentFilename(input.filename);
      const declared = declaredFormat(filename, input.contentType);
      if (
        !Number.isInteger(input.byteSize) ||
        input.byteSize < 1 ||
        input.byteSize > USER_QUOTA_BYTES
      )
        throw new AttachmentWriteError(
          "invalid-upload",
          "Declared size is outside the 32 MiB Stored File limit",
        );
      const intentId = randomUUID();
      const expiresAt = new Date(now().getTime() + PUT_EXPIRES_SECONDS * 1000);
      try {
        const reserved = await repository.reserve({
          userId: input.userId,
          intentId,
          objectKey: intentId,
          declaredByteSize: input.byteSize,
          declaredExtension: declared.extension,
          declaredMime: declared.mime,
          expiresAt,
        });
        if (reserved.globalUsedBytes >= USAGE_ALERT_BYTES)
          alert({
            type: "usage",
            globalUsedBytes: reserved.globalUsedBytes,
          });
        const upload = await store.presignPut({
          key: intentId,
          contentType: declared.mime,
          contentLength: input.byteSize,
          expiresSeconds: PUT_EXPIRES_SECONDS,
        });
        return {
          intentId,
          objectKey: intentId,
          uploadUrl: upload.url,
          uploadHeaders: upload.headers,
          expiresAt,
          reservedBytes: input.byteSize,
          quotaUsedBytes: reserved.quotaUsedBytes,
        };
      } catch (error) {
        wrap(error);
      }
    },

    async completeUpload(input: { userId: string; intentId: string }) {
      if (!UUID.test(input.userId) || !UUID.test(input.intentId))
        throw new AttachmentWriteError(
          "upload-not-found",
          "Upload was not found",
        );
      const intent = await repository.getIntent(input.intentId);
      if (!intent || intent.ownerUserId !== input.userId)
        throw new AttachmentWriteError(
          "upload-not-found",
          "Upload was not found",
        );
      if (intent.expiresAt.getTime() <= now().getTime())
        throw new AttachmentWriteError(
          "upload-expired",
          "Upload Intent expired",
        );
      const head = await store.head(intent.objectKey);
      if (
        !head ||
        head.contentLength !== intent.declaredByteSize ||
        (head.contentType && head.contentType !== intent.declaredMime)
      ) {
        await repository.markRejected(intent.id, "rejected");
        throw new AttachmentWriteError(
          "size-mismatch",
          "Uploaded object does not match the reserved size or type",
        );
      }
      try {
        await repository.beginValidation(intent.id);
      } catch (error) {
        wrap(error);
      }
      const bytes = await store.get(intent.objectKey, intent.declaredByteSize);
      if (!bytes || bytes.byteLength !== intent.declaredByteSize) {
        await repository.markRejected(intent.id, "rejected");
        throw new AttachmentWriteError(
          "size-mismatch",
          "Uploaded object does not match the reserved size or type",
        );
      }
      try {
        const { validateUpload } = await import("./validation");
        const detected = validateUpload({
          bytes,
          filename: `file.${intent.declaredExtension}`,
          declaredMime: intent.declaredMime,
        });
        const digest = createHash("sha256").update(bytes).digest("hex");
        const reused = await repository.findStoredFile(input.userId, digest);
        const storedFile =
          reused ??
          ({
            id: randomUUID(),
            ownerUserId: input.userId,
            objectKey: intent.objectKey,
            byteSize: bytes.byteLength,
            sha256: digest,
            detectedMime: detected.mime,
          } satisfies StoredFileRecord);
        const accepted = await repository.accept({
          intentId: intent.id,
          storedFile,
          reused: Boolean(reused),
        });
        if (reused) await store.delete(intent.objectKey);
        return {
          id: accepted.id,
          sha256: accepted.sha256,
          byteSize: accepted.byteSize,
          mime: accepted.detectedMime,
          kind: attachmentKind(accepted.detectedMime),
          reused: Boolean(reused),
        };
      } catch (error) {
        const { AttachmentValidationError } = await import("./validation");
        if (error instanceof AttachmentValidationError) {
          await repository.markRejected(intent.id, "rejected");
          throw new AttachmentWriteError(
            "validation-failed",
            "Upload rejected",
          );
        }
        wrap(error);
      }
    },

    async attachToRevision(input: {
      userId: string;
      revisionId: string;
      attachments: AttachmentDraft[];
    }) {
      if (!UUID.test(input.userId) || !UUID.test(input.revisionId))
        throw new AttachmentWriteError(
          "invalid-attachment",
          "Attachment association is malformed",
        );
      if (input.attachments.length > MAX_REVISION_ATTACHMENTS)
        throw new AttachmentWriteError(
          "too-many-attachments",
          "A Review Revision has at most four Attachments",
        );
      const drafts = input.attachments.map((attachment) => ({
        id: randomUUID(),
        ...this.normalizeDraft(attachment),
      }));
      try {
        return await repository.attachToRevision({
          userId: input.userId,
          revisionId: input.revisionId,
          attachments: drafts,
        });
      } catch (error) {
        wrap(error);
      }
    },

    async signPublicRead(
      attachmentId: string,
      options?: { download?: boolean },
    ) {
      if (!UUID.test(attachmentId))
        throw new AttachmentWriteError(
          "attachment-not-found",
          "Attachment was not found",
        );
      const found = await repository.findPublicAttachment(attachmentId);
      if (!found)
        throw new AttachmentWriteError(
          "attachment-not-found",
          "Attachment was not found",
        );
      if (!found.attachment.available || !found.objectKey)
        throw new AttachmentWriteError(
          "attachment-unavailable",
          "This Attachment is no longer available",
        );
      const download =
        options?.download || found.attachment.kind === "document";
      const signed = await store.presignGet({
        key: found.objectKey,
        contentType: found.attachment.mime,
        expiresSeconds: GET_EXPIRES_SECONDS,
        ...(found.attachment.kind === "document" || options?.download
          ? {
              contentDisposition: contentDisposition(
                options?.download ? "attachment" : "inline",
                found.attachment.filename,
              ),
            }
          : {}),
      });
      return {
        url: signed.url,
        mime: found.attachment.mime,
        kind: found.attachment.kind,
        expiresAt: new Date(now().getTime() + GET_EXPIRES_SECONDS * 1000),
        download,
      };
    },

    async removeStoredFile(storedFileId: string) {
      if (!UUID.test(storedFileId))
        throw new AttachmentWriteError(
          "attachment-not-found",
          "Stored File was not found",
        );
      let file: StoredFileRecord;
      try {
        file = await repository.requestRemoval(storedFileId);
      } catch (error) {
        wrap(error);
      }
      await store.delete(file.objectKey);
      if (await store.exists(file.objectKey)) return { removed: false };
      await repository.markRemoved(storedFileId);
      return { removed: true };
    },

    async cleanupExpired() {
      const stale = await repository.listCleanupIntents(now());
      let cleaned = 0;
      for (const intent of stale) {
        await store.delete(intent.objectKey);
        if (await store.exists(intent.objectKey)) continue;
        await repository.deleteIntent(intent.id);
        cleaned++;
      }
      for (const file of await repository.listRemovalQueue()) {
        await store.delete(file.objectKey);
        if (await store.exists(file.objectKey)) continue;
        await repository.markRemoved(file.id);
        cleaned++;
      }
      return cleaned;
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
