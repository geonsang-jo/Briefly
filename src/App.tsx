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
  saveProfile,
  saveRecord,
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
  PathCheckStatus,
  PathProviderKey,
  ProfileConfig,
  SummaryRecord,
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
    "",
    "Output format (must follow exactly):",
    "",
    "## 한 줄 요약",
    "- ...",
    "",
    "## 오늘 한 일",
    "- ...",
    "",
    "## 완료한 TODO",
    "- [x] ...",
    "",
    "## 다음 TODO",
    "- [ ] ...",
    "",
    "## 이슈/메모",
    "- ...",
    "",
    "## 근거 로그",
    "- [HH:mm] [source] ...",
    "- [HH:mm] [source] ...",
    "",
    "If there is no meaningful work log, output:",
    "## 한 줄 요약",
    "- 오늘 작업 로그가 충분하지 않습니다.",
    "## 오늘 한 일",
    "- 없음",
    "## 완료한 TODO",
    "- [x] 없음",
    "## 다음 TODO",
    "- [ ] 작업 로그 수집 방식 점검",
    "## 이슈/메모",
    "- 로그 데이터 부족",
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
        const [loadedProfile, loadedRecords] = await Promise.all([
          loadProfile(),
          loadRecords(),
        ]);

        if (cancelled) return;

        const nextProfile = loadedProfile ?? { ...EMPTY_PROFILE };
        setProfile(nextProfile);
        setFormProfile(nextProfile);
        setRecords(loadedRecords);
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

      const record: SummaryRecord = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        provider,
        summary,
        conversation: effectiveConversation,
      };

      await saveRecord(record);
      setRecords((prev) =>
        [record, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );

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
      let usedTerminal = false;
      let usedFallback = false;

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

      const record: SummaryRecord = {
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        provider: usedTerminal ? "terminal" : "local",
        summary,
        conversation: collectedConversation,
      };

      await saveRecord(record);
      const dateKey = toLocalDateKey(record.createdAt);
      appendWrapUpLog(
        "ok",
        `Saved summary to ~/.briefly/records/${dateKey}/summary.md`,
      );
      appendWrapUpLog("ok", "Wrap-up completed.");
      setRecords((prev) =>
        [record, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );

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
