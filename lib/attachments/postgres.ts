import "server-only";
import postgres from "postgres";
import {
  type AttachmentRepository,
  AttachmentWriteError,
  type AttachmentWriteErrorCode,
  createAttachmentService,
  GLOBAL_QUOTA_BYTES,
  type ImageAttachment,
  type StoredFileRecord,
  type UploadIntentRecord,
  USER_QUOTA_BYTES,
} from "./attachments";
import { SpacesAttachmentStore } from "./spaces";

type Sql = postgres.Sql;

function mapWriteError(error: unknown): never {
  if (error instanceof AttachmentWriteError) throw error;
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message: unknown }).message);
    const code = [
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
    ].find((candidate) => message === candidate || message.includes(candidate));
    if (code)
      throw new AttachmentWriteError(
        code as AttachmentWriteErrorCode,
        "This User cannot complete this Attachment action",
      );
  }
  throw error;
}

function asNumber(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

function intent(row: UploadIntentRecord): UploadIntentRecord {
  return {
    ...row,
    declaredByteSize: asNumber(row.declaredByteSize),
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.storedFileId ? { storedFileId: row.storedFileId } : {}),
  };
}

function storedFile(row: StoredFileRecord): StoredFileRecord {
  return { ...row, byteSize: asNumber(row.byteSize) };
}

export class PostgresAttachmentRepository implements AttachmentRepository {
  constructor(
    private readonly sql: Sql,
    private readonly limits = {
      userQuota: USER_QUOTA_BYTES,
      globalQuota: GLOBAL_QUOTA_BYTES,
    },
  ) {}

  async reserve(input: Parameters<AttachmentRepository["reserve"]>[0]) {
    try {
      return await this.sql.begin(async (sql) => {
        // ponytail: global lock, shard if reserve throughput matters
        await sql`SELECT pg_advisory_xact_lock(1431520338, 48)`;
        const [account] = await sql<{ status: string | null }[]>`
          SELECT status FROM contribution_users
          WHERE id = ${input.userId}
          FOR UPDATE
        `;
        if (!account?.status)
          throw new AttachmentWriteError(
            "account-not-found",
            "User was not found",
          );
        if (account.status === "onboarding")
          throw new AttachmentWriteError(
            "onboarding-required",
            "Complete onboarding before writing",
          );
        if (account.status === "suspended")
          throw new AttachmentWriteError(
            "account-suspended",
            "This User is suspended from writing",
          );
        if (account.status !== "active")
          throw new AttachmentWriteError(
            "account-closed",
            "This User account is closed",
          );
        const [usage] = await sql<{ userBytes: string; globalBytes: string }[]>`
          SELECT
            (
              COALESCE((SELECT sum(byte_size) FROM stored_files
                        WHERE owner_user_id = ${input.userId}), 0)
              + COALESCE((SELECT sum(declared_byte_size) FROM upload_intents
                          WHERE owner_user_id = ${input.userId}
                            AND stored_file_id IS NULL
                            AND state IN ('reserved', 'uploaded', 'validating')), 0)
            )::text AS "userBytes",
            (
              COALESCE((SELECT sum(byte_size) FROM stored_files), 0)
              + COALESCE((SELECT sum(declared_byte_size) FROM upload_intents
                          WHERE stored_file_id IS NULL
                            AND state IN ('reserved', 'uploaded', 'validating')), 0)
            )::text AS "globalBytes"
        `;
        const userBytes = Number(usage.userBytes);
        const globalBytes = Number(usage.globalBytes);
        if (userBytes + input.declaredByteSize > this.limits.userQuota)
          throw new AttachmentWriteError(
            "quota-exceeded",
            "This User exceeds the 32 MiB Stored File quota",
          );
        if (globalBytes + input.declaredByteSize > this.limits.globalQuota)
          throw new AttachmentWriteError(
            "global-quota-exceeded",
            "The global Attachment reservation cap is exceeded",
          );
        await sql`
          INSERT INTO upload_intents (
            id, owner_user_id, object_key, declared_byte_size,
            declared_extension, declared_mime, state, expires_at
          ) VALUES (
            ${input.intentId}, ${input.userId}, ${input.objectKey},
            ${input.declaredByteSize}, ${input.declaredExtension},
            ${input.declaredMime}, 'reserved', ${input.expiresAt}
          )
        `;
        return { quotaUsedBytes: userBytes + input.declaredByteSize };
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async getIntent(intentId: string) {
    const [row] = await this.sql<UploadIntentRecord[]>`
      SELECT id,
             owner_user_id AS "ownerUserId",
             object_key AS "objectKey",
             declared_byte_size AS "declaredByteSize",
             declared_extension AS "declaredExtension",
             declared_mime AS "declaredMime",
             state,
             stored_file_id AS "storedFileId",
             expires_at AS "expiresAt",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM upload_intents
      WHERE id = ${intentId}
    `;
    return row ? intent(row) : undefined;
  }

  async markRejected(intentId: string, state: "rejected" | "validation_error") {
    await this.sql`
      UPDATE upload_intents
      SET state = ${state}, updated_at = now(), stored_file_id = NULL
      WHERE id = ${intentId} AND state <> 'accepted'
    `;
  }

  async beginValidation(intentId: string) {
    const [row] = await this.sql<UploadIntentRecord[]>`
      UPDATE upload_intents
      SET state = 'validating', updated_at = now()
      WHERE id = ${intentId}
        AND state IN ('reserved', 'uploaded')
        AND expires_at > now()
      RETURNING id,
                owner_user_id AS "ownerUserId",
                object_key AS "objectKey",
                declared_byte_size AS "declaredByteSize",
                declared_extension AS "declaredExtension",
                declared_mime AS "declaredMime",
                state,
                stored_file_id AS "storedFileId",
                expires_at AS "expiresAt",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
    `;
    if (!row)
      throw new AttachmentWriteError(
        "upload-not-found",
        "Upload was not found",
      );
    return intent(row);
  }

  async findStoredFile(userId: string, sha256: string) {
    const [row] = await this.sql<StoredFileRecord[]>`
      SELECT id,
             owner_user_id AS "ownerUserId",
             object_key AS "objectKey",
             byte_size AS "byteSize",
             sha256,
             detected_mime AS "detectedMime"
      FROM stored_files
      WHERE owner_user_id = ${userId} AND sha256 = ${sha256}
    `;
    return row ? storedFile(row) : undefined;
  }

  async accept(input: Parameters<AttachmentRepository["accept"]>[0]) {
    try {
      return await this.sql.begin(async (sql) => {
        if (!input.reused) {
          await sql`
            INSERT INTO stored_files (
              id, owner_user_id, object_key, byte_size, sha256, detected_mime
            ) VALUES (
              ${input.storedFile.id}, ${input.storedFile.ownerUserId},
              ${input.storedFile.objectKey}, ${input.storedFile.byteSize},
              ${input.storedFile.sha256}, ${input.storedFile.detectedMime}
            )
            ON CONFLICT (owner_user_id, sha256) DO NOTHING
          `;
        }
        const [file] = await sql<StoredFileRecord[]>`
          SELECT id,
                 owner_user_id AS "ownerUserId",
                 object_key AS "objectKey",
                 byte_size AS "byteSize",
                 sha256,
                 detected_mime AS "detectedMime"
          FROM stored_files
          WHERE owner_user_id = ${input.storedFile.ownerUserId}
            AND sha256 = ${input.storedFile.sha256}
        `;
        if (!file)
          throw new AttachmentWriteError(
            "validation-failed",
            "Stored File was not retained",
          );
        await sql`
          UPDATE upload_intents
          SET state = 'accepted',
              stored_file_id = ${file.id},
              updated_at = now()
          WHERE id = ${input.intentId}
        `;
        return storedFile(file);
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async attachToRevision(
    input: Parameters<AttachmentRepository["attachToRevision"]>[0],
  ) {
    try {
      return await this.sql.begin(async (sql) => {
        if (input.attachments.length > 4)
          throw new AttachmentWriteError(
            "too-many-attachments",
            "A Review Revision has at most four Attachments",
          );
        const created: ImageAttachment[] = [];
        for (const draft of input.attachments) {
          const [row] = await sql<ImageAttachment[]>`
            WITH inserted AS (
              INSERT INTO attachments (
                id, revision_id, stored_file_id, public_filename, description
              )
              SELECT ${draft.id}, ${input.revisionId}, sf.id,
                     ${draft.filename}, ${draft.description}
              FROM stored_files sf
              WHERE sf.id = ${draft.storedFileId}
                AND sf.owner_user_id = ${input.userId}
              RETURNING id, stored_file_id, public_filename, description
            )
            SELECT inserted.id,
                   inserted.stored_file_id AS "storedFileId",
                   inserted.public_filename AS filename,
                   inserted.description,
                   sf.detected_mime AS mime
            FROM inserted
            JOIN stored_files sf ON sf.id = inserted.stored_file_id
          `;
          if (!row)
            throw new AttachmentWriteError(
              "invalid-attachment",
              "Stored File cannot be attached",
            );
          created.push(row);
        }
        return created;
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findPublicAttachment(attachmentId: string) {
    const [row] = await this.sql<
      Array<ImageAttachment & { objectKey: string }>
    >`
      SELECT a.id,
             a.stored_file_id AS "storedFileId",
             a.public_filename AS filename,
             a.description,
             sf.detected_mime AS mime,
             sf.object_key AS "objectKey"
      FROM attachments a
      JOIN stored_files sf ON sf.id = a.stored_file_id
      JOIN review_revisions rr ON rr.id = a.revision_id
      JOIN reviews r ON r.current_revision_id = rr.id
      WHERE a.id = ${attachmentId} AND r.publication_state = 'active'
    `;
    if (!row) return undefined;
    const { objectKey, ...attachment } = row;
    return { attachment, objectKey };
  }

  async listCleanupIntents(now: Date) {
    const rows = await this.sql<UploadIntentRecord[]>`
      SELECT id,
             owner_user_id AS "ownerUserId",
             object_key AS "objectKey",
             declared_byte_size AS "declaredByteSize",
             declared_extension AS "declaredExtension",
             declared_mime AS "declaredMime",
             state,
             stored_file_id AS "storedFileId",
             expires_at AS "expiresAt",
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM upload_intents
      WHERE stored_file_id IS NULL
        AND (
          state IN ('rejected', 'validation_error')
          OR expires_at <= ${now}
          OR updated_at <= ${now}::timestamptz - interval '24 hours'
        )
    `;
    return rows.map(intent);
  }

  async deleteIntent(intentId: string) {
    await this.sql`
      DELETE FROM upload_intents
      WHERE id = ${intentId} AND stored_file_id IS NULL
    `;
  }
}

export class AttachmentsUnavailableError extends Error {
  constructor(message = "Attachments are unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "AttachmentsUnavailableError";
  }
}

let runtime:
  | {
      sql: Sql;
      attachments: ReturnType<
        typeof import("./attachments").createAttachmentService
      >;
    }
  | undefined;

export function getAttachmentService() {
  if (runtime) return runtime.attachments;
  const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
  if (!connection) throw new AttachmentsUnavailableError();
  try {
    const sql = postgres(connection, { max: 5 });
    runtime = {
      sql,
      attachments: createAttachmentService(
        new PostgresAttachmentRepository(sql),
        new SpacesAttachmentStore(),
      ),
    };
    return runtime.attachments;
  } catch (error) {
    throw new AttachmentsUnavailableError(undefined, { cause: error });
  }
}

export async function closeAttachmentRuntimeForTests() {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end();
}
