import {
  PROFILE_STORAGE_KEY,
  RECORD_STORAGE_KEY,
} from "@/features/briefly/constants";
import {
  requestClearBrieflyStorage,
  requestListRecordsFromFs,
  requestLoadProfileFromFs,
  requestSaveProfileToFs,
  requestSaveRecordToFs,
} from "@/features/briefly/services";
import type {
  MergedSummaryData,
  ProfileConfig,
  ProviderSummaryData,
  SummaryRecord,
  SummaryRecordFile,
} from "@/features/briefly/types";
import { isValidDate } from "@/features/briefly/utils";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeProfile(raw: Partial<ProfileConfig> | null): ProfileConfig | null {
  if (!raw || typeof raw !== "object") return null;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;

  return {
    name,
    finishCommand: typeof raw.finishCommand === "string" ? raw.finishCommand : "",
    autoSummarizeOnFinish: Boolean(raw.autoSummarizeOnFinish),
    collectFromLocalLogs:
      typeof raw.collectFromLocalLogs === "boolean"
        ? raw.collectFromLocalLogs
        : true,
    codexRootPath: typeof raw.codexRootPath === "string" ? raw.codexRootPath : "",
    claudeRootPath:
      typeof raw.claudeRootPath === "string" ? raw.claudeRootPath : "",
    cursorRootPath:
      typeof raw.cursorRootPath === "string" ? raw.cursorRootPath : "",
    geminiRootPath:
      typeof raw.geminiRootPath === "string" ? raw.geminiRootPath : "",
  };
}

function loadProfileFromLocalStorage(): ProfileConfig | null {
  const raw = readJson<Partial<ProfileConfig> | null>(PROFILE_STORAGE_KEY, null);
  return normalizeProfile(raw);
}

function toDateKeyFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function effectiveDateKey(item: SummaryRecord): string {
  if (item.dateKey && item.dateKey.trim()) return item.dateKey;
  return toDateKeyFromIso(item.createdAt);
}

function normalizeMergedSummary(
  value: unknown,
): MergedSummaryData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<MergedSummaryData>;
  const contexts = Array.isArray(candidate.contexts) ? candidate.contexts : [];

  return {
    version: candidate.version === "1" ? "1" : "1",
    dateKey: typeof candidate.dateKey === "string" ? candidate.dateKey : "",
    connectedProviders: Array.isArray(candidate.connectedProviders)
      ? candidate.connectedProviders.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    dailySummary:
      typeof candidate.dailySummary === "string" ? candidate.dailySummary : "",
    doneTodos: Array.isArray(candidate.doneTodos)
      ? candidate.doneTodos.filter((item): item is string => typeof item === "string")
      : [],
    workLogs: Array.isArray(candidate.workLogs)
      ? candidate.workLogs.filter((item): item is string => typeof item === "string")
      : [],
    issues: Array.isArray(candidate.issues)
      ? candidate.issues.filter((item): item is string => typeof item === "string")
      : [],
    evidence: Array.isArray(candidate.evidence)
      ? candidate.evidence.filter(
          (item): item is { time: string; source: string; text: string } =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof item.time === "string" &&
                typeof item.source === "string" &&
                typeof item.text === "string",
            ),
        )
      : [],
    contexts: contexts
      .filter((item): item is MergedSummaryData["contexts"][number] => Boolean(item && typeof item === "object"))
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "General",
        summary: typeof item.summary === "string" ? item.summary : "",
        doneTodos: Array.isArray(item.doneTodos)
          ? item.doneTodos.filter((entry): entry is string => typeof entry === "string")
          : [],
        workLogs: Array.isArray(item.workLogs)
          ? item.workLogs.filter((entry): entry is string => typeof entry === "string")
          : [],
        issues: Array.isArray(item.issues)
          ? item.issues.filter((entry): entry is string => typeof entry === "string")
          : [],
        evidence: Array.isArray(item.evidence)
          ? item.evidence.filter(
              (entry): entry is { time: string; source: string; text: string } =>
                Boolean(
                  entry &&
                    typeof entry === "object" &&
                    typeof entry.time === "string" &&
                    typeof entry.source === "string" &&
                    typeof entry.text === "string",
                ),
            )
          : [],
      })),
  };
}

function normalizeRecord(
  item: Partial<SummaryRecord> &
    Partial<SummaryRecordFile> & { provider?: string | null },
): SummaryRecord | null {
  if (!item || typeof item !== "object") return null;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  if (typeof item.createdAt !== "string" || !isValidDate(item.createdAt)) {
    return null;
  }
  if (typeof item.summary !== "string") return null;
  if (item.provider !== "terminal" && item.provider !== "local") return null;

  const conversation =
    typeof item.conversation === "string" ? item.conversation : "";
  const dateKey =
    typeof item.dateKey === "string" && item.dateKey.trim()
      ? item.dateKey
      : toDateKeyFromIso(item.createdAt);
  const providerResults = Array.isArray(item.providerResults)
    ? (item.providerResults as ProviderSummaryData[])
    : undefined;
  const merged = normalizeMergedSummary(item.merged);

  return {
    id: item.id,
    createdAt: item.createdAt,
    provider: item.provider,
    summary: item.summary,
    conversation,
    dateKey,
    providerResults,
    merged,
  };
}

function loadRecordsFromLocalStorage(): SummaryRecord[] {
  const raw = readJson<SummaryRecord[]>(RECORD_STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => normalizeRecord(item))
    .filter((item): item is SummaryRecord => Boolean(item))
    .filter((item, index, array) => {
      const key = effectiveDateKey(item);
      const firstIndex = array.findIndex(
        (candidate) => effectiveDateKey(candidate) === key,
      );
      return firstIndex === index;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function appendRecordToLocalStorage(record: SummaryRecord): void {
  const current = loadRecordsFromLocalStorage();
  const nextRecord = {
    ...record,
    dateKey: effectiveDateKey(record),
  };
  const next = [nextRecord, ...current]
    .filter((item, index, array) => {
      const key = effectiveDateKey(item);
      const firstIndex = array.findIndex(
        (candidate) => effectiveDateKey(candidate) === key,
      );
      return firstIndex === index;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  writeJson(RECORD_STORAGE_KEY, next);
}

export async function loadProfile(): Promise<ProfileConfig | null> {
  try {
    const fromFs = await requestLoadProfileFromFs();
    const normalized = normalizeProfile(fromFs);
    if (normalized) return normalized;
  } catch {
    // Fallback to localStorage below.
  }

  const localProfile = loadProfileFromLocalStorage();
  if (!localProfile) return null;

  try {
    await requestSaveProfileToFs(localProfile);
  } catch {
    // Ignore migration failure and keep local profile.
  }

  return localProfile;
}

export async function loadRecords(): Promise<SummaryRecord[]> {
  try {
    const fromFs = await requestListRecordsFromFs();
    const normalized = fromFs
      .map((item) => normalizeRecord(item))
      .filter((item): item is SummaryRecord => Boolean(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (normalized.length > 0) {
      return normalized;
    }
  } catch {
    // Fallback to localStorage below.
  }

  const localRecords = loadRecordsFromLocalStorage();
  if (localRecords.length === 0) return localRecords;

  try {
    for (const record of localRecords) {
      const date = new Date(record.createdAt);
      const dateKey = Number.isNaN(date.getTime())
        ? record.createdAt.slice(0, 10)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

      await requestSaveRecordToFs({
        id: record.id,
        createdAt: record.createdAt,
        provider: record.provider,
        summary: record.summary,
        dateKey,
        providerResults: record.providerResults,
        merged: record.merged,
      });
    }
  } catch {
    // Ignore migration failure and keep local records.
  }

  return localRecords;
}

export async function saveProfile(profile: ProfileConfig): Promise<void> {
  try {
    await requestSaveProfileToFs(profile);
    return;
  } catch {
    writeJson(PROFILE_STORAGE_KEY, profile);
  }
}

export async function saveRecord(record: SummaryRecord): Promise<void> {
  const dateKey = effectiveDateKey(record);

  try {
    await requestSaveRecordToFs({
      id: record.id,
      createdAt: record.createdAt,
      provider: record.provider,
      summary: record.summary,
      dateKey,
      providerResults: record.providerResults,
      merged: record.merged,
    });
    return;
  } catch {
    appendRecordToLocalStorage({
      ...record,
      dateKey,
    });
  }
}

export async function clearOnboardingStorage(): Promise<void> {
  try {
    await requestClearBrieflyStorage();
  } catch {
    // Continue clearing local fallback keys.
  }

  localStorage.removeItem(PROFILE_STORAGE_KEY);
  localStorage.removeItem(RECORD_STORAGE_KEY);
}
