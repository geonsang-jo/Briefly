import * as React from "react";
import {
  motion,
  type Transition,
  type UseInViewOptions,
  useInView,
} from "motion/react";

const ENTRY_ANIMATION = {
  initial: { rotateX: 0 },
  animate: { rotateX: 90 },
};

const EXIT_ANIMATION = {
  initial: { rotateX: 90 },
  animate: { rotateX: 0 },
};

const formatCharacter = (char: string) => (char === " " ? "\u00A0" : char);

export type RollingTextProps = Omit<React.ComponentProps<"span">, "children"> & {
  transition?: Transition;
  inView?: boolean;
  inViewMargin?: UseInViewOptions["margin"];
  inViewOnce?: boolean;
  text: string;
};

export const RollingText = React.forwardRef<HTMLSpanElement, RollingTextProps>(
  (
    {
      transition = { duration: 0.5, delay: 0.1, ease: "easeOut" },
      inView = false,
      inViewMargin = "0px",
      inViewOnce = true,
      text,
      ...props
    },
    ref,
  ) => {
    const localRef = React.useRef<HTMLSpanElement>(null);
    React.useImperativeHandle(ref, () => localRef.current as HTMLSpanElement);

    const inViewResult = useInView(localRef, {
      once: inViewOnce,
      margin: inViewMargin,
    });
    const isInView = !inView || inViewResult;

    const characters = React.useMemo(() => text.split(""), [text]);
    const charDelay = typeof transition.delay === "number" ? transition.delay : 0.1;

    return (
      <span data-slot="rolling-text" {...props} ref={localRef}>
        {characters.map((char, idx) => (
          <span
            key={idx}
            aria-hidden="true"
            className="relative inline-block w-auto transform-3d perspective-[9999999px]"
          >
            <motion.span
              initial={ENTRY_ANIMATION.initial}
              animate={isInView ? ENTRY_ANIMATION.animate : undefined}
              className="absolute inline-block origin-[50%_25%] backface-hidden"
              transition={{
                ...transition,
                delay: idx * charDelay,
              }}
            >
              {formatCharacter(char)}
            </motion.span>
            <motion.span
              initial={EXIT_ANIMATION.initial}
              animate={isInView ? EXIT_ANIMATION.animate : undefined}
              className="absolute inline-block origin-[50%_100%] backface-hidden"
              transition={{
                ...transition,
                delay: idx * charDelay + 0.3,
              }}
            >
              {formatCharacter(char)}
            </motion.span>
            <span className="invisible">{formatCharacter(char)}</span>
          </span>
        ))}

        <span className="sr-only">{text}</span>
      </span>
    );
  },
);

RollingText.displayName = "RollingText";

export default RollingText;
