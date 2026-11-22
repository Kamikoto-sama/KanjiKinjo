import type { Config } from "./types";

type SetupDraft = Config & {
  selectedType?: number;
  entryKey?: string;
  baseConfig?: string | null;
};

export function readSetupDraft(): SetupDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem("setupDraft") || "null");
  } catch {
    return null;
  }
}
