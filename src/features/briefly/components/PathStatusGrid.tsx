import { AlertCircle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PATH_PROVIDERS } from "@/features/briefly/constants";
import type {
  DetectLogPathsResult,
  PathCheckStatus,
  PathProviderKey,
  PathStatusMeta,
} from "@/features/briefly/types";

type PathStatusGridProps = {
  pathStatus: DetectLogPathsResult | null;
  getPathStatusMeta: (status: PathCheckStatus | undefined) => PathStatusMeta;
  checkingKey?: PathProviderKey | null;
  cardClassName?: string;
};

export function PathStatusGrid({
  pathStatus,
  getPathStatusMeta,
  checkingKey = null,
  cardClassName = "rounded-md border bg-muted/40 px-3 py-2 text-xs",
}: PathStatusGridProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PATH_PROVIDERS.map(({ key, label }) => {
        const status = pathStatus?.[key];
        const meta = getPathStatusMeta(status);
        const isChecking = checkingKey === key;

        return (
          <div
            key={key}
            className={cn(
              cardClassName,
              isChecking && "border-sky-300/70 bg-sky-50/70 ring-2 ring-sky-200/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{label}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                  isChecking
                    ? "border border-sky-200 bg-sky-100 text-sky-700"
                    : meta.badgeClass
                }`}
              >
                {isChecking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : meta.icon === "ok" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : meta.icon === "warn" ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5" />
                )}
                {isChecking ? "Scanning" : meta.label}
              </span>
            </div>
            <p className="mt-1 truncate text-muted-foreground">
              {isChecking ? "Searching..." : status?.resolvedPath ?? "-"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
