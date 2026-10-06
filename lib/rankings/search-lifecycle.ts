"use client";

let searchIntent = 0;

export function beginSearchNavigation() {
  searchIntent += 1;
}

export function currentSearchIntent() {
  return searchIntent;
}
