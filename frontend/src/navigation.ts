import type { NavigateFunction } from "react-router-dom";

export function goBack(navigate: NavigateFunction, fallback: string) {
  if (typeof window.history.state?.idx === "number" && window.history.state.idx > 0)
    navigate(-1);
  else navigate(fallback);
}
