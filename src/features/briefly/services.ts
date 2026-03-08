import { invoke } from "@tauri-apps/api/core";
import type {
  AutoConversationResult,
  DetectLogPathsResult,
  FinishCommandResult,
  MergedSummaryData,
  ProfileConfig,
  ProviderSummaryData,
  SummaryRecordFile,
} from "@/features/briefly/types";

function isTauriAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__,
  );
}

export async function requestTerminalSummary(
  commandTemplate: string,
  conversation: string,
): Promise<string> {
  if (!isTauriAvailable()) {
    throw new Error(
      "Tauri 런타임이 아니어서 터미널 명령을 실행할 수 없습니다.",
    );
  }

  const result = await invoke<FinishCommandResult>("run_finish_command", {
    commandTemplate,
    conversation,
  });

  if (!result.success) {
    throw new Error(
      result.stderr || `명령 실행 실패 (exit: ${result.exitCode ?? "unknown"})`,
    );
  }

  const text = result.stdout.trim();
  if (!text) {
    throw new Error("명령 실행은 성공했지만 stdout 결과가 비어 있습니다.");
  }

  return text;
}

export async function requestAutoCollectedConversation(
  profile: Pick<
    ProfileConfig,
    "codexRootPath" | "claudeRootPath" | "cursorRootPath" | "geminiRootPath"
  >,
  maxChars = 50000,
): Promise<AutoConversationResult> {
  if (!isTauriAvailable()) {
    throw new Error(
      "Tauri 런타임이 아니어서 로컬 로그를 자동 수집할 수 없습니다.",
    );
  }

  return invoke<AutoConversationResult>("collect_today_terminal_conversation", {
    maxChars,
    codexRootPath: profile.codexRootPath.trim() || null,
    claudeRootPath: profile.claudeRootPath.trim() || null,
    cursorRootPath: profile.cursorRootPath.trim() || null,
    geminiRootPath: profile.geminiRootPath.trim() || null,
  });
}

export async function requestDetectLogPaths(
  profile: Pick<
    ProfileConfig,
    "codexRootPath" | "claudeRootPath" | "cursorRootPath" | "geminiRootPath"
  >,
): Promise<DetectLogPathsResult> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri 런타임이 아니어서 경로 확인을 실행할 수 없습니다.");
  }

  return invoke<DetectLogPathsResult>("detect_log_paths", {
    codexRootPath: profile.codexRootPath.trim() || null,
    claudeRootPath: profile.claudeRootPath.trim() || null,
    cursorRootPath: profile.cursorRootPath.trim() || null,
    geminiRootPath: profile.geminiRootPath.trim() || null,
  });
}

export async function requestLoadProfileFromFs(): Promise<ProfileConfig | null> {
  if (!isTauriAvailable()) return null;
  return invoke<ProfileConfig | null>("load_profile_from_fs");
}

export async function requestSaveProfileToFs(
  profile: ProfileConfig,
): Promise<void> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri 런타임이 아니어서 프로필 파일 저장을 실행할 수 없습니다.");
  }

  await invoke("save_profile_to_fs", { profile });
}

export async function requestListRecordsFromFs(): Promise<SummaryRecordFile[]> {
  if (!isTauriAvailable()) return [];
  return invoke<SummaryRecordFile[]>("list_records_from_fs");
}

export async function requestSaveRecordToFs(
  record: Pick<
    SummaryRecordFile,
    "id" | "createdAt" | "provider" | "summary" | "dateKey"
  > & {
    providerResults?: ProviderSummaryData[];
    merged?: MergedSummaryData;
  },
): Promise<void> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri 런타임이 아니어서 요약 파일 저장을 실행할 수 없습니다.");
  }

  await invoke("save_record_to_fs", { record });
}

export async function requestClearBrieflyStorage(): Promise<void> {
  if (!isTauriAvailable()) return;
  await invoke("clear_briefly_storage");
}
