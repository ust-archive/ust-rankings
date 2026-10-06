import "server-only";
import postgres from "postgres";
import { databaseRequestContext } from "@/lib/database-request-context";
import {
  type DatabaseContext,
  observeDatabaseService,
} from "@/lib/database-telemetry";
import {
  type AttachmentRepository,
  AttachmentWriteError,
  type AttachmentWriteErrorCode,
  createAttachmentService,
  GLOBAL_QUOTA_BYTES,
  type ImageAttachment,
  MAX_VALIDATION_ATTEMPTS,
  type StoredFileRecord,
  type UploadIntentRecord,
  USER_QUOTA_BYTES,
  VALIDATION_LEASE_SECONDS,
  type ValidationLease,
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
      "validation-in-progress",
      "validation-retry-exhausted",
      "validation-lease-lost",
      "too-many-attachments",
      "invalid-attachment",
      "attachment-not-found",
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

export async function attachToReviewRevision(
  sql: postgres.TransactionSql,
  input: Parameters<AttachmentRepository["attachToRevision"]>[0],
) {
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
          AND sf.removed_at IS NULL
        RETURNING id, stored_file_id, public_filename, description
      )
      SELECT inserted.id,
             inserted.stored_file_id AS "storedFileId",
             inserted.public_filename AS filename,
             inserted.description,
             sf.detected_mime AS mime,
             CASE WHEN sf.detected_mime LIKE 'image/%' THEN 'image'
                  ELSE 'document' END AS kind,
             true AS available
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
                        WHERE owner_user_id = ${input.userId}
                          AND removed_at IS NULL), 0)
              + COALESCE((SELECT sum(declared_byte_size) FROM upload_intents AS intent
                          WHERE owner_user_id = ${input.userId}
                            AND NOT EXISTS (
                              SELECT 1 FROM stored_files AS file
                              WHERE file.object_key = intent.object_key
                                AND file.removed_at IS NULL
                            )), 0)
            )::text AS "userBytes",
            (
              COALESCE((SELECT sum(byte_size) FROM stored_files
                        WHERE removed_at IS NULL), 0)
              + COALESCE((SELECT sum(declared_byte_size) FROM upload_intents AS intent
                          WHERE NOT EXISTS (
                            SELECT 1 FROM stored_files AS file
                            WHERE file.object_key = intent.object_key
                              AND file.removed_at IS NULL
                          )), 0)
              + COALESCE((SELECT sum(intent.declared_byte_size) FROM upload_intents intent
                          CROSS JOIN LATERAL unnest(intent.validation_keys) AS candidate(key)
                          WHERE NOT EXISTS (SELECT 1 FROM stored_files file
                            WHERE file.object_key = candidate.key AND file.removed_at IS NULL)), 0)
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
        return {
          quotaUsedBytes: userBytes + input.declaredByteSize,
          globalUsedBytes: globalBytes + input.declaredByteSize,
        };
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

  async getAccepted(intentId: string) {
    const [row] = await this.sql<(StoredFileRecord & { reused: boolean })[]>`
      SELECT sf.id, sf.owner_user_id AS "ownerUserId", sf.object_key AS "objectKey",
             sf.byte_size AS "byteSize", sf.sha256, sf.detected_mime AS "detectedMime",
             intent.accepted_reused AS reused
      FROM upload_intents intent JOIN stored_files sf ON sf.id = intent.stored_file_id
      WHERE intent.id = ${intentId} AND intent.state = 'accepted'
        AND sf.removal_requested_at IS NULL AND sf.removed_at IS NULL
    `;
    return row ? { ...storedFile(row), reused: row.reused } : undefined;
  }

  async markRejected(
    intentId: string,
    state: "rejected" | "validation_error",
    leaseId: string,
  ) {
    await this.sql`
      UPDATE upload_intents
      SET state = ${state}, updated_at = now(), stored_file_id = NULL
      WHERE id = ${intentId} AND state = 'validating'
        AND validation_lease_id = ${leaseId}
    `;
  }

  async beginValidation(intentId: string) {
    return this.sql.begin(async (sql) => {
      // Share reservation's lock so retained attempt copies cannot bypass the physical cap.
      await sql`SELECT pg_advisory_xact_lock(1431520338, 48)`;
      const [current] = await sql<
        {
          state: string;
          expired: boolean;
          active: boolean;
          attempts: number;
          byteSize: string;
        }[]
      >`
        SELECT state, expires_at <= clock_timestamp() AS expired,
               validation_lease_expires_at > clock_timestamp() AS active,
               validation_attempts AS attempts, declared_byte_size::text AS "byteSize"
        FROM upload_intents WHERE id = ${intentId} FOR UPDATE
      `;
      if (
        !current ||
        !["reserved", "uploaded", "validation_error", "validating"].includes(
          current.state,
        )
      )
        throw new AttachmentWriteError(
          "upload-not-found",
          "Upload was not found",
        );
      if (current.expired)
        throw new AttachmentWriteError(
          "upload-expired",
          "Upload Intent expired",
        );
      if (current.state === "validating" && current.active)
        throw new AttachmentWriteError(
          "validation-in-progress",
          "Upload validation is already running",
        );
      if (current.attempts >= MAX_VALIDATION_ATTEMPTS)
        throw new AttachmentWriteError(
          "validation-retry-exhausted",
          "Upload validation retry limit reached",
        );
      const [usage] = await sql<{ bytes: string }[]>`
        SELECT (COALESCE((SELECT sum(byte_size) FROM stored_files WHERE removed_at IS NULL), 0)
          + COALESCE((SELECT sum(declared_byte_size) FROM upload_intents intent
              WHERE NOT EXISTS (SELECT 1 FROM stored_files sf WHERE sf.object_key = intent.object_key
                                AND sf.removed_at IS NULL)), 0)
          + COALESCE((SELECT sum(intent.declared_byte_size) FROM upload_intents intent
              CROSS JOIN LATERAL unnest(intent.validation_keys) AS candidate(key)
              WHERE NOT EXISTS (SELECT 1 FROM stored_files sf WHERE sf.object_key = candidate.key
                                AND sf.removed_at IS NULL)), 0))::text AS bytes
      `;
      if (
        Number(usage.bytes) + Number(current.byteSize) >
        this.limits.globalQuota
      )
        throw new AttachmentWriteError(
          "global-quota-exceeded",
          "The global Attachment reservation cap is exceeded",
        );
      const leaseId = crypto.randomUUID();
      const objectKey = `verified/${intentId}/${leaseId}`;
      const [row] = await sql<ValidationLease[]>`
      UPDATE upload_intents
      SET state = 'validating', updated_at = now(),
          validation_lease_id = ${leaseId},
          validation_lease_expires_at = LEAST(expires_at, clock_timestamp() + ${VALIDATION_LEASE_SECONDS} * interval '1 second'),
          validation_attempts = validation_attempts + 1,
          validation_keys = array_append(validation_keys, ${objectKey})
      WHERE id = ${intentId}
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
                updated_at AS "updatedAt",
                validation_lease_id AS "validationLeaseId",
                ${objectKey}::text AS "validationObjectKey",
                validation_lease_expires_at AS "validationLeaseExpiresAt"
    `;
      return {
        ...intent(row),
        validationLeaseId: row.validationLeaseId,
        validationObjectKey: row.validationObjectKey,
        validationLeaseExpiresAt: new Date(row.validationLeaseExpiresAt),
      };
    });
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
      WHERE owner_user_id = ${userId} AND sha256 = ${sha256} AND removed_at IS NULL
    `;
    return row ? storedFile(row) : undefined;
  }

  async accept(input: Parameters<AttachmentRepository["accept"]>[0]) {
    try {
      return await this.sql.begin(async (sql) => {
        const [claimed] = await sql<
          {
            ownerUserId: string;
            objectKey: string;
            byteSize: string;
            mime: string;
          }[]
        >`
          SELECT owner_user_id AS "ownerUserId",
                 'verified/' || id || '/' || validation_lease_id AS "objectKey",
                 declared_byte_size::text AS "byteSize", declared_mime AS mime
          FROM upload_intents
          WHERE id = ${input.intentId} AND state = 'validating'
            AND validation_lease_id = ${input.leaseId}
            AND validation_lease_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
          FOR UPDATE
        `;
        if (
          !claimed ||
          claimed.ownerUserId !== input.storedFile.ownerUserId ||
          Number(claimed.byteSize) !== input.storedFile.byteSize ||
          claimed.mime !== input.storedFile.detectedMime ||
          (!input.reused && claimed.objectKey !== input.storedFile.objectKey)
        )
          throw new AttachmentWriteError(
            "validation-lease-lost",
            "Upload validation lease is no longer current",
          );
        if (!input.reused) {
          await sql`
            INSERT INTO stored_files (
              id, owner_user_id, object_key, byte_size, sha256, detected_mime
            ) VALUES (
              ${input.storedFile.id}, ${input.storedFile.ownerUserId},
              ${input.storedFile.objectKey}, ${input.storedFile.byteSize},
              ${input.storedFile.sha256}, ${input.storedFile.detectedMime}
            )
            ON CONFLICT (owner_user_id, sha256) WHERE removed_at IS NULL DO NOTHING
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
            AND removed_at IS NULL
        `;
        if (!file)
          throw new AttachmentWriteError(
            "validation-failed",
            "Stored File was not retained",
          );
        const accepted = await sql`
          UPDATE upload_intents
          SET state = 'accepted',
              stored_file_id = ${file.id},
              accepted_reused = ${input.reused || file.id !== input.storedFile.id},
              validation_keys = CASE WHEN ${input.reused}
                THEN array_remove(validation_keys, ${claimed.objectKey}) ELSE validation_keys END,
              updated_at = now()
          WHERE id = ${input.intentId}
            AND validation_lease_id = ${input.leaseId}
            AND validation_lease_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
          RETURNING id
        `;
        if (!accepted.length)
          throw new AttachmentWriteError(
            "validation-lease-lost",
            "Upload validation lease expired before acceptance",
          );
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
      return await this.sql.begin((sql) => attachToReviewRevision(sql, input));
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findPublicAttachment(attachmentId: string) {
    const [row] = await this.sql<
      Array<ImageAttachment & { objectKey: string; removed: boolean }>
    >`
      SELECT a.id,
             a.stored_file_id AS "storedFileId",
             a.public_filename AS filename,
             a.description,
             sf.detected_mime AS mime,
             CASE WHEN sf.detected_mime LIKE 'image/%' THEN 'image'
                  ELSE 'document' END AS kind,
             (sf.removed_at IS NULL) AS available,
             sf.object_key AS "objectKey",
             (sf.removed_at IS NOT NULL) AS removed
      FROM attachments a
      JOIN stored_files sf ON sf.id = a.stored_file_id
      JOIN review_revisions rr ON rr.id = a.revision_id
      JOIN reviews r ON r.current_revision_id = rr.id
      WHERE a.id = ${attachmentId} AND r.publication_state = 'active'
    `;
    if (!row) return undefined;
    const { objectKey, removed, ...attachment } = row;
    return {
      attachment,
      ...(removed ? {} : { objectKey }),
    };
  }

  async listCleanupIntents(now: Date) {
    return this.sql<Array<{ id: string; objectKeys: string[] }>>`
      SELECT intent.id,
             ARRAY(
               SELECT DISTINCT key FROM unnest(ARRAY[intent.object_key, 'verified/' || intent.id] || intent.validation_keys) AS key
               WHERE NOT EXISTS (SELECT 1 FROM stored_files WHERE object_key = key)
             ) AS "objectKeys"
      FROM upload_intents intent
      WHERE expires_at <= ${now}
        -- Failed and overlapping attempts may have late provider writes. Keep
        -- their metadata for a full day, including after a later success.
        AND (cardinality(validation_keys) = 0
             OR (state NOT IN ('validating', 'validation_error')
                 AND validation_attempts <= 1 AND cardinality(validation_keys) <= 1)
             OR updated_at <= ${now}::timestamptz - interval '24 hours')
    `;
  }

  async deleteIntent(intentId: string) {
    await this.sql`
      DELETE FROM upload_intents
      WHERE id = ${intentId}
    `;
  }

  async requestRemoval(storedFileId: string) {
    const [row] = await this.sql<StoredFileRecord[]>`
      UPDATE stored_files
      SET removal_requested_at = COALESCE(removal_requested_at, now())
      WHERE id = ${storedFileId} AND removed_at IS NULL
      RETURNING id,
                owner_user_id AS "ownerUserId",
                object_key AS "objectKey",
                byte_size AS "byteSize",
                sha256,
                detected_mime AS "detectedMime"
    `;
    if (!row)
      throw new AttachmentWriteError(
        "attachment-not-found",
        "Stored File was not found",
      );
    return storedFile(row);
  }

  async listRemovalQueue() {
    const rows = await this.sql<StoredFileRecord[]>`
      SELECT id,
             owner_user_id AS "ownerUserId",
             object_key AS "objectKey",
             byte_size AS "byteSize",
             sha256,
             detected_mime AS "detectedMime"
      FROM stored_files
      WHERE removal_requested_at IS NOT NULL AND removed_at IS NULL
    `;
    return rows.map(storedFile);
  }

  async markRemoved(storedFileId: string) {
    await this.sql`
      UPDATE stored_files
      SET removed_at = now()
      WHERE id = ${storedFileId}
        AND removal_requested_at IS NOT NULL
        AND removed_at IS NULL
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

function initializeRuntime() {
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

export function getAttachmentService(
  context: DatabaseContext = {
    caller: "attachments",
    requestClass: "action-api",
  },
) {
  return observeDatabaseService(
    initializeRuntime(),
    "attachments",
    {
      reserveUpload: "write",
      completeUpload: "write",
      attachToRevision: "write",
      signPublicRead: "read",
      removeStoredFile: "write",
      cleanupExpired: "write",
    },
    () => databaseRequestContext(context),
  );
}

export async function closeAttachmentRuntimeForTests() {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end();
}
