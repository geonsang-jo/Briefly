import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PathInputsAccordion } from "@/features/briefly/components/PathInputsAccordion";
import { PathStatusGrid } from "@/features/briefly/components/PathStatusGrid";
import type {
  DetectLogPathsResult,
  PathCheckStatus,
  PathStatusMeta,
  ProfileConfig,
} from "@/features/briefly/types";

const SETTINGS_PATH_TEXT = {
  trigger: "직접 경로 입력 (선택)",
  description: "기본 경로가 아닌 경우에만 입력해 주세요.",
  codexLabel: "Codex 루트 경로",
  claudeLabel: "Claude 루트 경로",
  cursorLabel: "Cursor 루트 경로",
  geminiLabel: "Gemini 루트 경로",
  codexPlaceholder: "예: /custom/path/.codex",
  claudePlaceholder: "예: /custom/path/.claude",
  cursorPlaceholder: "예: /custom/path/.cursor",
  geminiPlaceholder: "예: /custom/path/.gemini",
};

type SettingsViewProps = {
  formProfile: ProfileConfig;
  setFormProfile: (updater: (prev: ProfileConfig) => ProfileConfig) => void;
  isCheckingPaths: boolean;
  pathStatus: DetectLogPathsResult | null;
  getPathStatusMeta: (status: PathCheckStatus | undefined) => PathStatusMeta;
  onCheckAllLogPaths: () => void;
  onResetAllDataAndGoOnboarding: () => void;
  onSaveSettings: () => void;
};

export function SettingsView({
  formProfile,
  setFormProfile,
  isCheckingPaths,
  pathStatus,
  getPathStatusMeta,
  onCheckAllLogPaths,
  onResetAllDataAndGoOnboarding,
  onSaveSettings,
}: SettingsViewProps) {
  return (
    <section className="max-w-2xl space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-medium">설정</h2>

      <div className="space-y-2">
        <label className="text-sm font-medium">이름</label>
        <Input
          value={formProfile.name}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            setFormProfile((prev) => ({ ...prev, name: nextValue }));
          }}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          placeholder="이름"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">오늘 정리 명령어 (선택)</label>
        <textarea
          value={formProfile.finishCommand}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            setFormProfile((prev) => ({ ...prev, finishCommand: nextValue }));
          }}
          className="min-h-28 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
          placeholder="예: my-summary-cli --format daily"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">사용 AI CLI 검색</label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onCheckAllLogPaths}
            disabled={isCheckingPaths}
            className="cursor-pointer"
          >
            {isCheckingPaths ? "검색 중..." : "전체 경로 검색"}
          </Button>
        </div>

        <PathStatusGrid
          pathStatus={pathStatus}
          getPathStatusMeta={getPathStatusMeta}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={formProfile.collectFromLocalLogs}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setFormProfile((prev) => ({
              ...prev,
              collectFromLocalLogs: checked,
            }));
          }}
        />
        입력칸이 비어 있으면 오늘 로컬 터미널 로그 자동 수집
      </label>

      <PathInputsAccordion
        value="settings-path-inputs"
        text={SETTINGS_PATH_TEXT}
        profile={formProfile}
        onProfileChange={setFormProfile}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={formProfile.autoSummarizeOnFinish}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setFormProfile((prev) => ({
              ...prev,
              autoSummarizeOnFinish: checked,
            }));
          }}
        />
        오늘 정리 시 자동 요약 실행
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="destructive"
          onClick={onResetAllDataAndGoOnboarding}
          className="cursor-pointer"
        >
          데이터 초기화 후 스텝 이동
        </Button>
        <Button onClick={onSaveSettings} className="cursor-pointer">
          저장
        </Button>
      </div>
    </section>
  );
}
