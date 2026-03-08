import type { PathCheckStatus, PathStatusMeta } from "@/features/briefly/types";

export function isValidDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export function createLocalSummary(conversation: string): string {
  const lines = conversation
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const done = lines.slice(0, 3);
  const todos = lines.slice(3, 6);

  return [
    "1) 오늘 한 일",
    ...(done.length > 0
      ? done.map((line) => `- ${line}`)
      : ["- 대화 원문을 수집했습니다."]),
    "",
    "2) 결정한 것",
    "- 주요 결정은 원문 재확인이 필요합니다.",
    "",
    "3) 남은 할 일",
    ...(todos.length > 0
      ? todos.map((line) => `- ${line}`)
      : ["- 다음 액션 아이템을 수동으로 추가해 주세요."]),
    "",
    "4) 리스크/메모",
    "- 요약 명령어를 연결하면 구조화 요약 정확도가 개선됩니다.",
  ].join("\n");
}

export function formatDateTime(iso: string): string {
  if (!isValidDate(iso)) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function getMonthKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

export function getWeekStartKey(iso: string): string {
  const date = new Date(iso);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const year = monday.getFullYear();
  const month = `${monday.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${monday.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

export function getPathStatusMeta(
  status: PathCheckStatus | undefined,
): PathStatusMeta {
  if (!status) {
    return {
      label: "미확인",
      badgeClass: "bg-muted text-muted-foreground border",
      icon: "none",
    };
  }

  if (status.exists && status.hasJsonl) {
    return {
      label: "OK",
      badgeClass: "bg-emerald-100 text-emerald-700 border border-emerald-200",
      icon: "ok",
    };
  }

  if (status.exists && !status.hasJsonl) {
    return {
      label: "로그 없음",
      badgeClass: "bg-amber-100 text-amber-700 border border-amber-200",
      icon: "warn",
    };
  }

  return {
    label: "미발견",
    badgeClass: "bg-rose-100 text-rose-700 border border-rose-200",
    icon: "warn",
  };
}
