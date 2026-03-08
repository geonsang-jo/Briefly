import type { SummaryRecord } from "@/features/briefly/types";

type ArchiveViewProps = {
  sortedRecords: SummaryRecord[];
  weeklyGroups: Array<[string, SummaryRecord[]]>;
  monthlyGroups: Array<[string, SummaryRecord[]]>;
  formatDateTime: (iso: string) => string;
};

export function ArchiveView({
  sortedRecords,
  weeklyGroups,
  monthlyGroups,
  formatDateTime,
}: ArchiveViewProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <article className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-medium">일 단위</h2>
        {sortedRecords.length === 0 ? (
          <p className="text-sm text-muted-foreground">저장된 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {sortedRecords.map((record) => (
              <li key={record.id} className="rounded-md border p-2">
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(record.createdAt)} · {record.provider}
                </p>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm">
                  {record.summary}
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-medium">주 단위</h2>
        {weeklyGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">저장된 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {weeklyGroups.map(([weekStart, items]) => (
              <li key={weekStart} className="rounded-md border p-2">
                <p className="text-sm font-medium">주 시작: {weekStart}</p>
                <p className="text-xs text-muted-foreground">요약 {items.length}개</p>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-medium">월 단위</h2>
        {monthlyGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">저장된 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {monthlyGroups.map(([month, items]) => (
              <li key={month} className="rounded-md border p-2">
                <p className="text-sm font-medium">{month}</p>
                <p className="text-xs text-muted-foreground">요약 {items.length}개</p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
