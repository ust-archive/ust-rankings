import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

test("privacy page states community rules, post-publication moderation, and one reconsideration contact", async () => {
  const { default: PrivacyPage } = await import("@/app/privacy/page");
  const markup = renderToStaticMarkup(<PrivacyPage />);
  expect(markup).toContain("Critical but civil");
  expect(markup).toContain("no premoderation queue");
  expect(markup).toContain("Doxxing");
  expect(markup).toContain("Harassment");
  expect(markup).toContain("Malicious files");
  expect(markup).toContain("Reporter identity stays private");
  expect(markup).toContain("no public moderation log");
  expect(markup).toContain("no website Moderator or Administrator role");
  expect(markup).toContain("reconsideration");
  expect(markup).toContain("ust-rankings@flandia.dev");
});
