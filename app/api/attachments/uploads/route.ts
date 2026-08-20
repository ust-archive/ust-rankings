import {
  type AttachmentService,
  AttachmentWriteError,
} from "@/lib/attachments/attachments";
import { authenticatedUserId } from "@/lib/auth/user";
import { isSameOriginWrite } from "@/lib/contributions/http";

type UploadHandlers = {
  userId(request: Request): Promise<string | undefined>;
  attachments(): AttachmentService;
};

function hostOf(request: Request) {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

function jsonError(error: unknown) {
  if (error instanceof AttachmentWriteError)
    return Response.json(
      { error: error.code },
      { status: error.code === "uploads-disabled" ? 403 : 400 },
    );
  if (error instanceof Error && error.name === "AttachmentsUnavailableError")
    return Response.json({ error: "unavailable" }, { status: 503 });
  throw error;
}

export function createAttachmentUploadHandlers(handlers: UploadHandlers) {
  return {
    async POST(request: Request) {
      if (!isSameOriginWrite(request.headers.get("origin"), hostOf(request)))
        return Response.json({ error: "cross-origin" }, { status: 403 });
      const userId = await handlers.userId(request);
      if (!userId)
        return Response.json({ error: "unauthorized" }, { status: 401 });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid-upload" }, { status: 400 });
      }
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { byteSize?: unknown }).byteSize !== "number" ||
        typeof (body as { filename?: unknown }).filename !== "string" ||
        typeof (body as { contentType?: unknown }).contentType !== "string"
      )
        return Response.json({ error: "invalid-upload" }, { status: 400 });
      try {
        return Response.json(
          await handlers.attachments().reserveUpload({
            userId,
            byteSize: (body as { byteSize: number }).byteSize,
            filename: (body as { filename: string }).filename,
            contentType: (body as { contentType: string }).contentType,
          }),
        );
      } catch (error) {
        return jsonError(error);
      }
    },
  };
}

export async function POST(request: Request) {
  const { getAttachmentService } = await import("@/lib/attachments/postgres");
  return createAttachmentUploadHandlers({
    userId: authenticatedUserId,
    attachments: getAttachmentService,
  }).POST(request);
}
