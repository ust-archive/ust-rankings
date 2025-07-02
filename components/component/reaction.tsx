"use client";

import { cn } from "@/lib/utils";
import { Emoji } from "emoji-picker-react";
import dynamic from "next/dynamic";
import {
  HTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocalStorage } from "react-use";

const EmojiPicker = dynamic(
  () => {
    return import("emoji-picker-react");
  },
  { ssr: false },
);

export interface ReactionProps extends HTMLAttributes<HTMLDivElement> {
  id: string;

  variant?: "simple" | "full";
}

export function Reaction(props: ReactionProps) {
  const { id, variant = "simple", className, ...rest } = props;

  const [updating, setUpdating] = useState(false);
  const updatingRef = useRef(updating);

  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [ownReactions, setOwnReactions] = useLocalStorage<
    Record<string, boolean>
  >(`reaction.${id}`, {});

  const fetchReactions = useCallback(async () => {
    updatingRef.current = true;
    setUpdating(updatingRef.current);
    try {
      const response = await fetch(`/api/reaction/${id}`);
      const data = await response.json();
      setReactions(data);
    } finally {
      updatingRef.current = false;
      setUpdating(updatingRef.current);
    }
  }, [id]);

  useEffect(() => {
    void fetchReactions();
  }, [fetchReactions]);

  const onReact = async (unified: string) => {
    console.log(unified);
    if (updatingRef.current) return;
    updatingRef.current = true;
    setUpdating(updatingRef.current);
    try {
      setOwnReactions({
        ...ownReactions,
        [unified]: !ownReactions?.[unified],
      });
      await fetch(`/api/reaction/${id}`, {
        method: "POST",
        body: JSON.stringify({
          unified,
          delta: ownReactions?.[unified] ? -1 : +1,
        }),
      });
      await fetchReactions();
    } finally {
      updatingRef.current = false;
      setUpdating(updatingRef.current);
    }
  };

  return (
    <div
      className={cn(
        "flex select-none flex-wrap gap-2",
        updating && "pointer-events-none cursor-not-allowed opacity-50",
        className,
      )}
      {...rest}
    >
      <EmojiPicker
        reactionsDefaultOpen
        allowExpandReactions={false}
        onReactionClick={(emojiData) => void onReact(emojiData.unified)}
        {...(variant === "simple"
          ? {
              reactions: ["1f44d", "1f44e"],
            }
          : {})}
      />
      {Object.entries(reactions).map(([unified, count]) => (
        <span
          key={unified}
          className={cn(
            "pointer-events-none my-0.5 flex w-fit items-center gap-2 rounded-full border px-2 text-gray-500 dark:text-gray-400",
            ownReactions?.[unified] &&
              "pointer-events-auto cursor-pointer border-blue-200 bg-blue-50",
          )}
          onClick={() => {
            if (ownReactions?.[unified]) {
              void onReact(unified);
            }
          }}
        >
          <Emoji unified={unified} size={16} />
          <span>{count}</span>
        </span>
      ))}
    </div>
  );
}
