import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShineBorder } from "@/components/ui/shine-border";
import { Spinner } from "@/components/ui/spinner";
import joi24Icon from "@/assets/joi24_icon.svg";
import {
  ONBOARDING_STEP_LABELS,
  PATH_PROVIDERS,
} from "@/features/briefly/constants";
import type {
  DetectLogPathsResult,
  PathProviderKey,
  ProfileConfig,
} from "@/features/briefly/types";

type OnboardingScreenProps = {
  onboardingStep: number;
  setOnboardingStep: (updater: number | ((prev: number) => number)) => void;
  canMoveToNextOnboardingStep: boolean;
  formProfile: ProfileConfig;
  setFormProfile: (updater: (prev: ProfileConfig) => ProfileConfig) => void;
  isCheckingPaths: boolean;
  pathStatus: DetectLogPathsResult | null;
  onCheckAllLogPaths: () => void;
  onCompleteOnboarding: () => void;
  isSummarizing: boolean;
};

export function OnboardingScreen({
  onboardingStep,
  setOnboardingStep,
  canMoveToNextOnboardingStep,
  formProfile,
  setFormProfile,
  isCheckingPaths,
  pathStatus,
  onCheckAllLogPaths,
  onCompleteOnboarding,
  isSummarizing,
}: OnboardingScreenProps) {
  const [rollingIndex, setRollingIndex] = useState(0);
  const [activeBeamIndex, setActiveBeamIndex] = useState(0);
  const rollingAi = PATH_PROVIDERS[rollingIndex % PATH_PROVIDERS.length]?.label;

  const beamContainerRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const claudeRef = useRef<HTMLDivElement>(null);
  const codexRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const geminiRef = useRef<HTMLDivElement>(null);

  const providerNodes = useMemo(
    () => [
      {
        key: "claude" as const,
        label: "Claude",
        img: PATH_PROVIDERS.find((item) => item.key === "claude")?.img,
        ref: claudeRef,
        className: "left-[22%] top-[26%]",
      },
      {
        key: "codex" as const,
        label: "Codex",
        img: PATH_PROVIDERS.find((item) => item.key === "codex")?.img,
        ref: codexRef,
        className: "left-[78%] top-[26%]",
      },
      {
        key: "cursor" as const,
        label: "Cursor",
        img: PATH_PROVIDERS.find((item) => item.key === "cursor")?.img,
        ref: cursorRef,
        className: "left-[22%] top-[74%]",
      },
      {
        key: "gemini" as const,
        label: "Gemini",
        img: PATH_PROVIDERS.find((item) => item.key === "gemini")?.img,
        ref: geminiRef,
        className: "left-[78%] top-[74%]",
      },
    ],
    [],
  );

  useEffect(() => {
    if (onboardingStep !== 1) return;

    const timer = window.setInterval(() => {
      setRollingIndex((prev) => (prev + 1) % PATH_PROVIDERS.length);
    }, 1200);

    return () => window.clearInterval(timer);
  }, [onboardingStep]);

  useEffect(() => {
    if (!isCheckingPaths || onboardingStep !== 1) {
      setActiveBeamIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setActiveBeamIndex((prev) => (prev + 1) % PATH_PROVIDERS.length);
    }, 780);

    return () => window.clearInterval(timer);
  }, [isCheckingPaths, onboardingStep]);

  function getProviderState(key: PathProviderKey) {
    const status = pathStatus?.[key];

    if (!status) return "idle" as const;
    if (isCheckingPaths && status.resolvedPath === "-")
      return "pending" as const;
    if (status.exists && status.hasJsonl) return "found" as const;
    return "missing" as const;
  }

  const hasScanResult =
    Boolean(pathStatus) &&
    Object.values(pathStatus ?? {}).some(
      (status) => status.resolvedPath !== "-",
    );
  const hasTriggeredScan = pathStatus !== null;
  const canContinueOnboarding =
    formProfile.name.trim().length > 0 && hasTriggeredScan && !isCheckingPaths;

  function shouldAnimateNode(key: PathProviderKey, index: number): boolean {
    const state = getProviderState(key);

    if (isCheckingPaths) {
      if (state === "missing") return false;
      return index === activeBeamIndex;
    }

    if (!hasScanResult) {
      return false;
    }

    return state === "found";
  }

  function getBeamVisual(key: PathProviderKey) {
    if (key === "claude") {
      return {
        reverse: false,
        curvature: -46,
        endXOffset: -14,
        endYOffset: -10,
      };
    }

    if (key === "cursor") {
      return {
        reverse: false,
        curvature: 46,
        endXOffset: -14,
        endYOffset: 10,
      };
    }

    if (key === "codex") {
      return {
        reverse: true,
        curvature: -46,
        endXOffset: 14,
        endYOffset: -10,
      };
    }

    return {
      reverse: true,
      curvature: 46,
      endXOffset: 14,
      endYOffset: 10,
    };
  }

  return (
    <main className="onboarding-animated-bg relative min-h-screen w-full overflow-hidden bg-[linear-gradient(135deg,#F7F8F7_0%,#F3F7F5_50%,#EEF3F2_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="onboarding-bg-blob onboarding-bg-blob-a" />
        <div className="onboarding-bg-blob onboarding-bg-blob-b" />
        <div className="onboarding-bg-blob onboarding-bg-blob-c" />
      </div>

      <section className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
        <section className="flex min-h-full w-full max-w-5xl flex-col">
          <div className="flex flex-1 items-center justify-center">
            <div
              key={onboardingStep}
              className={`onboarding-step-enter w-full space-y-7 ${
                onboardingStep === 1 ? "max-w-2xl" : "max-w-xl"
              }`}
            >
              <div className="space-y-3 gap-[8px]">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">
                  Briefly
                </p>
                <h1 className="leading-tighter text-3xl font-semibold tracking-tight text-balance text-primary lg:leading-[1.1] lg:font-semibold xl:text-5xl xl:tracking-tighter max-w-4xl">
                  {onboardingStep === 0
                    ? "Keep the work. Keep the record."
                    : `Hello, ${formProfile.name.trim() || "there"}. I'll help you keep your record.`}
                </h1>
                <p className="max-w-4xl text-base text-balance text-foreground sm:text-lg">
                  {onboardingStep === 0
                    ? "Set your profile first, then move to path detection."
                    : "Pick the AI tools you use and check detected paths. Optional edits can be done later in Settings."}
                </p>
              </div>

              {onboardingStep === 0 && (
                <div className="space-y-2">
                  <label
                    htmlFor="onboarding-name"
                    className="text-sm font-medium text-zinc-700"
                  >
                    Name
                  </label>
                  <div className="group relative overflow-hidden rounded-md">
                    <ShineBorder
                      borderWidth={1.2}
                      duration={10}
                      shineColor={["#8fc1d6", "#b5dae7", "#d0e6ee"]}
                      className="z-20 opacity-45 transition-opacity duration-300 group-focus-within:opacity-100"
                      style={{ backgroundSize: "180% 180%" }}
                    />
                    <Input
                      id="onboarding-name"
                      value={formProfile.name}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        setFormProfile((prev) => ({
                          ...prev,
                          name: nextValue,
                        }));
                      }}
                      className="relative z-10 h-12 border-zinc-200 bg-white/92 focus-visible:border-[#9fc8d6] focus-visible:ring-[4px] focus-visible:ring-[#c5dfe8]/45"
                      placeholder="e.g. Geon"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        if (event.nativeEvent.isComposing) return;
                        if (!canMoveToNextOnboardingStep) return;

                        setOnboardingStep((prev) =>
                          Math.min(ONBOARDING_STEP_LABELS.length - 1, prev + 1),
                        );
                      }}
                    />
                  </div>
                </div>
              )}

              {onboardingStep === 1 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-500">
                      Pick Your
                    </span>
                    <Button
                      type="button"
                      variant={isCheckingPaths ? "outline" : "outline"}
                      className={`h-8 px-3 text-sm ${
                        isCheckingPaths ? "" : "cursor-pointer"
                      }`}
                      onClick={onCheckAllLogPaths}
                      disabled={isCheckingPaths}
                    >
                      {isCheckingPaths ? (
                        <>
                          <Spinner
                            data-icon="inline-start"
                            className="size-3.5"
                          />
                          Scanning
                        </>
                      ) : (
                        "Scan your AI tools"
                      )}
                    </Button>
                    <span className="relative inline-flex h-6 min-w-[120px] items-center overflow-hidden align-middle">
                      <span
                        key={rollingAi}
                        className="onboarding-ai-roll-single absolute inset-0"
                      >
                        {rollingAi} AI
                      </span>
                    </span>
                  </div>

                  <div
                    ref={beamContainerRef}
                    className="relative mx-auto h-[200px] w-full overflow-hidden"
                  >
                    {providerNodes.map((node) => {
                      const beamVisual = getBeamVisual(node.key);
                      const staticPathColor = "#d4d4d8";

                      return (
                        <AnimatedBeam
                          key={`base-line-${node.key}`}
                          containerRef={beamContainerRef}
                          fromRef={node.ref}
                          toRef={centerRef}
                          reverse={beamVisual.reverse}
                          curvature={beamVisual.curvature}
                          endXOffset={beamVisual.endXOffset}
                          endYOffset={beamVisual.endYOffset}
                          pathColor={staticPathColor}
                          gradientStartColor="transparent"
                          gradientStopColor="transparent"
                          pathOpacity={0.34}
                          pathWidth={1.05}
                          duration={1}
                          delay={0}
                        />
                      );
                    })}

                    {providerNodes.map((node, index) => {
                      if (!shouldAnimateNode(node.key, index)) return null;

                      const state = getProviderState(node.key);
                      const beamVisual = getBeamVisual(node.key);

                      const gradientStartColor =
                        state === "found" ? "#86efac" : "#bae6fd";
                      const gradientStopColor =
                        state === "found" ? "#22c55e" : "#0ea5e9";

                      return (
                        <AnimatedBeam
                          key={`beam-${node.key}`}
                          containerRef={beamContainerRef}
                          fromRef={node.ref}
                          toRef={centerRef}
                          reverse={beamVisual.reverse}
                          curvature={beamVisual.curvature}
                          endXOffset={beamVisual.endXOffset}
                          endYOffset={beamVisual.endYOffset}
                          pathColor="#d4d4d8"
                          gradientStartColor={gradientStartColor}
                          gradientStopColor={gradientStopColor}
                          pathOpacity={0}
                          pathWidth={1.25}
                          duration={isCheckingPaths ? 3 : 3.2}
                          delay={0}
                        />
                      );
                    })}

                    <div className="absolute inset-0">
                      {providerNodes.map((node, index) => {
                        const isActive =
                          isCheckingPaths && shouldAnimateNode(node.key, index);
                        const state = getProviderState(node.key);

                        const nodeStateClass =
                          state === "found"
                            ? "opacity-100 scale-105 drop-shadow-[0_10px_16px_rgba(34,197,94,0.25)]"
                            : state === "missing"
                              ? "opacity-45 grayscale"
                              : isActive
                                ? "opacity-100 scale-110 drop-shadow-[0_10px_16px_rgba(6,182,212,0.28)]"
                                : "opacity-80";
                        const nodeBorderClass =
                          state === "found"
                            ? "border-emerald-400"
                            : isActive
                              ? "border-cyan-300"
                              : "border-zinc-200";

                        return (
                          <div
                            key={node.key}
                            className={`absolute -translate-x-1/2 -translate-y-1/2 transition ${node.className} ${nodeStateClass}`}
                          >
                            <div
                              ref={node.ref}
                              className={`flex size-12 items-center justify-center rounded-2xl border bg-white p-2 shadow-[0_0_20px_-12px_rgba(0,0,0,0.4)] ${nodeBorderClass}`}
                            >
                              <img
                                src={node.img}
                                alt={`${node.label} logo`}
                                className="size-7 object-contain"
                              />
                            </div>
                          </div>
                        );
                      })}

                      <div
                        ref={centerRef}
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                      >
                        <img
                          src={joi24Icon}
                          alt="Briefly service icon"
                          className="size-11 rounded-xl object-cover shadow-[0_10px_20px_-12px_rgba(15,23,42,0.65)]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-xl space-y-3 pt-6">
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {ONBOARDING_STEP_LABELS.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setOnboardingStep(index)}
                      className={`h-2.5 rounded-full transition-all ${
                        onboardingStep === index
                          ? "w-7 bg-zinc-900"
                          : "w-2.5 bg-zinc-300"
                      }`}
                      aria-label={`Move to ${label} step`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {onboardingStep > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setOnboardingStep((prev) => Math.max(0, prev - 1))
                    }
                    className="cursor-pointer"
                  >
                    Back
                  </Button>
                )}

                {onboardingStep < ONBOARDING_STEP_LABELS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setOnboardingStep((prev) =>
                        Math.min(ONBOARDING_STEP_LABELS.length - 1, prev + 1),
                      )
                    }
                    disabled={!canMoveToNextOnboardingStep}
                    className="cursor-pointer"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    onClick={onCompleteOnboarding}
                    disabled={isSummarizing || !canContinueOnboarding}
                    className="cursor-pointer"
                  >
                    Continue
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
