import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      displayName?: string;
      onboarded: boolean;
    } & Omit<NonNullable<DefaultSession["user"]>, "name" | "email" | "image">;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    displayName?: string;
    onboarded?: boolean;
  }
}
