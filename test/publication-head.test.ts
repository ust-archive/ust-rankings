import { expect, test } from "vitest";
import { checkPublicationHead } from "@/scripts/check-publication-head";

const old = "a".repeat(40);
const newer = "b".repeat(40);

test("late old CI and branch advancement cannot authorize publication", async () => {
  let head = old;
  const git = async (args: string[]) => {
    if (args.join(" ") === "rev-parse HEAD") return `${old}\n`;
    if (args.join(" ") === "ls-remote origin refs/heads/master")
      return `${head}\trefs/heads/master\n`;
    throw new Error("Unexpected Git query");
  };
  expect(await checkPublicationHead(old, git)).toBe(true);
  head = newer;
  expect(await checkPublicationHead(old, git)).toBe(false);
  expect(await checkPublicationHead(old, git)).toBe(false);
  const newCheckout = async (args: string[]) =>
    args[0] === "rev-parse" ? `${newer}\n` : `${head}\trefs/heads/master\n`;
  expect(await checkPublicationHead(newer, newCheckout)).toBe(true);
});

test("publication head verification fails closed on invalid or unavailable Git state", async () => {
  await expect(checkPublicationHead("main")).rejects.toThrow(
    "Invalid tested SHA",
  );
  await expect(checkPublicationHead(old, async () => newer)).rejects.toThrow(
    "Checkout does not match",
  );
  for (const remote of [
    "",
    `${old}\trefs/heads/other`,
    `${old}\trefs/heads/master\n${newer}\trefs/heads/master`,
    "malformed",
  ])
    await expect(
      checkPublicationHead(old, async (args) =>
        args[0] === "rev-parse" ? old : remote,
      ),
    ).rejects.toThrow("Invalid current master response");
  await expect(
    checkPublicationHead(old, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
});
