import type { ReactNode } from "react";
import { LoginLink } from "@/app/auth/login-link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SignalSummary, SignalTarget } from "@/lib/contributions/signals";
import { cn } from "@/lib/utils";
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

function ReactionTooltip({
  children,
  signedIn,
}: {
  children: ReactNode;
  signedIn: boolean;
}) {
  if (signedIn) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="px-2 py-1 text-xs" sideOffset={2}>
        login to react
      </TooltipContent>
    </Tooltip>
  );
}

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
  size = "default",
}: {
  target: SignalTarget;
  summary?: SignalSummary;
  signedIn: boolean;
  unavailable?: boolean;
  error?: string;
  id?: string;
  size?: "default" | "sm";
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
    <TooltipProvider delayDuration={100}>
      <div className="text-left" id={id}>
        {error ? (
          <p
            className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900"
            role="alert"
          >
            Signal could not be updated ({error}).
          </p>
        ) : null}
        {size === "default" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-600">
              Reactions
            </p>
            {!signedIn ? <LoginLink>Login to react</LoginLink> : null}
          </div>
        ) : null}
        <div className={cn(size === "sm" && "flex flex-wrap gap-1")}>
          <div className={cn(size === "sm" ? "contents" : "mt-4 flex gap-2")}>
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
                  <ReactionTooltip signedIn={signedIn}>
                    <button
                      aria-label={`Thumbs ${state} · ${count}`}
                      aria-pressed={selected}
                      className={cn(
                        "border font-semibold disabled:cursor-not-allowed disabled:opacity-60",
                        size === "sm"
                          ? "min-h-8 rounded-full px-2 py-0.5 text-xs"
                          : "min-h-11 rounded-xl px-3 py-2 text-sm",
                        selected
                          ? state === "up"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-rose-300 bg-rose-50 text-rose-800"
                          : "border-slate-200 bg-white text-slate-700",
                      )}
                      disabled={!signedIn}
                      type="submit"
                    >
                      {state === "up" ? "👍" : "👎"} {count}
                    </button>
                  </ReactionTooltip>
                </form>
              );
            })}
          </div>
          <div
            className={cn(
              size === "sm" ? "contents" : "mt-3 flex flex-wrap gap-1.5",
            )}
          >
            {emojiChoices.map(([code, emoji, label]) => {
              const selected = mine.emoji.includes(code);
              const count = summary.emoji[code];
              return (
                <form action={setEmojiSignal} key={code}>
                  <TargetFields target={target} />
                  <input name="code" type="hidden" value={code} />
                  <input
                    name="selected"
                    type="hidden"
                    value={String(!selected)}
                  />
                  <ReactionTooltip signedIn={signedIn}>
                    <button
                      aria-label={`${label} · ${count}`}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-full border disabled:cursor-not-allowed disabled:opacity-60",
                        size === "sm"
                          ? "min-h-8 px-2 py-0.5 text-xs"
                          : "min-h-11 px-3 py-2 text-sm",
                        selected
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white",
                      )}
                      disabled={!signedIn}
                      type="submit"
                    >
                      {emoji}{" "}
                      <span className="text-xs text-slate-700">{count}</span>
                    </button>
                  </ReactionTooltip>
                </form>
              );
            })}
          </div>
        </div>
        {size === "default" ? (
          <p className="mt-3 text-xs text-slate-500">
            The identities of reactors are always hidden.
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
