import type React from "react";

export function stopPropagation(e: React.UIEvent) {
  e.stopPropagation();
}
