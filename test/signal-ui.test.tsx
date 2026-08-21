import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

const summary = {
  thumbs: { up: 12, down: 3 },
  emoji: {
    love: 7,
    laugh: 2,
    surprised: 1,
    confused: 4,
    sad: 0,
    angry: 1,
    fire: 8,
  },
  mine: { thumbs: "up" as const, emoji: ["love" as const, "fire" as const] },
};

test("signal controls expose separate accessible aggregates and only current desired state", async () => {
  const { SignalControls } = await import("@/app/signals/signal-controls");
  const markup = renderToStaticMarkup(
    <SignalControls
      signedIn
      summary={summary}
      target={{
        type: "course",
        coursePrefix: "COMP",
        courseNumber: "2000",
      }}
    />,
  );

  expect(markup).toContain("Reactions");
  expect(markup).toContain("The identities of reactors are always hidden.");
  expect(markup).not.toContain("Signal updated.");
  expect(markup).not.toContain("Separate from ranking scores");
  expect(markup).toContain('aria-label="Thumbs up · 12"');
  expect(markup).toContain('aria-label="Thumbs down · 3"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain("❤️");
  expect(markup).toContain("🔥");
  expect(markup).not.toContain("userId");
  expect(markup).not.toContain("participant");
});

test("public signal controls show aggregates, invite sign-in, and distinguish unavailability from zero", async () => {
  const { SignalControls } = await import("@/app/signals/signal-controls");
  const publicMarkup = renderToStaticMarkup(
    <SignalControls
      signedIn={false}
      summary={{ ...summary, mine: undefined }}
      target={{
        type: "instructor",
        instructorUuid: "00000000-0000-4000-8000-000000000001",
      }}
    />,
  );
  expect(publicMarkup).toContain("Sign in to respond");
  expect(publicMarkup).toContain("12");

  const unavailable = renderToStaticMarkup(
    <SignalControls
      signedIn={false}
      target={{
        type: "instructor",
        instructorUuid: "00000000-0000-4000-8000-000000000001",
      }}
      unavailable
    />,
  );
  expect(unavailable).toContain("Community signals are unavailable");
  expect(unavailable).toContain("does not represent zero signals");
});
