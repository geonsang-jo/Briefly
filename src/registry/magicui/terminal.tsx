import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type TerminalProps = React.ComponentPropsWithoutRef<"div">;

const Terminal = React.forwardRef<HTMLDivElement, TerminalProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "w-full space-y-1 overflow-auto rounded-2xl border border-zinc-700/70 bg-[#0b1220] p-3 font-mono text-[12px] leading-5 text-zinc-200",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Terminal.displayName = "Terminal";

type AnimatedSpanProps = React.ComponentPropsWithoutRef<typeof motion.div>;

function AnimatedSpan({ className, children, ...props }: AnimatedSpanProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className={cn("whitespace-pre-wrap break-words", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

type TypingAnimationProps = Omit<React.ComponentPropsWithoutRef<"div">, "children"> & {
  children: string;
  duration?: number;
};

function TypingAnimation({
  className,
  children,
  duration = 16,
  ...props
}: TypingAnimationProps) {
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    setVisibleCount(0);
    setDone(false);
    if (!children) {
      setDone(true);
      return;
    }

    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleCount(index);
      if (index >= children.length) {
        setDone(true);
        window.clearInterval(timer);
      }
    }, duration);

    return () => window.clearInterval(timer);
  }, [children, duration]);

  return (
    <div
      className={cn("whitespace-pre-wrap break-words", className)}
      {...props}
    >
      {children.slice(0, visibleCount)}
      {!done && <span className="ml-0.5 inline-block animate-pulse">|</span>}
    </div>
  );
}

export { AnimatedSpan, Terminal, TypingAnimation };
