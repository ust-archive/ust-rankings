import { unstable_cache } from "next/cache";
import { authenticatedUserId } from "@/lib/auth/user";
import {
  ContributionsUnavailableError,
  type SignalSummary,
  type SignalTarget,
} from "@/lib/contributions/signals";

type ReadSignals = (
  target: SignalTarget,
  userId?: string,
) => Promise<SignalSummary>;

const readSignals: ReadSignals = async (target, userId) =>
  (await import("@/lib/contributions/postgres"))
    .getSignalService()
    .readSignals(target, userId);

const readCachedSignals = unstable_cache(readSignals, ["signals"], {
  revalidate: 3600,
  tags: ["contributions"],
});

async function optionalAuthenticatedUserId() {
  if (!process.env.AUTH_SECRET) return undefined;
  try {
    return await authenticatedUserId();
  } catch {
    return undefined;
  }
}

export async function loadSignals(
  target: SignalTarget,
  read: ReadSignals = readSignals,
  identify: () => Promise<string | undefined> = optionalAuthenticatedUserId,
) {
  const userId = await identify().catch(() => undefined);
  try {
    return {
      summary: await (read === readSignals
        ? readCachedSignals(target, userId)
        : read(target, userId)),
      unavailable: false as const,
    };
  } catch (error) {
    if (error instanceof ContributionsUnavailableError)
      return { summary: undefined, unavailable: true as const };
    throw error;
  }
}
