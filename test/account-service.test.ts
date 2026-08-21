import { expect, test } from "bun:test";
import { HKUST_CONNECT_ISSUER } from "@/lib/auth/policy";
import {
  type AccountRepository,
  type AccountRow,
  AccountWriteError,
  createAccountService,
  type EstablishIdentityInput,
} from "@/lib/contributions/accounts";

class MemoryAccountRepository implements AccountRepository {
  users = new Map<string, AccountRow>();
  identities = new Map<
    string,
    { userId: string; name: string | null; email: string | null }
  >();
  acceptances: Array<{ userId: string; policy: string; version: string }> = [];
  nextId = 1;

  async establishIdentity(input: EstablishIdentityInput) {
    const key = `${input.issuer}\u0000${input.subject}`;
    const existing = this.identities.get(key);
    if (existing) {
      existing.name = input.profileName;
      existing.email = input.profileEmail;
      const user = this.users.get(existing.userId);
      if (!user) throw new Error("Memory repository identity is orphaned");
      return user;
    }
    const user: AccountRow = {
      id: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`,
      status: "onboarding",
      publicDisplayName: input.suggestedDisplayName,
    };
    this.users.set(user.id, user);
    this.identities.set(key, {
      userId: user.id,
      name: input.profileName,
      email: input.profileEmail,
    });
    return user;
  }

  async findUser(userId: string) {
    return this.users.get(userId);
  }

  async activateUser(
    userId: string,
    publicDisplayName: string,
    acceptances: Array<{ policy: "privacy" | "community"; version: string }>,
  ) {
    const user = this.users.get(userId);
    if (user?.status !== "onboarding") return undefined;
    user.publicDisplayName = publicDisplayName;
    user.status = "active";
    this.acceptances.push(
      ...acceptances.map((acceptance) => ({ userId, ...acceptance })),
    );
    return user;
  }

  async closeAccount(userId: string) {
    const user = this.users.get(userId);
    if (!user) return undefined;
    user.status = "closed";
    return user;
  }

  async updateDisplayName(userId: string, publicDisplayName: string) {
    const user = this.users.get(userId);
    if (user?.status !== "active") return undefined;
    user.publicDisplayName = publicDisplayName;
    return user;
  }
}

function setup() {
  const repository = new MemoryAccountRepository();
  return {
    repository,
    accounts: createAccountService(repository, {
      privacyPolicyVersion: "privacy-test-v1",
      communityRulesVersion: "community-test-v1",
    }),
  };
}

test("a verified External Identity creates one immutable User and refreshes mutable profile data", async () => {
  const { repository, accounts } = setup();
  const first = await accounts.establishUser({
    iss: HKUST_CONNECT_ISSUER,
    sub: "subject-1",
    name: "  Student  Name ",
    email: "old@connect.ust.hk",
  });
  const again = await accounts.establishUser({
    iss: HKUST_CONNECT_ISSUER,
    sub: "subject-1",
    name: "Student New Name",
    email: "new@connect.ust.hk",
  });

  expect(again.id).toBe(first.id);
  expect(first.status).toBe("onboarding");
  expect(first.publicDisplayName).toBe("Student Name");
  expect(repository.users.size).toBe(1);
  expect(repository.identities.values().next().value).toMatchObject({
    userId: first.id,
    name: "Student New Name",
    email: "new@connect.ust.hk",
  });
});

test("onboarding requires current policy acceptance and a valid Public Display Name", async () => {
  const { repository, accounts } = setup();
  const user = await accounts.establishUser({
    iss: HKUST_CONNECT_ISSUER,
    sub: "subject-2",
    name: "Student",
  });

  await expect(accounts.requireActiveUser(user.id)).rejects.toMatchObject({
    code: "onboarding-required",
  });
  await expect(
    accounts.completeOnboarding(user.id, {
      publicDisplayName: "Confirmed Name",
      acceptPrivacy: true,
      acceptCommunity: false,
    }),
  ).rejects.toMatchObject({ code: "acceptance-required" });

  const active = await accounts.completeOnboarding(user.id, {
    publicDisplayName: "  Confirmed   Name  ",
    acceptPrivacy: true,
    acceptCommunity: true,
  });
  expect(active).toMatchObject({
    id: user.id,
    status: "active",
    publicDisplayName: "Confirmed Name",
  });
  expect(repository.acceptances).toEqual([
    { userId: user.id, policy: "privacy", version: "privacy-test-v1" },
    { userId: user.id, policy: "community", version: "community-test-v1" },
  ]);
  expect(await accounts.requireActiveUser(user.id)).toMatchObject(active);
});

test("account edits and every write resolve current User status", async () => {
  const { repository, accounts } = setup();
  const user = await accounts.establishUser({
    iss: HKUST_CONNECT_ISSUER,
    sub: "subject-3",
    name: "Student",
  });
  await accounts.completeOnboarding(user.id, {
    publicDisplayName: "Active Student",
    acceptPrivacy: true,
    acceptCommunity: true,
  });
  expect(
    await accounts.updateAccount(user.id, { publicDisplayName: "Future Name" }),
  ).toMatchObject({ publicDisplayName: "Future Name" });

  const storedUser = repository.users.get(user.id);
  if (!storedUser) throw new Error("Test User was not stored");
  storedUser.status = "suspended";
  await expect(accounts.requireActiveUser(user.id)).rejects.toMatchObject({
    code: "account-suspended",
  });
  await expect(
    accounts.updateAccount(user.id, { publicDisplayName: "Bypassed" }),
  ).rejects.toBeInstanceOf(AccountWriteError);
  expect(repository.users.get(user.id)?.publicDisplayName).toBe("Future Name");

  storedUser.status = "closed";
  await expect(accounts.requireActiveUser(user.id)).rejects.toMatchObject({
    code: "account-closed",
  });
});

test("account closure sets closed status and blocks later writes", async () => {
  const { accounts, repository } = setup();
  const user = await accounts.establishUser({
    iss: HKUST_CONNECT_ISSUER,
    sub: "closure-subject",
    name: "Closing Student",
  });
  await accounts.completeOnboarding(user.id, {
    publicDisplayName: "Closing Student",
    acceptPrivacy: true,
    acceptCommunity: true,
  });
  expect(await accounts.closeAccount(user.id)).toMatchObject({
    id: user.id,
    status: "closed",
  });
  expect(repository.users.get(user.id)?.status).toBe("closed");
  await expect(accounts.requireActiveUser(user.id)).rejects.toMatchObject({
    code: "account-closed",
  });
  await expect(
    accounts.updateAccount(user.id, { publicDisplayName: "After Close" }),
  ).rejects.toBeInstanceOf(AccountWriteError);
});
