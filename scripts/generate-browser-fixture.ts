import { seedBrowserContributions } from "../test/browser-contributions-fixture.ts";
import { generateBrowserFixtures } from "../test/browser-fixture.ts";

await Promise.all([generateBrowserFixtures(), seedBrowserContributions()]);
