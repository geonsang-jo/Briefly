import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  AnimatedSpan,
  Terminal,
  TypingAnimation,
} from "@/registry/magicui/terminal";

export type WrapUpRunStatus = "idle" | "running" | "done" | "error";
export type WrapUpLogKind = "info" | "ok" | "warn" | "error";

export type WrapUpLogLine = {
  id: number;
  kind: WrapUpLogKind;
  text: string;
};

type WrapUpTerminalSheetProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  status: WrapUpRunStatus;
  logs: WrapUpLogLine[];
};

function kindPrefix(kind: WrapUpLogKind): string {
  if (kind === "ok") return "✓";
  if (kind === "warn") return "!";
  if (kind === "error") return "x";
  return "$";
}

function kindClassName(kind: WrapUpLogKind): string {
  if (kind === "ok") return "text-emerald-300";
  if (kind === "warn") return "text-amber-300";
  if (kind === "error") return "text-rose-300";
  return "text-sky-300";
}

export function WrapUpTerminalSheet({
  open,
  onOpenChange,
  status,
  logs,
}: WrapUpTerminalSheetProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [logs, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-auto right-auto bottom-0 left-1/2 w-[min(920px,calc(100%-1rem))] max-w-none translate-x-[-50%] translate-y-0 gap-0 rounded-t-3xl rounded-b-none border-0 bg-[#f5f8f7]/96 p-0 shadow-[0_-20px_60px_-24px_rgba(15,23,42,0.4)] backdrop-blur-xl data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
      >
        <div className="mx-auto mt-2 h-1.5 w-14 rounded-full bg-zinc-300/80" />

        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-3">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-base font-semibold text-zinc-900">
              Daily Wrap Up
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              Running connected AI CLI and saving summary to{" "}
              <code>~/.briefly</code>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            {status === "running" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white">
                <Spinner data-icon="inline-start" className="size-3" />
                Running
              </span>
            )}
            {status === "done" && (
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white">
                Completed
              </span>
            )}
            {status === "error" && (
              <span className="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white">
                Error
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              className="text-zinc-500 hover:text-zinc-900"
              disabled={status === "running"}
              aria-label="Close wrap-up terminal"
            >
              <X />
            </Button>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-[#0b1220]">
            <div className="flex items-center gap-2 border-b border-zinc-700/70 px-3 py-2">
              <span className="size-2.5 rounded-full bg-rose-400" />
              <span className="size-2.5 rounded-full bg-amber-400" />
              <span className="size-2.5 rounded-full bg-emerald-400" />
              <p className="ml-1 text-[11px] tracking-wide text-zinc-400">
                briefly-wrapup.log
              </p>
            </div>

            <Terminal
              ref={viewportRef}
              className="max-h-[42vh] min-h-[220px] rounded-none border-0 bg-transparent p-3"
            >
              {logs.length === 0 ? (
                <TypingAnimation className="text-zinc-500">
                  $ Waiting for wrap-up run...
                </TypingAnimation>
              ) : (
                logs.map((line) =>
                  line.text.includes("Running:") ? (
                    <TypingAnimation
                      key={line.id}
                      className={kindClassName(line.kind)}
                    >
                      {`$ ${line.text}`}
                    </TypingAnimation>
                  ) : (
                    <AnimatedSpan
                      key={line.id}
                      className={kindClassName(line.kind)}
                    >
                      {`${kindPrefix(line.kind)} ${line.text}`}
                    </AnimatedSpan>
                  ),
                )
              )}
            </Terminal>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
