import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArchiveView } from "@/features/briefly/components/ArchiveView";
import { HomeView } from "@/features/briefly/components/HomeView";
import { MainHeader } from "@/features/briefly/components/MainHeader";
import { OnboardingScreen } from "@/features/briefly/components/OnboardingScreen";
import { SettingsView } from "@/features/briefly/components/SettingsView";
import {
  WrapUpTerminalSheet,
  type WrapUpLogKind,
  type WrapUpLogLine,
  type WrapUpRunStatus,
} from "@/features/briefly/components/WrapUpTerminalSheet";
import { EMPTY_PROFILE, PATH_PROVIDERS } from "@/features/briefly/constants";
import {
  clearOnboardingStorage,
  loadProfile,
  loadRecords,
  loadRollups,
  saveProfile,
  saveRecord,
  saveRollup,
} from "@/features/briefly/storage";
import {
  requestAutoCollectedConversation,
  requestDetectLogPaths,
  requestTerminalSummary,
} from "@/features/briefly/services";
import type {
  AppView,
  DetectLogPathsResult,
  FeedbackTone,
  MergedSummaryData,
  PathCheckStatus,
  PathProviderKey,
  ProfileConfig,
  ProviderSummaryData,
  RollupPeriod,
  SummaryContextData,
  SummaryEvidenceItem,
  SummaryRecord,
  SummaryRollup,
} from "@/features/briefly/types";
import {
  createLocalSummary,
  formatDateTime,
  getMonthKey,
  getPathStatusMeta,
  getWeekStartKey,
} from "@/features/briefly/utils";

const CHECK_SEQUENCE_KEYS: PathProviderKey[] = [
  "claude",
  "codex",
  "cursor",
  "gemini",
];
const PROVIDER_LABEL: Record<PathProviderKey, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
};
const DEFAULT_WRAPUP_COMMAND_BY_PROVIDER: Partial<
  Record<PathProviderKey, string>
> = {
  claude: "claude -p",
  codex: "codex exec --skip-git-repo-check -",
  gemini: "gemini -p",
};
const DEFAULT_CONTEXT_NAME = "General";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isPathProviderKey(value: string): value is PathProviderKey {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "gemini"
  );
}

function toLocalDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveProviderCommand(
  commandTemplate: string,
  provider: PathProviderKey,
): string {
  return commandTemplate
    .split("{provider}")
    .join(provider)
    .split("{ai}")
    .join(provider);
}

function extractSourceConversation(
  conversation: string,
  source: PathProviderKey,
): string {
  const pattern =
    /\[([^\]]+)\] \[([^\]]+)\] (user|assistant)\n([\s\S]*?)(?=\n\[[^\]]+\] \[[^\]]+\] (?:user|assistant)\n|$)/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(conversation)) !== null) {
    const sourceName = match[2]?.toLowerCase();
    if (sourceName !== source) continue;

    const timestamp = match[1] ?? "";
    const role = match[3] ?? "assistant";
    const text = (match[4] ?? "").trim();
    if (!text) continue;
    blocks.push(`[${timestamp}] [${source}] ${role}\n${text}`);
  }

  if (blocks.length === 0) return "";
  return `Today's ${PROVIDER_LABEL[source]} conversation logs\n\n${blocks.join("\n\n")}`;
}

function buildWrapUpPrompt(
  provider: PathProviderKey,
  conversation: string,
): string {
  return [
    "[BRIEFLY_WRAP_UP]",
    "You are Briefly's daily work summarizer.",
    "",
    "Task:",
    "- Summarize today's work ONLY from the provided conversation logs.",
    "- Write in Korean.",
    "- Be concrete, short, and action-oriented.",
    "",
    "Hard rules:",
    "- Do not invent facts.",
    '- If evidence is weak, mark it as "추정".',
    "- Merge duplicates.",
    "- Prefer outcomes over chat noise.",
    "- Keep each bullet to one sentence.",
    '- Prefix every bullet in "오늘 한 일 / 완료한 TODO / 이슈/메모 / 근거 로그" with a context tag: [Context] ...',
    "- Use short context names like [Briefly], [Work], [Personal], [Study].",
    `- If context is unclear, use [${DEFAULT_CONTEXT_NAME}].`,
    "- If logs clearly show completion (for example git push success or repository creation), classify it as completed TODO ([x]), not next TODO.",
    "",
    "Output format (must follow exactly):",
    "",
    "## 한 줄 요약",
    "- ...",
    "",
    "## 오늘 한 일",
    "- [Context] ...",
    "",
    "## 완료한 TODO",
    "- [x] [Context] ...",
    "",
    "## 이슈/메모",
    "- [Context] ...",
    "",
    "## 근거 로그",
    "- [HH:mm] [source] [Context] ...",
    "- [HH:mm] [source] [Context] ...",
    "",
    "If there is no meaningful work log, output:",
    "## 한 줄 요약",
    "- 오늘 작업 로그가 충분하지 않습니다.",
    "## 오늘 한 일",
    `- [${DEFAULT_CONTEXT_NAME}] 없음`,
    "## 완료한 TODO",
    "- [x] 없음",
    "## 이슈/메모",
    `- [${DEFAULT_CONTEXT_NAME}] 로그 데이터 부족`,
    "## 근거 로그",
    "- 없음",
    "",
    "Use only the conversation context below.",
    "",
    `Provider: ${PROVIDER_LABEL[provider]}`,
    "",
    conversation,
  ].join("\n");
}

function extractSectionBody(markdown: string, sectionTitle: string): string {
  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `##\\s*${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractBulletItems(sectionBody: string): string[] {
  if (!sectionBody.trim()) return [];
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-+\s*/, "").trim())
    .filter(Boolean);
}

function normalizeTodoItems(items: string[]): string[] {
  return items
    .map((item) => item.replace(/^\[(?:x|X|\s)\]\s*/, "").trim())
    .filter(Boolean);
}

function isPlaceholderItem(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "없음" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "-" ||
    normalized === "na"
  );
}

function normalizeCompareKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[x\s]\]/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ContextTaggedText = {
  context: string;
  text: string;
};

type ContextTaggedEvidence = SummaryEvidenceItem & {
  context: string;
};

function normalizeContextName(value: string): string {
  const cleaned = value
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return DEFAULT_CONTEXT_NAME;
  return cleaned.slice(0, 32);
}

function parseContextTaggedText(value: string): ContextTaggedText {
  const text = value.trim();
  if (!text) {
    return { context: DEFAULT_CONTEXT_NAME, text: "" };
  }

  const matched = text.match(/^\[([^[\]]{1,40})\]\s*(.+)$/);
  if (!matched) {
    return { context: DEFAULT_CONTEXT_NAME, text };
  }

  return {
    context: normalizeContextName(matched[1] ?? ""),
    text: (matched[2] ?? "").trim(),
  };
}

function dedupeContextTaggedItems(items: ContextTaggedText[]): ContextTaggedText[] {
  const seen = new Set<string>();
  const output: ContextTaggedText[] = [];

  for (const item of items) {
    const key = `${normalizeCompareKey(item.context)}|${normalizeCompareKey(item.text)}`;
    if (!item.text || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function dedupeContextEvidenceItems(items: ContextTaggedEvidence[]): ContextTaggedEvidence[] {
  const seen = new Set<string>();
  const output: ContextTaggedEvidence[] = [];

  for (const item of items) {
    const key = [
      normalizeCompareKey(item.context),
      item.time.trim(),
      item.source.trim().toLowerCase(),
      normalizeCompareKey(item.text),
    ].join("|");

    if (!item.text.trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function contextSortKey(value: string): string {
  const key = normalizeCompareKey(value);
  return key || normalizeCompareKey(DEFAULT_CONTEXT_NAME);
}

function getContextSummary(item: SummaryContextData): string {
  return (
    item.doneTodos[0] ??
    item.workLogs[0] ??
    item.issues[0] ??
    "No details."
  );
}

function parseEvidenceItems(items: string[]): SummaryEvidenceItem[] {
  return items
    .map((item) => {
      const match = item.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(.*)$/);
      if (!match) {
        return {
          time: "",
          source: "",
          text: item.trim(),
        };
      }

      return {
        time: (match[1] ?? "").trim(),
        source: (match[2] ?? "").trim(),
        text: (match[3] ?? "").trim(),
      };
    })
    .filter((item) => item.text.length > 0 && !isPlaceholderItem(item.text));
}

function dedupeTextList(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(key);
  }

  return output;
}

function cleanList(items: string[]): string[] {
  return dedupeTextList(items.map((value) => value.trim()).filter(Boolean)).filter(
    (item) => !isPlaceholderItem(item),
  );
}

function dedupeEvidenceItems(items: SummaryEvidenceItem[]): SummaryEvidenceItem[] {
  const seen = new Set<string>();
  const output: SummaryEvidenceItem[] = [];

  for (const item of items) {
    const key = `${item.time}|${item.source}|${item.text}`;
    if (!item.text.trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseProviderSummaryData(
  provider: PathProviderKey,
  dateKey: string,
  summary: string,
): ProviderSummaryData {
  const oneLineItems = extractBulletItems(extractSectionBody(summary, "한 줄 요약"));
  const workLogs = extractBulletItems(extractSectionBody(summary, "오늘 한 일"));
  const doneTodosRaw = extractBulletItems(extractSectionBody(summary, "완료한 TODO"));
  const issues = extractBulletItems(extractSectionBody(summary, "이슈/메모"));
  const evidenceRaw = extractBulletItems(extractSectionBody(summary, "근거 로그"));

  return {
    version: "1",
    provider,
    dateKey,
    oneLineSummary: oneLineItems[0] ?? "",
    doneTodos: cleanList(normalizeTodoItems(doneTodosRaw)),
    workLogs: cleanList(workLogs),
    issues: cleanList(issues),
    evidence: dedupeEvidenceItems(parseEvidenceItems(evidenceRaw)),
  };
}

function buildMergedSummaryData(
  dateKey: string,
  connectedProviders: string[],
  providerResults: ProviderSummaryData[],
): MergedSummaryData {
  const oneLineList = dedupeTextList(
    providerResults.map((item) => item.oneLineSummary).filter(Boolean),
  );
  const doneTagged = dedupeContextTaggedItems(
    cleanList(providerResults.flatMap((item) => item.doneTodos))
      .map(parseContextTaggedText)
      .filter((item) => item.text.length > 0),
  );
  const doneTodos = dedupeTextList(doneTagged.map((item) => item.text));

  const workLogTagged = dedupeContextTaggedItems(
    cleanList(providerResults.flatMap((item) => item.workLogs))
      .map(parseContextTaggedText)
      .filter((item) => item.text.length > 0),
  );
  const issueTagged = dedupeContextTaggedItems(
    cleanList(providerResults.flatMap((item) => item.issues))
      .map(parseContextTaggedText)
      .filter((item) => item.text.length > 0),
  );

  const evidenceTagged = dedupeContextEvidenceItems(
    providerResults
      .flatMap((item) => item.evidence)
      .map((item) => {
        const tagged = parseContextTaggedText(item.text);
        return {
          ...item,
          context: tagged.context,
          text: tagged.text,
        };
      })
      .filter((item) => item.text.length > 0),
  );

  const contextMap = new Map<string, SummaryContextData>();
  const getContextBucket = (name: string): SummaryContextData => {
    const contextName = normalizeContextName(name);
    const key = contextSortKey(contextName);
    const existing = contextMap.get(key);
    if (existing) return existing;
    const created: SummaryContextData = {
      name: contextName,
      summary: "",
      doneTodos: [],
      workLogs: [],
      issues: [],
      evidence: [],
    };
    contextMap.set(key, created);
    return created;
  };

  doneTagged.forEach((item) => {
    getContextBucket(item.context).doneTodos.push(item.text);
  });
  workLogTagged.forEach((item) => {
    getContextBucket(item.context).workLogs.push(item.text);
  });
  issueTagged.forEach((item) => {
    getContextBucket(item.context).issues.push(item.text);
  });
  evidenceTagged.forEach((item) => {
    getContextBucket(item.context).evidence.push({
      time: item.time,
      source: item.source,
      text: item.text,
    });
  });

  const contexts = Array.from(contextMap.values())
    .map((context) => {
      const normalized: SummaryContextData = {
        ...context,
        doneTodos: cleanList(context.doneTodos),
        workLogs: cleanList(context.workLogs),
        issues: cleanList(context.issues),
        evidence: dedupeEvidenceItems(context.evidence),
      };
      normalized.summary = getContextSummary(normalized);
      return normalized;
    })
    .filter((context) => {
      return (
        context.doneTodos.length > 0 ||
        context.workLogs.length > 0 ||
        context.issues.length > 0 ||
        context.evidence.length > 0
      );
    })
    .sort((a, b) => {
      const aScore =
        a.doneTodos.length +
        a.workLogs.length +
        a.issues.length +
        a.evidence.length;
      const bScore =
        b.doneTodos.length +
        b.workLogs.length +
        b.issues.length +
        b.evidence.length;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });

  return {
    version: "1",
    dateKey,
    connectedProviders: dedupeTextList(connectedProviders),
    dailySummary: oneLineList[0] ?? "오늘 작업 로그가 충분하지 않습니다.",
    doneTodos,
    workLogs: dedupeTextList(workLogTagged.map((item) => item.text)),
    issues: dedupeTextList(issueTagged.map((item) => item.text)),
    evidence: dedupeEvidenceItems(
      evidenceTagged.map(({ time, source, text }) => ({ time, source, text })),
    ),
    contexts,
  };
}

function hasRepoPushCompletionEvidence(conversation: string): boolean {
  const normalized = conversation.toLowerCase();

  return [
    "to https://github.com",
    "new branch",
    "set up to track",
    "everything up-to-date",
    "repository created",
    "gh repo create",
    "main -> main",
    "forced update",
  ].some((token) => normalized.includes(token));
}

function isRepoPushTodoItem(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "github",
    "repo",
    "repository",
    "저장소",
    "push",
    "푸시",
    "origin",
    "main",
  ].some((token) => normalized.includes(token));
}

function normalizeWrapUpTodoStatus(
  summary: string,
  conversation: string,
): string {
  if (!summary.trim() || !hasRepoPushCompletionEvidence(conversation)) {
    return summary;
  }

  const lines = summary.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const uncheckedMatch = line.match(/^(\s*-\s)\[\s\](\s+)(.*)$/);
    if (!uncheckedMatch) {
      output.push(line);
      continue;
    }

    const itemText = (uncheckedMatch[3] ?? "").trim();
    if (!isRepoPushTodoItem(itemText)) {
      output.push(line);
      continue;
    }

    const checkedLine = `${uncheckedMatch[1]}[x]${uncheckedMatch[2]}${itemText}`;
    output.push(checkedLine);
  }
  return output.join("\n");
}

function resolveWrapUpCommand(
  provider: PathProviderKey,
  finishCommandTemplate: string,
): string | null {
  if (finishCommandTemplate.trim()) {
    return resolveProviderCommand(finishCommandTemplate, provider);
  }

  return DEFAULT_WRAPUP_COMMAND_BY_PROVIDER[provider] ?? null;
}

function extractErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    const line = error.message
      .split("\n")
      .map((value) => value.trim())
      .find(Boolean);
    if (!line) return "Unknown error";
    return line.length > 180 ? `${line.slice(0, 177)}...` : line;
  }

  const text = String(error ?? "Unknown error").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function createEmptyPathCheckStatus(label: string): PathCheckStatus {
  return {
    label,
    resolvedPath: "-",
    exists: false,
    hasJsonl: false,
  };
}

function buildPartialPathStatus(
  partial: Partial<DetectLogPathsResult>,
): DetectLogPathsResult {
  const lookup = new Map(
    PATH_PROVIDERS.map((provider) => [provider.key, provider.label]),
  );

  return {
    claude:
      partial.claude ??
      createEmptyPathCheckStatus(lookup.get("claude") ?? "Claude"),
    codex:
      partial.codex ??
      createEmptyPathCheckStatus(lookup.get("codex") ?? "Codex"),
    cursor:
      partial.cursor ??
      createEmptyPathCheckStatus(lookup.get("cursor") ?? "Cursor"),
    gemini:
      partial.gemini ??
      createEmptyPathCheckStatus(lookup.get("gemini") ?? "Gemini"),
  };
}

function normalizeProfile(profile: ProfileConfig): ProfileConfig {
  return {
    ...profile,
    name: profile.name.trim(),
    finishCommand: profile.finishCommand.trim(),
    codexRootPath: profile.codexRootPath.trim(),
    claudeRootPath: profile.claudeRootPath.trim(),
    cursorRootPath: profile.cursorRootPath.trim(),
    geminiRootPath: profile.geminiRootPath.trim(),
  };
}

function recordDateKey(record: SummaryRecord): string {
  if (record.dateKey && record.dateKey.trim()) return record.dateKey;
  return toLocalDateKey(record.createdAt);
}

function upsertRecordByDate(
  prev: SummaryRecord[],
  nextRecord: SummaryRecord,
): SummaryRecord[] {
  const nextDateKey = recordDateKey(nextRecord);
  const normalizedNext = {
    ...nextRecord,
    dateKey: nextDateKey,
  };

  return [normalizedNext, ...prev]
    .filter((item, index, array) => {
      const currentDateKey = recordDateKey(item);
      const firstIndex = array.findIndex(
        (candidate) => recordDateKey(candidate) === currentDateKey,
      );
      return firstIndex === index;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function parseDateKeyToDate(dateKey: string): Date | null {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateToKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function shiftDate(date: Date, days: number): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

function toMonthKey(dateKey: string): string | null {
  const parsed = parseDateKeyToDate(dateKey);
  if (!parsed) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function upsertRollupByPeriod(
  prev: SummaryRollup[],
  nextRollup: SummaryRollup,
): SummaryRollup[] {
  return [nextRollup, ...prev]
    .filter((item, index, array) => {
      const current = `${item.period}:${item.periodKey}`;
      const firstIndex = array.findIndex(
        (candidate) => `${candidate.period}:${candidate.periodKey}` === current,
      );
      return firstIndex === index;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summarizeRollupTitle(
  period: RollupPeriod,
  periodKey: string,
  merged: MergedSummaryData,
): string {
  const title = merged.dailySummary || "업무 요약";
  if (period === "week") return `# Weekly Wrap-up (${periodKey})\n\n${title}`;
  return `# Monthly Wrap-up (${periodKey})\n\n${title}`;
}

function mergeMergedSummaries(
  items: MergedSummaryData[],
  dateKey: string,
): MergedSummaryData {
  const summaryCandidates = cleanList(items.map((item) => item.dailySummary));
  const contextsMap = new Map<string, SummaryContextData>();
  const connectedProviders = cleanList(
    items.flatMap((item) => item.connectedProviders),
  );
  const doneTodos = cleanList(items.flatMap((item) => item.doneTodos));
  const workLogs = cleanList(items.flatMap((item) => item.workLogs));
  const issues = cleanList(items.flatMap((item) => item.issues));
  const evidence = dedupeEvidenceItems(items.flatMap((item) => item.evidence));

  const upsertContext = (name: string): SummaryContextData => {
    const normalizedName = name.trim() || DEFAULT_CONTEXT_NAME;
    const key = normalizeCompareKey(normalizedName) || DEFAULT_CONTEXT_NAME.toLowerCase();
    const existing = contextsMap.get(key);
    if (existing) return existing;
    const created: SummaryContextData = {
      name: normalizedName,
      summary: "",
      doneTodos: [],
      workLogs: [],
      issues: [],
      evidence: [],
    };
    contextsMap.set(key, created);
    return created;
  };

  for (const merged of items) {
    if (merged.contexts.length > 0) {
      for (const context of merged.contexts) {
        const bucket = upsertContext(context.name);
        bucket.doneTodos.push(...context.doneTodos);
        bucket.workLogs.push(...context.workLogs);
        bucket.issues.push(...context.issues);
        bucket.evidence.push(...context.evidence);
      }
      continue;
    }

    const fallback = upsertContext(DEFAULT_CONTEXT_NAME);
    fallback.doneTodos.push(...merged.doneTodos);
    fallback.workLogs.push(...merged.workLogs);
    fallback.issues.push(...merged.issues);
    fallback.evidence.push(...merged.evidence);
  }

  const contexts = Array.from(contextsMap.values())
    .map((context) => {
      const normalized: SummaryContextData = {
        name: context.name,
        summary: "",
        doneTodos: cleanList(context.doneTodos),
        workLogs: cleanList(context.workLogs),
        issues: cleanList(context.issues),
        evidence: dedupeEvidenceItems(context.evidence),
      };
      normalized.summary = getContextSummary(normalized);
      return normalized;
    })
    .filter(
      (context) =>
        context.doneTodos.length > 0 ||
        context.workLogs.length > 0 ||
        context.issues.length > 0 ||
        context.evidence.length > 0,
    )
    .sort((a, b) => {
      const aScore =
        a.doneTodos.length + a.workLogs.length + a.issues.length + a.evidence.length;
      const bScore =
        b.doneTodos.length + b.workLogs.length + b.issues.length + b.evidence.length;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });

  return {
    version: "1",
    dateKey,
    connectedProviders,
    dailySummary:
      summaryCandidates[0] ??
      (items.length > 1 ? `${items.length}일치 작업을 통합한 요약입니다.` : "작업 요약이 없습니다."),
    doneTodos,
    workLogs,
    issues,
    evidence,
    contexts,
  };
}

type ClosedPeriodCandidate = {
  period: RollupPeriod;
  periodKey: string;
  startDateKey: string;
  endDateKey: string;
  sourceDateKeys: string[];
  mergedItems: MergedSummaryData[];
};

function buildClosedPeriodCandidates(records: SummaryRecord[], now: Date): ClosedPeriodCandidate[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const byWeek = new Map<
    string,
    { start: string; end: string; source: string[]; merged: MergedSummaryData[] }
  >();
  const byMonth = new Map<
    string,
    { start: string; end: string; source: string[]; merged: MergedSummaryData[] }
  >();

  for (const record of records) {
    const dateKey = recordDateKey(record);
    const parsed = parseDateKeyToDate(dateKey);
    if (!parsed || !record.merged) continue;

    const diffToMonday = parsed.getDay() === 0 ? -6 : 1 - parsed.getDay();
    const weekStart = shiftDate(parsed, diffToMonday);
    const weekStartKey = dateToKey(weekStart);
    const weekEndKey = dateToKey(shiftDate(weekStart, 6));
    if (weekStartKey) {
      const weekBucket = byWeek.get(weekStartKey) ?? {
        start: weekStartKey,
        end: weekEndKey,
        source: [],
        merged: [],
      };
      weekBucket.source.push(dateKey);
      weekBucket.merged.push(record.merged);
      byWeek.set(weekStartKey, weekBucket);
    }

    const monthKey = toMonthKey(dateKey);
    if (monthKey) {
      const monthStart = parseDateKeyToDate(`${monthKey}-01`);
      if (monthStart) {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
        monthEnd.setHours(0, 0, 0, 0);
        const monthBucket = byMonth.get(monthKey) ?? {
          start: dateToKey(monthStart),
          end: dateToKey(monthEnd),
          source: [],
          merged: [],
        };
        monthBucket.source.push(dateKey);
        monthBucket.merged.push(record.merged);
        byMonth.set(monthKey, monthBucket);
      }
    }
  }

  const candidates: ClosedPeriodCandidate[] = [];

  for (const [periodKey, value] of byWeek.entries()) {
    const end = parseDateKeyToDate(value.end);
    if (!end || end.getTime() >= today.getTime()) continue;
    candidates.push({
      period: "week",
      periodKey,
      startDateKey: value.start,
      endDateKey: value.end,
      sourceDateKeys: cleanList(value.source).sort(),
      mergedItems: value.merged,
    });
  }

  for (const [periodKey, value] of byMonth.entries()) {
    const end = parseDateKeyToDate(value.end);
    if (!end || end.getTime() >= today.getTime()) continue;
    candidates.push({
      period: "month",
      periodKey,
      startDateKey: value.start,
      endDateKey: value.end,
      sourceDateKeys: cleanList(value.source).sort(),
      mergedItems: value.merged,
    });
  }

  return candidates.sort((a, b) => {
    if (a.period !== b.period) return a.period.localeCompare(b.period);
    return b.periodKey.localeCompare(a.periodKey);
  });
}

function App() {
  const [profile, setProfile] = useState<ProfileConfig>({ ...EMPTY_PROFILE });
  const [formProfile, setFormProfile] = useState<ProfileConfig>({
    ...EMPTY_PROFILE,
  });
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [isIntroPreviewOpen, setIsIntroPreviewOpen] = useState(false);
  const [isStorageReady, setIsStorageReady] = useState(false);

  const [view, setView] = useState<AppView>("home");
  const [conversationInput, setConversationInput] = useState("");
  const [records, setRecords] = useState<SummaryRecord[]>([]);
  const [rollups, setRollups] = useState<SummaryRollup[]>([]);
  const rollupsRef = useRef<SummaryRollup[]>([]);
  const isEnsuringRollupsRef = useRef(false);

  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isCheckingPaths, setIsCheckingPaths] = useState(false);
  const [pathStatus, setPathStatus] = useState<DetectLogPathsResult | null>(
    null,
  );
  const [isWrapUpSheetOpen, setIsWrapUpSheetOpen] = useState(false);
  const [wrapUpRunStatus, setWrapUpRunStatus] =
    useState<WrapUpRunStatus>("idle");
  const [wrapUpLogs, setWrapUpLogs] = useState<WrapUpLogLine[]>([]);
  const wrapUpLogIdRef = useRef(1);
  const [, setFeedbackTone] = useState<FeedbackTone>("normal");

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records],
  );

  useEffect(() => {
    rollupsRef.current = rollups;
  }, [rollups]);

  const weeklyGroups = useMemo(() => {
    const map = new Map<string, SummaryRecord[]>();
    sortedRecords.forEach((record) => {
      const key = getWeekStartKey(record.createdAt);
      const group = map.get(key) ?? [];
      group.push(record);
      map.set(key, group);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sortedRecords]);

  const monthlyGroups = useMemo(() => {
    const map = new Map<string, SummaryRecord[]>();
    sortedRecords.forEach((record) => {
      const key = getMonthKey(record.createdAt);
      const group = map.get(key) ?? [];
      group.push(record);
      map.set(key, group);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sortedRecords]);

  const isOnboarded = profile.name.trim().length > 0;
  const canMoveToNextOnboardingStep =
    onboardingStep === 0 ? formProfile.name.trim().length > 0 : true;

  useEffect(() => {
    let cancelled = false;

    async function hydrateStorage() {
      try {
        const [loadedProfile, loadedRecords, loadedRollups] = await Promise.all([
          loadProfile(),
          loadRecords(),
          loadRollups(),
        ]);

        if (cancelled) return;

        const nextProfile = loadedProfile ?? { ...EMPTY_PROFILE };
        setProfile(nextProfile);
        setFormProfile(nextProfile);
        setRecords(loadedRecords);
        setRollups(loadedRollups);
        rollupsRef.current = loadedRollups;
      } finally {
        if (!cancelled) {
          setIsStorageReady(true);
        }
      }
    }

    void hydrateStorage();
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureClosedRollups(
    sourceRecords: SummaryRecord[],
    currentRollups: SummaryRollup[] = rollupsRef.current,
    appendLog?: (kind: WrapUpLogKind, text: string) => void,
  ): Promise<void> {
    if (isEnsuringRollupsRef.current) return;

    isEnsuringRollupsRef.current = true;
    try {
      const existing = new Set(
        currentRollups.map((item) => `${item.period}:${item.periodKey}`),
      );
      const candidates = buildClosedPeriodCandidates(sourceRecords, new Date());
      let nextRollups = [...currentRollups];

      for (const candidate of candidates) {
        const rollupKey = `${candidate.period}:${candidate.periodKey}`;
        if (existing.has(rollupKey)) continue;
        if (candidate.mergedItems.length === 0) continue;

        const merged = mergeMergedSummaries(
          candidate.mergedItems,
          candidate.startDateKey,
        );
        const createdAt = new Date().toISOString();
        const rollup: SummaryRollup = {
          id: `${candidate.period}-${candidate.periodKey}-${Date.now()}-${Math.floor(
            Math.random() * 1000,
          )}`,
          createdAt,
          period: candidate.period,
          periodKey: candidate.periodKey,
          startDateKey: candidate.startDateKey,
          endDateKey: candidate.endDateKey,
          sourceDateKeys: candidate.sourceDateKeys,
          summary: summarizeRollupTitle(candidate.period, candidate.periodKey, merged),
          merged,
        };

        await saveRollup(rollup);
        existing.add(rollupKey);
        nextRollups = upsertRollupByPeriod(nextRollups, rollup);
        appendLog?.(
          "ok",
          `Generated ${candidate.period} rollup (${candidate.periodKey}).`,
        );
      }

      if (nextRollups.length !== currentRollups.length) {
        setRollups(nextRollups);
        rollupsRef.current = nextRollups;
      }
    } finally {
      isEnsuringRollupsRef.current = false;
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const pressedKey = event.key.toLowerCase();
      const isReloadShortcut =
        (event.metaKey || event.ctrlKey) && pressedKey === "r";
      if (!isReloadShortcut) return;

      event.preventDefault();
      window.location.reload();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function checkAllLogPaths(): Promise<void> {
    setIsCheckingPaths(true);
    setPathStatus(buildPartialPathStatus({}));

    try {
      // Intentional delay to make the sequential scanning state visible.
      await wait(2000);
      const result = await requestDetectLogPaths(formProfile);

      const partial: Partial<DetectLogPathsResult> = {};

      for (const key of CHECK_SEQUENCE_KEYS) {
        await wait(260);
        partial[key] = result[key];
        setPathStatus(buildPartialPathStatus(partial));
        await wait(220);
      }

      const statusList = [
        result.claude,
        result.codex,
        result.cursor,
        result.gemini,
      ];
      const okCount = statusList.filter(
        (item) => item.exists && item.hasJsonl,
      ).length;

      setFeedbackTone(okCount > 0 ? "normal" : "error");
    } catch (error) {
      setFeedbackTone("error");
    } finally {
      setIsCheckingPaths(false);
    }
  }

  async function collectConversationIntoInput(
    activeProfile: ProfileConfig = profile,
  ): Promise<string | null> {
    setIsCollecting(true);
    try {
      const collected = await requestAutoCollectedConversation(activeProfile);
      const text = collected.conversation.trim();
      if (!text || collected.messageCount === 0) {
        setFeedbackTone("error");
        return null;
      }

      setConversationInput(text);
      setFeedbackTone("normal");
      return text;
    } catch (error) {
      setFeedbackTone("error");
      return null;
    } finally {
      setIsCollecting(false);
    }
  }

  async function summarizeAndStore(
    conversation: string,
    activeProfileOverride?: ProfileConfig,
  ): Promise<void> {
    const activeProfile = activeProfileOverride ?? profile;
    let effectiveConversation = conversation.trim();

    if (!effectiveConversation && activeProfile.collectFromLocalLogs) {
      const collected = await collectConversationIntoInput(activeProfile);
      if (!collected) return;
      effectiveConversation = collected;
    }

    if (!effectiveConversation) {
      setFeedbackTone("error");
      return;
    }

    const finishCommand = activeProfile.finishCommand.trim();

    setIsSummarizing(true);
    setFeedbackTone("normal");

    try {
      let provider: SummaryRecord["provider"] = "terminal";
      let summary = "";
      let usedFallback = false;

      if (finishCommand) {
        try {
          summary = await requestTerminalSummary(
            finishCommand,
            effectiveConversation,
          );
        } catch (error) {
          provider = "local";
          usedFallback = true;
          summary = createLocalSummary(effectiveConversation);
        }
      } else {
        provider = "local";
        usedFallback = true;
        summary = createLocalSummary(effectiveConversation);
      }

      const createdAt = new Date().toISOString();
      const record: SummaryRecord = {
        id: `${Date.now()}`,
        createdAt,
        provider,
        summary,
        conversation: effectiveConversation,
        dateKey: toLocalDateKey(createdAt),
      };

      await saveRecord(record);
      const nextRecords = upsertRecordByDate(records, record);
      setRecords(nextRecords);
      await ensureClosedRollups(nextRecords, rollupsRef.current);

      setConversationInput("");

      if (usedFallback) {
        setFeedbackTone("error");
      } else {
        setFeedbackTone("normal");
      }
    } finally {
      setIsSummarizing(false);
    }
  }

  async function summarizeTodayWithConnectedAi(): Promise<void> {
    if (isSummarizing || isCollecting || isCheckingPaths) return;

    setIsWrapUpSheetOpen(true);
    setWrapUpRunStatus("running");
    setWrapUpLogs([]);
    wrapUpLogIdRef.current = 1;

    const appendWrapUpLog = (kind: WrapUpLogKind, text: string) => {
      const nextId = wrapUpLogIdRef.current++;
      setWrapUpLogs((prev) => [...prev, { id: nextId, kind, text }]);
    };

    appendWrapUpLog("info", "Starting daily wrap-up flow.");
    setIsSummarizing(true);
    setFeedbackTone("normal");

    try {
      appendWrapUpLog("info", "Detecting connected AI paths.");
      const [detected, collected] = await Promise.all([
        requestDetectLogPaths(profile),
        requestAutoCollectedConversation(profile),
      ]);

      appendWrapUpLog("ok", "Path detection finished.");
      const collectedConversation = collected.conversation.trim();
      if (!collectedConversation || collected.messageCount === 0) {
        appendWrapUpLog("error", "No conversation found for today.");
        setFeedbackTone("error");
        setWrapUpRunStatus("error");
        return;
      }
      appendWrapUpLog(
        "ok",
        `Collected ${collected.messageCount} messages from ${collected.sources.join(", ") || "local logs"}.`,
      );

      const connectedProviders = CHECK_SEQUENCE_KEYS.filter((key) => {
        const status = detected[key];
        return status.exists && status.hasJsonl;
      });
      appendWrapUpLog(
        "info",
        `Connected providers: ${connectedProviders.map((provider) => PROVIDER_LABEL[provider]).join(", ") || "none"}.`,
      );

      const sourceProviders = collected.sources
        .map((source) => source.toLowerCase())
        .filter(isPathProviderKey);
      const finishCommand = profile.finishCommand.trim();

      const candidateProviders = Array.from(
        new Set(
          connectedProviders.length > 0 ? connectedProviders : sourceProviders,
        ),
      );

      const runnableProviders = candidateProviders.filter(
        (provider) => resolveWrapUpCommand(provider, finishCommand) !== null,
      );

      if (runnableProviders.length === 0) {
        appendWrapUpLog(
          "error",
          "No runnable AI CLI found. Install/login Claude or Codex first.",
        );
        setFeedbackTone("error");
        setWrapUpRunStatus("error");
        return;
      }
      appendWrapUpLog(
        "ok",
        `Running wrap-up with: ${runnableProviders.map((provider) => PROVIDER_LABEL[provider]).join(", ")}.`,
      );

      const sections: string[] = [];
      const providerResults: ProviderSummaryData[] = [];
      let usedTerminal = false;
      let usedFallback = false;
      const createdAt = new Date().toISOString();
      const dateKey = toLocalDateKey(createdAt);

      for (const provider of runnableProviders) {
        const sourceConversation =
          extractSourceConversation(collectedConversation, provider) ||
          collectedConversation;
        const prompt = buildWrapUpPrompt(provider, sourceConversation);
        let providerSummary = "";
        const command = resolveWrapUpCommand(provider, finishCommand);

        if (command) {
          appendWrapUpLog(
            "info",
            `[${PROVIDER_LABEL[provider]}] Running: ${command}`,
          );
          try {
            providerSummary = await requestTerminalSummary(
              command,
              prompt,
            );
            usedTerminal = true;
            appendWrapUpLog(
              "ok",
              `[${PROVIDER_LABEL[provider]}] Summary generated.`,
            );
          } catch (error) {
            providerSummary = createLocalSummary(prompt);
            usedFallback = true;
            appendWrapUpLog(
              "warn",
              `[${PROVIDER_LABEL[provider]}] CLI failed (${extractErrorSummary(error)}). Fallback local summary used.`,
            );
          }
        } else {
          providerSummary = createLocalSummary(prompt);
          usedFallback = true;
          appendWrapUpLog(
            "warn",
            `[${PROVIDER_LABEL[provider]}] No command configured. Fallback local summary used.`,
          );
        }

        providerSummary = normalizeWrapUpTodoStatus(
          providerSummary,
          sourceConversation,
        );
        providerResults.push(
          parseProviderSummaryData(provider, dateKey, providerSummary),
        );

        sections.push(`## ${PROVIDER_LABEL[provider]}\n${providerSummary.trim()}`);
      }

      const connectedLabel = runnableProviders
        .map((provider) => PROVIDER_LABEL[provider])
        .join(", ");
      const summary = [
        `# Daily Wrap-up`,
        `Connected AI: ${connectedLabel}`,
        "",
        ...sections,
      ].join("\n");
      const merged = buildMergedSummaryData(
        dateKey,
        runnableProviders.map((provider) => PROVIDER_LABEL[provider]),
        providerResults,
      );

      const record: SummaryRecord = {
        id: `${Date.now()}`,
        createdAt,
        provider: usedTerminal ? "terminal" : "local",
        summary,
        conversation: collectedConversation,
        dateKey,
        providerResults,
        merged,
      };

      await saveRecord(record);
      const savedDateKey = toLocalDateKey(record.createdAt);
      appendWrapUpLog(
        "ok",
        `Saved summary to ~/.briefly/records/${savedDateKey}/summary.md`,
      );
      const nextRecords = upsertRecordByDate(records, record);
      setRecords(nextRecords);
      await ensureClosedRollups(nextRecords, rollupsRef.current, appendWrapUpLog);
      appendWrapUpLog("ok", "Wrap-up completed.");

      setFeedbackTone(usedFallback ? "error" : "normal");
      setWrapUpRunStatus(usedFallback ? "error" : "done");
    } catch {
      appendWrapUpLog("error", "Unexpected error occurred during wrap-up.");
      setFeedbackTone("error");
      setWrapUpRunStatus("error");
    } finally {
      setIsSummarizing(false);
    }
  }

  function completeOnboarding(): void {
    const normalized = normalizeProfile(formProfile);

    if (!normalized.name) {
      setFeedbackTone("error");
      return;
    }

    setProfile(normalized);
    setFormProfile(normalized);
    setView("home");
    void saveProfile(normalized).catch(() => {
      setFeedbackTone("error");
    });
    setFeedbackTone("normal");
  }

  function saveCurrentSettings(): void {
    const normalized = normalizeProfile(formProfile);

    setProfile(normalized);
    setFormProfile(normalized);
    void saveProfile(normalized).catch(() => {
      setFeedbackTone("error");
    });
    setFeedbackTone("normal");
  }

  function resetAllDataAndGoOnboarding(): void {
    setProfile({ ...EMPTY_PROFILE });
    setFormProfile({ ...EMPTY_PROFILE });
    setRecords([]);
    setRollups([]);
    setConversationInput("");
    setPathStatus(null);
    setOnboardingStep(0);
    setView("home");
    void clearOnboardingStorage();

    setFeedbackTone("normal");
  }

  function openSettingsView(): void {
    setFormProfile(profile);
    setView("settings");
  }

  function openIntroPreview(): void {
    setFormProfile(profile);
    setPathStatus(null);
    setOnboardingStep(0);
    setIsIntroPreviewOpen(true);
  }

  if (!isStorageReady) {
    return <main className="min-h-screen bg-background" />;
  }

  if (!isOnboarded || isIntroPreviewOpen) {
    return (
      <OnboardingScreen
        onboardingStep={onboardingStep}
        setOnboardingStep={setOnboardingStep}
        canMoveToNextOnboardingStep={canMoveToNextOnboardingStep}
        formProfile={formProfile}
        setFormProfile={setFormProfile}
        isCheckingPaths={isCheckingPaths}
        pathStatus={pathStatus}
        onCheckAllLogPaths={() => {
          void checkAllLogPaths();
        }}
        onCompleteOnboarding={() => {
          completeOnboarding();
          setIsIntroPreviewOpen(false);
        }}
        isSummarizing={isSummarizing}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-6 py-8">
      {view !== "home" && <MainHeader profile={profile} />}

      {view === "home" && (
        <HomeView
          profile={profile}
          conversationInput={conversationInput}
          onConversationInputChange={setConversationInput}
          isCollecting={isCollecting}
          isSummarizing={isSummarizing}
          sortedRecords={sortedRecords}
          onCollectConversation={() => {
            void collectConversationIntoInput(profile);
          }}
          onSummarize={() => {
            void summarizeAndStore(conversationInput);
          }}
          formatDateTime={formatDateTime}
        />
      )}

      {view === "settings" && (
        <SettingsView
          formProfile={formProfile}
          setFormProfile={setFormProfile}
          isCheckingPaths={isCheckingPaths}
          pathStatus={pathStatus}
          getPathStatusMeta={getPathStatusMeta}
          onCheckAllLogPaths={() => {
            void checkAllLogPaths();
          }}
          onResetAllDataAndGoOnboarding={resetAllDataAndGoOnboarding}
          onSaveSettings={saveCurrentSettings}
        />
      )}

      {view === "archive" && (
        <ArchiveView
          sortedRecords={sortedRecords}
          weeklyGroups={weeklyGroups}
          monthlyGroups={monthlyGroups}
          formatDateTime={formatDateTime}
        />
      )}

      <Button
        type="button"
        size="icon"
        variant={view === "settings" ? "default" : "outline"}
        className="fixed bottom-6 left-6 z-50 h-11 w-11 cursor-pointer rounded-full shadow-sm"
        onClick={() => {
          if (view === "settings") {
            setView("home");
            return;
          }
          openSettingsView();
        }}
        aria-label={view === "settings" ? "Back to home" : "Open settings"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-95"
          aria-hidden
        >
          <path d="M19.875 6.27A2.23 2.23 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.27 2.27 0 0 1-2.184 0l-6.75-4.27A2.23 2.23 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98z" />
          <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
        </svg>
      </Button>

      <Button
        type="button"
        variant="outline"
        className="fixed bottom-6 left-20 z-50 h-11 cursor-pointer rounded-full px-4 shadow-sm"
        onClick={openIntroPreview}
      >
        Intro
      </Button>

      <Button
        type="button"
        className="fixed right-6 bottom-6 z-50 h-11 cursor-pointer rounded-full px-4 shadow-sm"
        onClick={() => {
          setIsWrapUpSheetOpen(true);
          if (!isSummarizing) {
            void summarizeTodayWithConnectedAi();
          }
        }}
        disabled={isCollecting || isCheckingPaths}
      >
        {isSummarizing ? (
          <>
            <Spinner data-icon="inline-start" className="size-3.5" />
            Wrapping up
          </>
        ) : (
          "Wrap Up Today"
        )}
      </Button>

      <WrapUpTerminalSheet
        open={isWrapUpSheetOpen}
        onOpenChange={setIsWrapUpSheetOpen}
        status={wrapUpRunStatus}
        logs={wrapUpLogs}
      />
    </main>
  );
}

export default App;
