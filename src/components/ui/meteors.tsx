import React, { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface MeteorsProps {
  number?: number;
  minDelay?: number;
  maxDelay?: number;
  minDuration?: number;
  maxDuration?: number;
  angle?: number;
  className?: string;
}

type MeteorStyle = React.CSSProperties & { "--angle": string };

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
}: MeteorsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [meteorStyles, setMeteorStyles] = useState<MeteorStyle[]>([]);

  useEffect(() => {
    const buildStyles = () => {
      const width = Math.max(containerRef.current?.clientWidth ?? 0, 1);
      const height = Math.max(containerRef.current?.clientHeight ?? 0, 1);
      const styles = [...new Array(number)].map(() => {
        return {
          "--angle": `${-angle}deg`,
          top: `${Math.floor(Math.random() * Math.max(height - 8, 8))}px`,
          left: `${Math.floor(Math.random() * width)}px`,
          animationDelay: `${Math.random() * (maxDelay - minDelay) + minDelay}s`,
          animationDuration: `${Math.random() * (maxDuration - minDuration) + minDuration}s`,
        };
      });
      setMeteorStyles(styles);
    };

    buildStyles();
    window.addEventListener("resize", buildStyles);
    return () => window.removeEventListener("resize", buildStyles);
  }, [angle, maxDelay, maxDuration, minDelay, minDuration, number]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {meteorStyles.map((style, idx) => (
        <span
          key={idx}
          style={style}
          className={cn(
            "animate-meteor absolute size-0.5 rotate-(--angle) rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className,
          )}
        >
          <div className="absolute top-1/2 -z-10 h-px w-12.5 -translate-y-1/2 bg-linear-to-r from-zinc-500 to-transparent" />
        </span>
      ))}
    </div>
  );
};
