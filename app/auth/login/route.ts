import { signIn } from "@/auth";
import { HKUST_PROVIDER_ID, safeReturnPath } from "@/lib/auth/policy";

export async function GET(request: Request) {
  const returnPath = safeReturnPath(new URL(request.url).searchParams.get("r"));
  await signIn(HKUST_PROVIDER_ID, {
    redirectTo: `/auth/continue?r=${encodeURIComponent(returnPath)}`,
  });
  return Response.redirect(new URL(returnPath, request.url));
}
