import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { BrowserToolLauncherProps } from "@/modules/browser-tools/components/BrowserToolLauncher";
import { BrowserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useState } from "react";

const BrowserToolLauncher = lazy(async () => {
  const module = await import(
    "@/modules/browser-tools/components/BrowserToolLauncher"
  );
  return { default: module.BrowserToolLauncher };
});

export function BrowserToolsMenu({
  launcher,
}: {
  launcher: BrowserToolLauncherProps;
}) {
  const [open, setOpen] = useState(false);

  const setMenuOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    launcher.onMenuOpenChange?.(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Browser tools"
          title="Browser tools"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={BrowserIcon} size={16} strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="max-h-[calc(100vh-24px)] w-[430px] max-w-[calc(100vw-16px)] gap-0 overflow-y-auto rounded-lg p-0"
      >
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="Loading browser tools"
              className="flex h-48 items-center justify-center"
            >
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          }
        >
          <BrowserToolLauncher
            key={launcher.contextKey}
            {...launcher}
            onLaunchAll={() => {
              launcher.onLaunchAll();
              setMenuOpen(false);
            }}
            onLaunchTool={(tool) => {
              launcher.onLaunchTool(tool);
              setMenuOpen(false);
            }}
            onOpenBrowserSettings={() => {
              setMenuOpen(false);
              launcher.onOpenBrowserSettings?.();
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
