import { expect, mock, test } from "bun:test";
import { jpegBytes } from "./attachment-fixtures";

mock.module("server-only", () => ({}));

let userId: string | undefined = "00000000-0000-4000-8000-000000000048";
const reserved: unknown[] = [];
const completed: unknown[] = [];
const signed: string[] = [];

const attachments = {
  async reserveUpload(input: unknown) {
    reserved.push(input);
    return {
      intentId: "00000000-0000-4000-8000-000000000148",
      objectKey: "00000000-0000-4000-8000-000000000148",
      uploadUrl: "https://sgp1.digitaloceanspaces.com/put",
      uploadHeaders: { "Content-Type": "image/jpeg" },
      expiresAt: new Date("2026-04-01T00:15:00.000Z"),
      reservedBytes: jpegBytes().byteLength,
      quotaUsedBytes: jpegBytes().byteLength,
    };
  },
  async completeUpload(input: unknown) {
    completed.push(input);
    return {
      id: "00000000-0000-4000-8000-000000000248",
      sha256: "a".repeat(64),
      byteSize: 12,
      mime: "image/jpeg",
      reused: false,
    };
  },
  async signPublicRead(attachmentId: string) {
    signed.push(attachmentId);
    if (attachmentId.endsWith("404")) {
      const { AttachmentWriteError } = await import(
        "@/lib/attachments/attachments"
      );
      throw new AttachmentWriteError("attachment-not-found", "missing");
    }
    return {
      url: "https://sgp1.digitaloceanspaces.com/object?X-Amz-Expires=300",
      mime: "image/jpeg",
      expiresAt: new Date("2026-04-01T00:05:00.000Z"),
    };
  },
  async cleanupExpired() {
    return 2;
  },
};

function request(path: string, init?: RequestInit) {
  return new Request(`https://rankings.example${path}`, {
    ...init,
    headers: {
      host: "rankings.example",
      origin: "https://rankings.example",
      ...(init?.headers ?? {}),
    },
  });
}

test("upload routes require same-origin active Users and never accept caller keys", async () => {
  const { createAttachmentUploadHandlers } = await import(
    "@/app/api/attachments/uploads/route"
  );
  const { createAttachmentCompleteHandlers } = await import(
    "@/app/api/attachments/uploads/[intentId]/complete/route"
  );
  const handlers = createAttachmentUploadHandlers({
    userId: async () => userId,
    attachments: () => attachments as never,
  });
  const complete = createAttachmentCompleteHandlers({
    userId: async () => userId,
    attachments: () => attachments as never,
  });

  userId = undefined;
  expect(
    (
      await handlers.POST(
        request("/api/attachments/uploads", { method: "POST", body: "{}" }),
      )
    ).status,
  ).toBe(401);
  userId = "00000000-0000-4000-8000-000000000048";
  const cross = await handlers.POST(
    new Request("https://rankings.example/api/attachments/uploads", {
      method: "POST",
      headers: { host: "rankings.example", origin: "https://evil.example" },
      body: "{}",
    }),
  );
  expect(cross.status).toBe(403);

  reserved.length = 0;
  const created = await handlers.POST(
    request("/api/attachments/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        byteSize: 12,
        filename: "photo.jpg",
        contentType: "image/jpeg",
        objectKey: "attacker-key",
      }),
    }),
  );
  expect(created.status).toBe(200);
  expect(reserved).toEqual([
    {
      userId,
      byteSize: 12,
      filename: "photo.jpg",
      contentType: "image/jpeg",
    },
  ]);

  const finished = await complete.POST(
    request(
      "/api/attachments/uploads/00000000-0000-4000-8000-000000000148/complete",
      {
        method: "POST",
      },
    ),
    {
      params: Promise.resolve({
        intentId: "00000000-0000-4000-8000-000000000148",
      }),
    },
  );
  expect(finished.status).toBe(200);
  expect(completed).toEqual([
    {
      userId,
      intentId: "00000000-0000-4000-8000-000000000148",
    },
  ]);
});

test("public Attachment resolver redirects to a five-minute signed origin URL", async () => {
  const { createAttachmentResolver } = await import(
    "@/app/attachments/[attachmentId]/route"
  );
  const GET = createAttachmentResolver(() => attachments as never).GET;
  const found = await GET(
    request("/attachments/00000000-0000-4000-8000-000000000348"),
    {
      params: Promise.resolve({
        attachmentId: "00000000-0000-4000-8000-000000000348",
      }),
    },
  );
  expect(found.status).toBe(302);
  expect(found.headers.get("location")).toContain("X-Amz-Expires=300");
  const missing = await GET(
    request("/attachments/00000000-0000-4000-8000-000000000404"),
    {
      params: Promise.resolve({
        attachmentId: "00000000-0000-4000-8000-000000000404",
      }),
    },
  );
  expect(missing.status).toBe(404);
});

test("public resolver uses download disposition and a Tombstone placeholder", async () => {
  const { createAttachmentResolver } = await import(
    "@/app/attachments/[attachmentId]/route"
  );
  const GET = createAttachmentResolver(
    () =>
      ({
        async signPublicRead(
          attachmentId: string,
          options?: { download?: boolean },
        ) {
          if (attachmentId.endsWith("410")) {
            const { AttachmentWriteError } = await import(
              "@/lib/attachments/attachments"
            );
            throw new AttachmentWriteError(
              "attachment-unavailable",
              "This Attachment is no longer available",
            );
          }
          signed.push(
            `${attachmentId}:${options?.download ? "download" : "open"}`,
          );
          return {
            url: options?.download
              ? "https://sgp1.digitaloceanspaces.com/object?download=1"
              : "https://sgp1.digitaloceanspaces.com/object?X-Amz-Expires=300",
            mime: "application/pdf",
            kind: "document" as const,
            expiresAt: new Date("2026-04-01T00:05:00.000Z"),
            download: Boolean(options?.download),
          };
        },
      }) as never,
  ).GET;
  const downloaded = await GET(
    request("/attachments/00000000-0000-4000-8000-000000000348?download=1"),
    {
      params: Promise.resolve({
        attachmentId: "00000000-0000-4000-8000-000000000348",
      }),
    },
  );
  expect(downloaded.status).toBe(302);
  expect(downloaded.headers.get("location")).toContain("download=1");
  const gone = await GET(
    request("/attachments/00000000-0000-4000-8000-000000000410"),
    {
      params: Promise.resolve({
        attachmentId: "00000000-0000-4000-8000-000000000410",
      }),
    },
  );
  expect(gone.status).toBe(410);
  expect(await gone.text()).toContain("no longer available");
});

test("upload kill switch is distinct from Review publication", async () => {
  const { createAttachmentUploadHandlers } = await import(
    "@/app/api/attachments/uploads/route"
  );
  const handlers = createAttachmentUploadHandlers({
    userId: async () => "00000000-0000-4000-8000-000000000048",
    attachments: () =>
      ({
        async reserveUpload() {
          const { AttachmentWriteError } = await import(
            "@/lib/attachments/attachments"
          );
          throw new AttachmentWriteError(
            "uploads-disabled",
            "New Attachment uploads are disabled",
          );
        },
      }) as never,
  });
  const blocked = await handlers.POST(
    request("/api/attachments/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        byteSize: 12,
        filename: "photo.jpg",
        contentType: "image/jpeg",
      }),
    }),
  );
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toEqual({ error: "uploads-disabled" });
});

test("cleanup requires the cron secret", async () => {
  process.env.CRON_SECRET = "correct-secret-with-enough-entropy";
  const { createAttachmentCleanupHandlers } = await import(
    "@/app/api/attachments/cleanup/route"
  );
  const GET = createAttachmentCleanupHandlers(() => attachments as never).GET;
  expect(
    (await GET(new Request("https://rankings.example/api/attachments/cleanup")))
      .status,
  ).toBe(401);
  const cleaned = await GET(
    new Request("https://rankings.example/api/attachments/cleanup", {
      headers: { authorization: "Bearer correct-secret-with-enough-entropy" },
    }),
  );
  expect(cleaned.status).toBe(200);
  expect(await cleaned.json()).toEqual({ cleaned: 2 });
  delete process.env.CRON_SECRET;
});
