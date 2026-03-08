import { Meteors } from "@/components/ui/meteors";
import type { ProfileConfig } from "@/features/briefly/types";

type MainHeaderProps = {
  profile: ProfileConfig;
};

export function MainHeader({ profile }: MainHeaderProps) {
  return (
    <header>
      <div className="relative h-[92px] w-[320px] overflow-hidden">
        <Meteors
          number={10}
          angle={220}
          minDuration={3}
          maxDuration={7}
          minDelay={0.2}
          maxDelay={1.4}
          className="bg-sky-300/70"
        />
        <div className="relative z-10 flex h-full flex-col items-start justify-center gap-1 px-4">
          <h1 className="bg-linear-to-b from-zinc-950 via-zinc-700 to-zinc-400 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">
            Briefly
          </h1>
          <p className="text-xs text-muted-foreground">
            {profile.name || "사용자"}님의 대화를 일/주/월 단위로 정리합니다.
          </p>
        </div>
      </div>
    </header>
  );
}
