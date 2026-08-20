import {
  type InstitutionalClaims,
  normalizePublicDisplayName,
  validateInstitutionalClaims,
} from "@/lib/auth/policy";

export type UserStatus = "onboarding" | "active" | "suspended" | "closed";

export type AccountRow = {
  id: string;
  status: UserStatus;
  publicDisplayName: string | null;
};

export type EstablishIdentityInput = {
  issuer: string;
  subject: string;
  profileName: string | null;
  profileEmail: string | null;
  suggestedDisplayName: string | null;
};

export interface AccountRepository {
  establishIdentity(input: EstablishIdentityInput): Promise<AccountRow>;
  findUser(userId: string): Promise<AccountRow | undefined>;
  activateUser(
    userId: string,
    publicDisplayName: string,
    acceptances: Array<{
      policy: "privacy" | "community";
      version: string;
    }>,
  ): Promise<AccountRow | undefined>;
  updateDisplayName(
    userId: string,
    publicDisplayName: string,
  ): Promise<AccountRow | undefined>;
}

export type AccountWriteErrorCode =
  | "account-not-found"
  | "onboarding-required"
  | "account-suspended"
  | "account-closed"
  | "acceptance-required"
  | "policy-unavailable"
  | "invalid-display-name";

export class AccountWriteError extends Error {
  constructor(
    public readonly code: AccountWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountWriteError";
  }
}

function statusError(user: AccountRow | undefined) {
  if (!user)
    return new AccountWriteError("account-not-found", "User was not found");
  if (user.status === "onboarding")
    return new AccountWriteError(
      "onboarding-required",
      "Complete onboarding before writing",
    );
  if (user.status === "suspended")
    return new AccountWriteError(
      "account-suspended",
      "This User is suspended from writing",
    );
  if (user.status === "closed")
    return new AccountWriteError(
      "account-closed",
      "This User account is closed",
    );
  return undefined;
}

function validDisplayName(input: string) {
  const normalized = normalizePublicDisplayName(input);
  if (typeof normalized !== "string")
    throw new AccountWriteError("invalid-display-name", normalized.error);
  return normalized;
}

export function createAccountService(
  repository: AccountRepository,
  policyVersions: {
    privacyPolicyVersion?: string;
    communityRulesVersion?: string;
  },
) {
  return {
    async establishUser(
      claims: InstitutionalClaims & { name?: unknown; email?: unknown },
    ) {
      const identity = validateInstitutionalClaims(claims);
      const profileName = typeof claims.name === "string" ? claims.name : null;
      const profileEmail =
        typeof claims.email === "string" ? claims.email : null;
      const candidate = profileName
        ? normalizePublicDisplayName(profileName)
        : undefined;
      return repository.establishIdentity({
        ...identity,
        profileName,
        profileEmail,
        suggestedDisplayName: typeof candidate === "string" ? candidate : null,
      });
    },

    getUser(userId: string) {
      return repository.findUser(userId);
    },

    async requireActiveUser(userId: string) {
      const user = await repository.findUser(userId);
      const error = statusError(user);
      if (error) throw error;
      return user as AccountRow & { status: "active" };
    },

    async completeOnboarding(
      userId: string,
      input: {
        publicDisplayName: string;
        acceptPrivacy: boolean;
        acceptCommunity: boolean;
      },
    ) {
      if (!input.acceptPrivacy || !input.acceptCommunity)
        throw new AccountWriteError(
          "acceptance-required",
          "Accept the current privacy notice and community rules",
        );
      const { privacyPolicyVersion, communityRulesVersion } = policyVersions;
      if (!privacyPolicyVersion || !communityRulesVersion)
        throw new AccountWriteError(
          "policy-unavailable",
          "Current policy versions are not configured",
        );
      const publicDisplayName = validDisplayName(input.publicDisplayName);
      const activated = await repository.activateUser(
        userId,
        publicDisplayName,
        [
          { policy: "privacy", version: privacyPolicyVersion },
          { policy: "community", version: communityRulesVersion },
        ],
      );
      if (activated) return activated;
      const current = await repository.findUser(userId);
      throw (
        statusError(current) ??
        new AccountWriteError(
          "onboarding-required",
          "Onboarding is already complete",
        )
      );
    },

    async updateAccount(userId: string, input: { publicDisplayName: string }) {
      const publicDisplayName = validDisplayName(input.publicDisplayName);
      const updated = await repository.updateDisplayName(
        userId,
        publicDisplayName,
      );
      if (updated) return updated;
      const error = statusError(await repository.findUser(userId));
      if (error) throw error;
      throw new Error("Active User account update did not complete");
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
