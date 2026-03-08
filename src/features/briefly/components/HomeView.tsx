import { useMemo, useState } from "react";
import { z } from "zod";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Meteors } from "@/components/ui/meteors";
import { taskSchema } from "@/components/tasks/data/schema";
import tasksSeedData from "@/components/tasks/data/tasks.json";
import type { ProfileConfig, SummaryRecord } from "@/features/briefly/types";

type DailyTaskStatus = "todo" | "done";
type HomeContentMode = "task" | "record";

type DailyTask = {
  id: string;
  title: string;
  dateKey: string;
  priority: "low" | "medium" | "high";
  source: "sample" | "record" | "user";
  defaultStatus: DailyTaskStatus;
};

type UserTask = {
  id: string;
  title: string;
  dateKey: string;
  priority: "low" | "medium" | "high";
};

const USER_TASKS_STORAGE_KEY = "briefly.daily-user-tasks.v1";

const WEEKDAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

const sampleRows = z.array(taskSchema).parse(tasksSeedData).slice(0, 3);

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDate(date: Date, offsetDays: number): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + offsetDays);
  return result;
}

function loadUserTasks(): UserTask[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(USER_TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUserTasks(next: UserTask[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_TASKS_STORAGE_KEY, JSON.stringify(next));
}

function priorityClass(priority: DailyTask["priority"]): string {
  if (priority === "high") return "bg-rose-100 text-rose-700";
  if (priority === "medium") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

function summaryTitle(record: SummaryRecord): string {
  const first = record.summary
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first ? first.slice(0, 80) : `Summary ${record.id}`;
}

function recordDateKey(record: SummaryRecord): string {
  if (record.dateKey && record.dateKey.trim()) return record.dateKey;
  return toDateKey(new Date(record.createdAt));
}

function contextItemCount(record: NonNullable<SummaryRecord["merged"]>["contexts"][number]): number {
  return (
    record.doneTodos.length +
    record.workLogs.length +
    record.issues.length +
    record.evidence.length
  );
}

type HomeViewProps = {
  profile: ProfileConfig;
  conversationInput: string;
  onConversationInputChange: (value: string) => void;
  isCollecting: boolean;
  isSummarizing: boolean;
  sortedRecords: SummaryRecord[];
  onCollectConversation: () => void;
  onSummarize: () => void;
  formatDateTime: (iso: string) => string;
};

export function HomeView({
  profile,
  conversationInput: _conversationInput,
  onConversationInputChange: _onConversationInputChange,
  isCollecting: _isCollecting,
  isSummarizing: _isSummarizing,
  sortedRecords,
  onCollectConversation: _onCollectConversation,
  onSummarize: _onSummarize,
  formatDateTime,
}: HomeViewProps) {
  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const [selectedDate, setSelectedDate] = useState(() => today);
  const selectedDateKey = toDateKey(selectedDate);
  const todayDateKey = toDateKey(today);

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<DailyTask["priority"]>("medium");
  const [contentMode, setContentMode] = useState<HomeContentMode>("task");

  const [userTasks, setUserTasks] = useState<UserTask[]>(() => loadUserTasks());
  const [statusByTaskId, setStatusByTaskId] = useState<Record<string, DailyTaskStatus>>({});

  const visibleDates = useMemo(() => {
    return Array.from({ length: 9 }, (_, idx) => shiftDate(selectedDate, idx - 4));
  }, [selectedDate]);

  const sampleTasks = useMemo<DailyTask[]>(() => {
    return sampleRows.map((row, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() + (idx - 1));

      return {
        id: `S-${row.id}`,
        title: row.title,
        dateKey: toDateKey(date),
        priority: (row.priority as DailyTask["priority"]) ?? "medium",
        source: "sample",
        defaultStatus: "todo",
      };
    });
  }, [today]);

  const recordTasks = useMemo<DailyTask[]>(() => {
    return sortedRecords.map((record) => {
      const parsedPriority: DailyTask["priority"] =
        record.provider === "terminal" ? "high" : "medium";

      return {
        id: `R-${record.id}`,
        title: summaryTitle(record),
        dateKey: toDateKey(new Date(record.createdAt)),
        priority: parsedPriority,
        source: "record",
        defaultStatus: "done",
      };
    });
  }, [sortedRecords]);

  const mappedUserTasks = useMemo<DailyTask[]>(() => {
    return userTasks.map((task) => ({
      id: task.id,
      title: task.title,
      dateKey: task.dateKey,
      priority: task.priority,
      source: "user",
      defaultStatus: "todo",
    }));
  }, [userTasks]);

  const allTasks = useMemo(() => {
    return [...sampleTasks, ...recordTasks, ...mappedUserTasks];
  }, [sampleTasks, recordTasks, mappedUserTasks]);

  const selectedDayTasks = useMemo(() => {
    return allTasks
      .filter((task) => task.dateKey === selectedDateKey)
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [allTasks, selectedDateKey]);

  const selectedDayRecords = useMemo(() => {
    return sortedRecords
      .filter((record) => recordDateKey(record) === selectedDateKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [selectedDateKey, sortedRecords]);

  const selectedDateNum = String(selectedDate.getDate()).padStart(2, "0");
  const selectedMonthDay = `${selectedDate.toLocaleDateString("en-US", {
    month: "long",
  })} ${selectedDateNum}`;

  function taskStatus(task: DailyTask): DailyTaskStatus {
    return statusByTaskId[task.id] ?? task.defaultStatus;
  }

  function toggleTaskStatus(task: DailyTask): void {
    const current = taskStatus(task);
    const next: DailyTaskStatus = current === "done" ? "todo" : "done";

    setStatusByTaskId((prev) => ({
      ...prev,
      [task.id]: next,
    }));
  }

  function addTaskForSelectedDate(): void {
    const title = newTaskTitle.trim();
    if (!title) return;

    const nextTask: UserTask = {
      id: `U-${Date.now()}`,
      title,
      dateKey: selectedDateKey,
      priority: newTaskPriority,
    };

    setUserTasks((prev) => {
      const next = [nextTask, ...prev];
      saveUserTasks(next);
      return next;
    });

    setNewTaskTitle("");
    setNewTaskPriority("medium");
  }

  function removeTask(task: DailyTask): void {
    if (task.source !== "user") return;

    setUserTasks((prev) => {
      const next = prev.filter((item) => item.id !== task.id);
      saveUserTasks(next);
      return next;
    });
  }

  return (
    <section className="rounded-xl bg-card p-4 md:p-6">
      <div className="relative mb-6 overflow-hidden">
        <Meteors
          number={18}
          angle={220}
          minDuration={3.4}
          maxDuration={7.8}
          minDelay={0.06}
          maxDelay={1.4}
          className="bg-sky-300/70"
        />

        <div className="relative z-10 flex items-end justify-between gap-4">
          <div
            key={`date-${selectedDateKey}`}
            className="daily-date-swap flex items-end gap-2"
          >
            <h2 className="text-7xl leading-none font-semibold tracking-tight text-zinc-900">
              {selectedDateNum}
            </h2>
            <span className="mb-2 inline-block size-4 rounded-full bg-[#f35f4e]" />
          </div>

          <div className="text-right">
            <h1 className="bg-linear-to-b from-zinc-950 via-zinc-700 to-zinc-400 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
              Briefly
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              Keep {profile.name || "your"} records organized by day/week/month.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-400 hover:text-zinc-700"
          onClick={() => setSelectedDate((prev) => shiftDate(prev, -1))}
          aria-label="Previous day"
        >
          <ChevronLeft />
        </Button>

        <div className="relative isolate min-w-0 flex-1 overflow-hidden rounded-lg">
          <div className="flex min-w-0 items-center justify-between gap-1">
            {visibleDates.map((date) => {
              const dateKey = toDateKey(date);
              const isSelected = dateKey === selectedDateKey;
              const isToday = dateKey === todayDateKey;
              const distance =
                Math.abs(date.getTime() - selectedDate.getTime()) /
                (24 * 60 * 60 * 1000);
              const faded = distance >= 4;
              const midFaded = distance === 3;
              const lowOpacityClass = faded
                ? "opacity-65"
                : midFaded
                  ? "opacity-75"
                  : distance === 2
                    ? "opacity-85"
                    : distance === 1
                      ? "opacity-95"
                      : "opacity-100";

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDate(shiftDate(date, 0))}
                  className={`relative min-w-[62px] rounded-lg px-1 py-1.5 text-center transition ${
                    isSelected
                      ? "bg-zinc-100 opacity-100"
                      : `${lowOpacityClass} hover:bg-zinc-50`
                  }`}
                >
                  {isToday && !isSelected && (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#f35f4e]" />
                  )}
                  <p
                    className={`text-3xl font-semibold ${isSelected ? "text-zinc-900" : "text-zinc-400"}`}
                  >
                    {date.getDate()}
                  </p>
                  <p
                    className={`text-sm font-semibold tracking-wide ${
                      isSelected ? "text-[#f35f4e]" : "text-zinc-400"
                    }`}
                  >
                    {WEEKDAY_SHORT[date.getDay()]}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[7%] bg-gradient-to-r from-background via-background/72 to-transparent backdrop-blur-[1px]" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[7%] bg-gradient-to-l from-background via-background/72 to-transparent backdrop-blur-[1px]" />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-400 hover:text-zinc-700"
          onClick={() => setSelectedDate((prev) => shiftDate(prev, 1))}
          aria-label="Next day"
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <div className="inline-flex w-fit rounded-lg bg-zinc-100 p-1">
          <Button
            type="button"
            variant={contentMode === "task" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-4"
            onClick={() => setContentMode("task")}
          >
            Task
          </Button>
          <Button
            type="button"
            variant={contentMode === "record" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-4"
            onClick={() => setContentMode("record")}
          >
            Record
          </Button>
        </div>
        <p className="self-center text-xs text-zinc-500">
          {contentMode === "task"
            ? `${selectedDayTasks.length} tasks`
            : `${selectedDayRecords.length} records`}
        </p>
      </div>

      {contentMode === "task" ? (
        <>
          <div className="mb-4 flex flex-col gap-2 md:flex-row">
            <Input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.currentTarget.value)}
              placeholder="Add task for selected date"
              onKeyDown={(event) => {
                if (event.key === "Enter") addTaskForSelectedDate();
              }}
            />
            <select
              value={newTaskPriority}
              onChange={(event) =>
                setNewTaskPriority(event.currentTarget.value as DailyTask["priority"])
              }
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <Button onClick={addTaskForSelectedDate}>Add</Button>
          </div>

          <div className="rounded-xl border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-medium text-zinc-600">Tasks for {selectedMonthDay}</p>
              <p className="text-xs text-zinc-400">{selectedDayTasks.length} items</p>
            </div>

            {selectedDayTasks.length > 0 ? (
              <ul>
                {selectedDayTasks.map((task) => {
                  const status = taskStatus(task);

                  return (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTaskStatus(task)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`inline-block size-4 rounded-full border ${
                            status === "done"
                              ? "border-zinc-900 bg-zinc-900"
                              : "border-zinc-300 bg-white"
                          }`}
                        />
                        <span
                          className={`truncate text-sm font-medium ${
                            status === "done"
                              ? "text-zinc-400 line-through"
                              : "text-zinc-900"
                          }`}
                        >
                          {task.title}
                        </span>
                      </button>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${priorityClass(task.priority)}`}
                        >
                          {task.priority}
                        </span>
                        {task.source === "user" ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => removeTask(task)}
                          >
                            Delete
                          </Button>
                        ) : (
                          <span className="text-[11px] text-zinc-400 uppercase">{task.source}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-zinc-400">
                No tasks for this date.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium text-zinc-600">
              Records for {selectedMonthDay}
            </p>
            <p className="text-xs text-zinc-400">{selectedDayRecords.length} items</p>
          </div>

          {selectedDayRecords.length > 0 ? (
            <ul className="space-y-3 px-4 py-4">
              {selectedDayRecords.map((record) => (
                <li key={record.id} className="rounded-lg border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">{formatDateTime(record.createdAt)}</p>
                    <Badge
                      variant="outline"
                      className={`text-[11px] uppercase ${
                        record.provider === "terminal"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-zinc-200 bg-zinc-50 text-zinc-600"
                      }`}
                    >
                      {record.provider}
                    </Badge>
                  </div>
                  {record.merged ? (
                    <div className="space-y-4">
                      <div className="rounded-lg bg-zinc-50 p-3">
                        <p className="text-xs font-medium text-zinc-500">Daily Summary</p>
                        <p className="mt-1 text-sm font-medium text-zinc-900">
                          {record.merged.dailySummary || "요약 없음"}
                        </p>
                        {record.merged.connectedProviders.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {record.merged.connectedProviders.map((provider) => (
                              <Badge key={provider} variant="secondary" className="text-[11px]">
                                {provider}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {record.merged.contexts.length > 0 ? (
                        <Accordion type="multiple" className="rounded-lg border px-3">
                          {record.merged.contexts.map((context) => (
                            <AccordionItem key={context.name} value={context.name} className="border-zinc-200">
                              <AccordionTrigger className="py-3">
                                <div className="min-w-0 text-left">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-zinc-900">{context.name}</span>
                                    <Badge variant="secondary" className="text-[11px]">
                                      {contextItemCount(context)} items
                                    </Badge>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-zinc-500">
                                    {context.summary || "No summary"}
                                  </p>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="space-y-3">
                                {context.doneTodos.length > 0 && (
                                  <section className="rounded-lg bg-emerald-50/60 p-3">
                                    <p className="mb-2 text-xs font-semibold tracking-wide text-emerald-700 uppercase">
                                      Done
                                    </p>
                                    <ul className="space-y-1.5">
                                      {context.doneTodos.map((todo) => (
                                        <li key={todo} className="flex items-start gap-2 text-sm text-zinc-800">
                                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                          <span>{todo}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </section>
                                )}

                                {(context.workLogs.length > 0 || context.issues.length > 0) && (
                                  <div className="grid gap-3 md:grid-cols-2">
                                    {context.workLogs.length > 0 && (
                                      <section className="rounded-lg bg-zinc-50 p-3">
                                        <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                                          Work Logs
                                        </p>
                                        <ul className="space-y-1">
                                          {context.workLogs.map((log) => (
                                            <li key={log} className="text-sm text-zinc-700">
                                              - {log}
                                            </li>
                                          ))}
                                        </ul>
                                      </section>
                                    )}
                                    {context.issues.length > 0 && (
                                      <section className="rounded-lg bg-zinc-50 p-3">
                                        <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                                          Issues
                                        </p>
                                        <ul className="space-y-1">
                                          {context.issues.map((issue) => (
                                            <li key={issue} className="text-sm text-zinc-700">
                                              - {issue}
                                            </li>
                                          ))}
                                        </ul>
                                      </section>
                                    )}
                                  </div>
                                )}

                                {context.evidence.length > 0 && (
                                  <section className="rounded-lg bg-zinc-50 p-3">
                                    <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                                      Evidence
                                    </p>
                                    <ul className="space-y-1.5">
                                      {context.evidence.slice(0, 6).map((item, idx) => (
                                        <li key={`${item.time}-${item.source}-${idx}`} className="text-xs text-zinc-600">
                                          <span className="font-medium text-zinc-700">
                                            [{item.time || "--:--"}] [{item.source || "log"}]
                                          </span>{" "}
                                          {item.text}
                                        </li>
                                      ))}
                                    </ul>
                                  </section>
                                )}
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      ) : (
                        <>
                          <section className="rounded-lg border p-3">
                            <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                              Done
                            </p>
                            {record.merged.doneTodos.length > 0 ? (
                              <ul className="space-y-1.5">
                                {record.merged.doneTodos.map((todo) => (
                                  <li key={todo} className="flex items-start gap-2 text-sm text-zinc-800">
                                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                    <span>{todo}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-zinc-400">No completed todo.</p>
                            )}
                          </section>

                        </>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                      {record.summary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">
              No records for this date yet. Try running Wrap Up Today.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
