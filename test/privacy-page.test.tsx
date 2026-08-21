import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => {
  delete process.env.PRIVACY_CONTACT_TITLE;
  delete process.env.PRIVACY_CONTACT_EMAIL;
  delete process.env.PRIVACY_CONTACT_ADDRESS;
});

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
  expect(markup).toContain("Identity hidden");
  expect(markup).toContain("account closure");
  expect(markup).toContain("no self-service");
  expect(markup).toContain("Privacy Contact");
  expect(markup).toContain("Operator");
  expect(markup).toContain("Required for an account");
  expect(markup).toContain("Voluntary");
  expect(markup).toContain("Retention follows those purposes");
});

test("privacy page publishes configured Privacy Contact title, email, and address", async () => {
  process.env.PRIVACY_CONTACT_TITLE = "Data protection contact";
  process.env.PRIVACY_CONTACT_EMAIL = "privacy@example.test";
  process.env.PRIVACY_CONTACT_ADDRESS = "Correspondence in Hong Kong";
  const { default: PrivacyPage } = await import("@/app/privacy/page");
  const markup = renderToStaticMarkup(<PrivacyPage />);
  expect(markup).toContain("Data protection contact");
  expect(markup).toContain("privacy@example.test");
  expect(markup).toContain("Correspondence in Hong Kong");
});
