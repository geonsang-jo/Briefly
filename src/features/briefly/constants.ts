import type { ProfileConfig } from "@/features/briefly/types";
import claudeImg from "@/assets/claude-color.png";
import codexImg from "@/assets/codex-color.png";
import cursorImg from "@/assets/cursor-ai.png";
import geminiImg from "@/assets/gemini-color.png";

export const PATH_PROVIDERS = [
  { key: "claude", label: "Claude", img: claudeImg },
  { key: "codex", label: "Codex", img: codexImg },
  { key: "cursor", label: "Cursor", img: cursorImg },
  { key: "gemini", label: "Gemini", img: geminiImg },
] as const;

export const ONBOARDING_STEP_LABELS = ["Name", "Path Search"] as const;

export const PROFILE_STORAGE_KEY = "briefly.profile.v3";
export const RECORD_STORAGE_KEY = "briefly.records.v2";
export const ROLLUP_STORAGE_KEY = "briefly.rollups.v1";

export const EMPTY_PROFILE: ProfileConfig = {
  name: "",
  finishCommand: "",
  autoSummarizeOnFinish: false,
  collectFromLocalLogs: true,
  codexRootPath: "",
  claudeRootPath: "",
  cursorRootPath: "",
  geminiRootPath: "",
};
