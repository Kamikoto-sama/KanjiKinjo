import type { NavigateFunction } from "react-router-dom";

export function canGoBack() {
  const index = window.history.state?.idx;
  return typeof index === "number" && index > 0;
}

export function goBack(navigate: NavigateFunction, fallback: string) {
  if (canGoBack()) navigate(-1);
  else navigate(fallback);
}
