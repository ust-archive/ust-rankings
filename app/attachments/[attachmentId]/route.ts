import {
  type AttachmentService,
  AttachmentWriteError,
} from "@/lib/attachments/attachments";

export function createAttachmentResolver(attachments: () => AttachmentService) {
  return {
    async GET(
      _request: Request,
      context: { params: Promise<{ attachmentId: string }> },
    ) {
      try {
        const { attachmentId } = await context.params;
        const signed = await attachments().signPublicRead(attachmentId);
        return Response.redirect(signed.url, 302);
      } catch (error) {
        if (error instanceof AttachmentWriteError)
          return new Response("Not found", { status: 404 });
        if (
          error instanceof Error &&
          error.name === "AttachmentsUnavailableError"
        )
          return new Response("Attachments unavailable", { status: 503 });
        throw error;
      }
    },
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const { getAttachmentService } = await import("@/lib/attachments/postgres");
  return createAttachmentResolver(getAttachmentService).GET(request, context);
}
