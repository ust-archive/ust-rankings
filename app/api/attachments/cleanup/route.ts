import { createHash, timingSafeEqual } from "node:crypto";
import type { AttachmentService } from "@/lib/attachments/attachments";

function authenticated(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer "))
    return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  return timingSafeEqual(actual, expected);
}

export function createAttachmentCleanupHandlers(
  attachments: () => AttachmentService,
) {
  return {
    async GET(request: Request) {
      if (!authenticated(request))
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      const cleaned = await attachments().cleanupExpired();
      return Response.json({ cleaned });
    },
  };
}

export async function GET(request: Request) {
  const { getAttachmentService } = await import("@/lib/attachments/postgres");
  return createAttachmentCleanupHandlers(getAttachmentService).GET(request);
}
