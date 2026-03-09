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
  providerResults?: ProviderSummaryData[];
  merged?: MergedSummaryData;
};

export type SummaryRecordFile = {
  id: string;
  createdAt: string;
  provider: "terminal" | "local";
  dateKey: string;
  summary: string;
  providerResults?: ProviderSummaryData[];
  merged?: MergedSummaryData;
};

export type RollupPeriod = "week" | "month";

export type SummaryRollup = {
  id: string;
  createdAt: string;
  period: RollupPeriod;
  periodKey: string;
  startDateKey: string;
  endDateKey: string;
  sourceDateKeys: string[];
  summary: string;
  merged?: MergedSummaryData;
};

export type SummaryRollupFile = SummaryRollup;

export type SummaryEvidenceItem = {
  time: string;
  source: string;
  text: string;
};

export type ProviderSummaryData = {
  version: "1";
  provider: string;
  dateKey: string;
  oneLineSummary: string;
  doneTodos: string[];
  workLogs: string[];
  issues: string[];
  evidence: SummaryEvidenceItem[];
};

export type MergedSummaryData = {
  version: "1";
  dateKey: string;
  connectedProviders: string[];
  dailySummary: string;
  doneTodos: string[];
  workLogs: string[];
  issues: string[];
  evidence: SummaryEvidenceItem[];
  contexts: SummaryContextData[];
};

export type SummaryContextData = {
  name: string;
  summary: string;
  doneTodos: string[];
  workLogs: string[];
  issues: string[];
  evidence: SummaryEvidenceItem[];
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
