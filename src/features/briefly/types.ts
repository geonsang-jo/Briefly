export type AppView = "home" | "settings" | "archive";

export type ProfileConfig = {
  name: string;
  finishCommand: string;
  autoSummarizeOnFinish: boolean;
  collectFromLocalLogs: boolean;
  codexRootPath: string;
  claudeRootPath: string;
  cursorRootPath: string;
  geminiRootPath: string;
};

export type SummaryRecord = {
  id: string;
  createdAt: string;
  provider: "terminal" | "local";
  summary: string;
  conversation: string;
  dateKey?: string;
};

export type SummaryRecordFile = {
  id: string;
  createdAt: string;
  provider: "terminal" | "local";
  dateKey: string;
  summary: string;
};

export type FinishCommandResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type AutoConversationResult = {
  conversation: string;
  messageCount: number;
  sources: string[];
};

export type PathCheckStatus = {
  label: string;
  resolvedPath: string;
  exists: boolean;
  hasJsonl: boolean;
};

export type PathProviderKey = "claude" | "codex" | "cursor" | "gemini";

export type DetectLogPathsResult = {
  codex: PathCheckStatus;
  claude: PathCheckStatus;
  cursor: PathCheckStatus;
  gemini: PathCheckStatus;
};

export type FeedbackTone = "normal" | "error";

export type PathStatusMeta = {
  label: string;
  badgeClass: string;
  icon: "ok" | "warn" | "none";
};
