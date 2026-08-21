import {
  type AttachmentService,
  AttachmentWriteError,
} from "@/lib/attachments/attachments";
import { authenticatedUserId } from "@/lib/auth/user";
import { isSameOriginWrite } from "@/lib/contributions/http";

type CompleteHandlers = {
  userId(request: Request): Promise<string | undefined>;
  attachments(): AttachmentService;
};

function hostOf(request: Request) {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host");
}

export function createAttachmentCompleteHandlers(handlers: CompleteHandlers) {
  return {
    async POST(
      request: Request,
      context: { params: Promise<{ intentId: string }> },
    ) {
      if (!isSameOriginWrite(request.headers.get("origin"), hostOf(request)))
        return Response.json({ error: "cross-origin" }, { status: 403 });
      const userId = await handlers.userId(request);
      if (!userId)
        return Response.json({ error: "unauthorized" }, { status: 401 });
      const { intentId } = await context.params;
      try {
        return Response.json(
          await handlers.attachments().completeUpload({ userId, intentId }),
        );
      } catch (error) {
        if (error instanceof AttachmentWriteError)
          return Response.json({ error: error.code }, { status: 400 });
        throw error;
      }
    },
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
) {
  const { getAttachmentService } = await import("@/lib/attachments/postgres");
  return createAttachmentCompleteHandlers({
    userId: authenticatedUserId,
    attachments: getAttachmentService,
  }).POST(request, context);
}
