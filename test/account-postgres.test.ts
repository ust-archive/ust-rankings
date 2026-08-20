import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { HKUST_CONNECT_ISSUER } from "@/lib/auth/policy";
import { createAccountService } from "@/lib/contributions/accounts";

mock.module("server-only", () => ({}));

const connection = process.env.TEST_CONTRIBUTIONS_POSTGRES_URL;

if (!connection) {
  test.skip("account PostgreSQL contract (TEST_CONTRIBUTIONS_POSTGRES_URL is not configured)", () => {});
} else {
  test("account PostgreSQL contract preserves identity uniqueness and current status", async () => {
    const schema = `account_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = postgres(connection, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const sql = postgres(connection, {
      max: 2,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    try {
      await sql.unsafe(
        await readFile(
          join(
            process.cwd(),
            "contributions",
            "migrations",
            "0001_accounts.sql",
          ),
          "utf8",
        ),
      );
      const { PostgresAccountRepository } = await import(
        "@/lib/contributions/postgres"
      );
      const accounts = createAccountService(
        new PostgresAccountRepository(sql),
        {
          privacyPolicyVersion: "privacy-test-v1",
          communityRulesVersion: "community-test-v1",
        },
      );
      const claims = {
        iss: HKUST_CONNECT_ISSUER,
        sub: "postgres-subject",
        name: "Database Student",
        email: "student@connect.ust.hk",
      };
      const [first, concurrent] = await Promise.all([
        accounts.establishUser(claims),
        accounts.establishUser({ ...claims, name: "Current Profile Name" }),
      ]);
      expect(concurrent.id).toBe(first.id);
      const [userCount] = await sql<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM contribution_users`;
      expect(userCount?.count).toBe(1);

      await accounts.completeOnboarding(first.id, {
        publicDisplayName: "Public Student",
        acceptPrivacy: true,
        acceptCommunity: true,
      });
      await sql`UPDATE contribution_users SET status = 'suspended' WHERE id = ${first.id}`;
      await expect(accounts.requireActiveUser(first.id)).rejects.toMatchObject({
        code: "account-suspended",
      });
      let bindingError: unknown;
      try {
        await sql`UPDATE external_identities SET user_id = ${crypto.randomUUID()} WHERE issuer = ${HKUST_CONNECT_ISSUER}`;
      } catch (error) {
        bindingError = error;
      }
      expect(String(bindingError)).toContain(
        "External Identity bindings are immutable",
      );
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  });
}
