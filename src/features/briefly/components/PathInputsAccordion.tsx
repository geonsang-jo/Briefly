import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import type { ProfileConfig } from "@/features/briefly/types";

export type PathInputsText = {
  trigger: string;
  description?: string;
  codexLabel: string;
  claudeLabel: string;
  cursorLabel: string;
  geminiLabel: string;
  codexPlaceholder: string;
  claudePlaceholder: string;
  cursorPlaceholder: string;
  geminiPlaceholder: string;
};

type PathInputsAccordionProps = {
  value: string;
  text: PathInputsText;
  profile: ProfileConfig;
  onProfileChange: (updater: (prev: ProfileConfig) => ProfileConfig) => void;
  className?: string;
  contentClassName?: string;
};

export function PathInputsAccordion({
  value,
  text,
  profile,
  onProfileChange,
  className = "rounded-md border bg-muted/30 px-3",
  contentClassName = "space-y-3 border-t px-0 pt-3",
}: PathInputsAccordionProps) {
  return (
    <Accordion type="single" collapsible className={className}>
      <AccordionItem value={value} className="border-b-0">
        <AccordionTrigger>{text.trigger}</AccordionTrigger>
        <AccordionContent className={contentClassName}>
          {text.description && (
            <p className="text-xs text-muted-foreground">{text.description}</p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">{text.codexLabel}</label>
            <Input
              value={profile.codexRootPath}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                onProfileChange((prev) => ({ ...prev, codexRootPath: nextValue }));
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
              placeholder={text.codexPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{text.claudeLabel}</label>
            <Input
              value={profile.claudeRootPath}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                onProfileChange((prev) => ({ ...prev, claudeRootPath: nextValue }));
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
              placeholder={text.claudePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{text.cursorLabel}</label>
            <Input
              value={profile.cursorRootPath}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                onProfileChange((prev) => ({ ...prev, cursorRootPath: nextValue }));
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
              placeholder={text.cursorPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{text.geminiLabel}</label>
            <Input
              value={profile.geminiRootPath}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                onProfileChange((prev) => ({ ...prev, geminiRootPath: nextValue }));
              }}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm font-mono"
              placeholder={text.geminiPlaceholder}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
