import "server-only";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  type AccountRepository,
  type AccountRow,
  createAccountService,
  type EstablishIdentityInput,
} from "./accounts";

type AccountDatabaseRow = {
  id: string;
  status: AccountRow["status"];
  publicDisplayName: string | null;
};

function account(row: AccountDatabaseRow): AccountRow {
  return {
    id: row.id,
    status: row.status,
    publicDisplayName: row.publicDisplayName,
  };
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async establishIdentity(input: EstablishIdentityInput) {
    return this.sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${input.issuer}, 43) # hashtextextended(${input.subject}, 44)
        )
      `;
      const [existing] = await transaction<AccountDatabaseRow[]>`
        SELECT u.id, u.status, u.public_display_name AS "publicDisplayName"
        FROM external_identities i
        JOIN contribution_users u ON u.id = i.user_id
        WHERE i.issuer = ${input.issuer} AND i.subject = ${input.subject}
      `;
      if (existing) {
        await transaction`
          UPDATE external_identities
          SET profile_name = ${input.profileName},
              profile_email = ${input.profileEmail},
              updated_at = now()
          WHERE issuer = ${input.issuer} AND subject = ${input.subject}
        `;
        return account(existing);
      }

      const userId = randomUUID();
      const [created] = await transaction<AccountDatabaseRow[]>`
        INSERT INTO contribution_users (id, public_display_name)
        VALUES (${userId}, ${input.suggestedDisplayName})
        RETURNING id, status, public_display_name AS "publicDisplayName"
      `;
      await transaction`
        INSERT INTO external_identities (
          issuer, subject, user_id, profile_name, profile_email
        ) VALUES (
          ${input.issuer}, ${input.subject}, ${userId},
          ${input.profileName}, ${input.profileEmail}
        )
      `;
      return account(created);
    });
  }

  async findUser(userId: string) {
    const [row] = await this.sql<AccountDatabaseRow[]>`
      SELECT id, status, public_display_name AS "publicDisplayName"
      FROM contribution_users
      WHERE id = ${userId}
    `;
    return row ? account(row) : undefined;
  }

  async activateUser(
    userId: string,
    publicDisplayName: string,
    acceptances: Array<{
      policy: "privacy" | "community";
      version: string;
    }>,
  ) {
    return this.sql.begin(async (transaction) => {
      const [current] = await transaction<AccountDatabaseRow[]>`
        SELECT id, status, public_display_name AS "publicDisplayName"
        FROM contribution_users
        WHERE id = ${userId}
        FOR UPDATE
      `;
      if (current?.status !== "onboarding") return undefined;
      for (const acceptance of acceptances) {
        await transaction`
          INSERT INTO policy_acceptances (user_id, policy, version)
          VALUES (${userId}, ${acceptance.policy}, ${acceptance.version})
          ON CONFLICT DO NOTHING
        `;
      }
      const [updated] = await transaction<AccountDatabaseRow[]>`
        UPDATE contribution_users
        SET public_display_name = ${publicDisplayName},
            status = 'active',
            updated_at = now()
        WHERE id = ${userId} AND status = 'onboarding'
        RETURNING id, status, public_display_name AS "publicDisplayName"
      `;
      return updated ? account(updated) : undefined;
    });
  }

  async updateDisplayName(userId: string, publicDisplayName: string) {
    const [row] = await this.sql<AccountDatabaseRow[]>`
      UPDATE contribution_users
      SET public_display_name = ${publicDisplayName}, updated_at = now()
      WHERE id = ${userId} AND status = 'active'
      RETURNING id, status, public_display_name AS "publicDisplayName"
    `;
    return row ? account(row) : undefined;
  }
}

let runtime:
  | {
      sql: ReturnType<typeof postgres>;
      accounts: ReturnType<typeof createAccountService>;
    }
  | undefined;

export function getAccountService() {
  if (runtime) return runtime.accounts;
  const connection = process.env.CONTRIBUTIONS_POSTGRES_URL;
  if (!connection)
    throw new Error("CONTRIBUTIONS_POSTGRES_URL is not configured");
  const sql = postgres(connection, { max: 5 });
  runtime = {
    sql,
    accounts: createAccountService(new PostgresAccountRepository(sql), {
      privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION,
      communityRulesVersion: process.env.COMMUNITY_RULES_VERSION,
    }),
  };
  return runtime.accounts;
}

export async function closeAccountRuntimeForTests() {
  if (!runtime) return;
  const current = runtime;
  runtime = undefined;
  await current.sql.end();
}
