import type { SignalSummary, SignalTarget } from "@/lib/contributions/signals";
import { setEmojiSignal, setThumbsSignal } from "./actions";

const emojiChoices = [
  ["love", "❤️", "Love"],
  ["laugh", "😂", "Laugh"],
  ["surprised", "😮", "Surprised"],
  ["confused", "😕", "Confused"],
  ["sad", "😢", "Sad"],
  ["angry", "😡", "Angry"],
  ["fire", "🔥", "Fire"],
] as const;

function TargetFields({ target }: { target: SignalTarget }) {
  return (
    <>
      <input name="targetType" type="hidden" value={target.type} />
      {target.type === "course" ? (
        <>
          <input
            name="coursePrefix"
            type="hidden"
            value={target.coursePrefix}
          />
          <input
            name="courseNumber"
            type="hidden"
            value={target.courseNumber}
          />
        </>
      ) : target.type === "instructor" ? (
        <input
          name="instructorUuid"
          type="hidden"
          value={target.instructorUuid}
        />
      ) : (
        <input name="reviewId" type="hidden" value={target.reviewId} />
      )}
    </>
  );
}

export function SignalControls({
  target,
  summary,
  signedIn,
  unavailable = false,
  error,
  id = "signals",
}: {
  target: SignalTarget;
  summary?: SignalSummary;
  signedIn: boolean;
  unavailable?: boolean;
  error?: string;
  id?: string;
}) {
  if (unavailable || !summary)
    return (
      <div
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        id={id}
        role="status"
      >
        Community signals are unavailable. This does not represent zero signals.
      </div>
    );
  const mine = summary.mine ?? { thumbs: "none" as const, emoji: [] };
  return (
    <div className="text-left" id={id}>
      {error ? (
        <p
          className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900"
          role="alert"
        >
          Signal could not be updated ({error}).
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600">
            Reactions
          </p>
        </div>
        {!signedIn ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
            Sign in to respond
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2">
        {(["up", "down"] as const).map((state) => {
          const selected = mine.thumbs === state;
          const count = summary.thumbs[state];
          return (
            <form action={setThumbsSignal} key={state}>
              <TargetFields target={target} />
              <input
                name="state"
                type="hidden"
                value={selected ? "none" : state}
              />
              <button
                aria-label={`Thumbs ${state} · ${count}`}
                aria-pressed={selected}
                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  selected
                    ? state === "up"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-rose-300 bg-rose-50 text-rose-800"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
                type="submit"
              >
                {state === "up" ? "👍" : "👎"} {count}
              </button>
            </form>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {emojiChoices.map(([code, emoji, label]) => {
          const selected = mine.emoji.includes(code);
          const count = summary.emoji[code];
          return (
            <form action={setEmojiSignal} key={code}>
              <TargetFields target={target} />
              <input name="code" type="hidden" value={code} />
              <input name="selected" type="hidden" value={String(!selected)} />
              <button
                aria-label={`${label} · ${count}`}
                aria-pressed={selected}
                className={`min-h-11 rounded-full border px-3 py-2 text-sm ${
                  selected
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white"
                }`}
                type="submit"
              >
                {emoji} <span className="text-xs text-slate-700">{count}</span>
              </button>
            </form>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        The identities of reactors are always hidden.
      </p>
    </div>
  );
}
