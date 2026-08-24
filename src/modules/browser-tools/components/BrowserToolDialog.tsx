import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_BROWSER_TOOL_NAME_LENGTH,
  MAX_BROWSER_URL_BYTES,
  validateBrowserToolInput,
} from "@/modules/browser-tools/lib/browserState";
import type { BrowserToolInput } from "@/modules/browser-tools/lib/types";
import { useState } from "react";

export type BrowserToolDraft = BrowserToolInput;

export type BrowserToolDraftErrors = Partial<
  Record<keyof BrowserToolDraft, string>
>;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function validateBrowserToolDraft(
  draft: BrowserToolDraft,
): BrowserToolDraftErrors {
  const errors: BrowserToolDraftErrors = {};
  const name = draft.name.trim();
  const url = draft.url.trim();

  if (!name) errors.name = "Enter a tool name.";
  else if (name.length > MAX_BROWSER_TOOL_NAME_LENGTH)
    errors.name = `Use ${MAX_BROWSER_TOOL_NAME_LENGTH} characters or fewer.`;
  else if (CONTROL_CHARACTER_PATTERN.test(name))
    errors.name = "Remove control characters from the tool name.";

  if (!url) {
    errors.url = "Enter a website URL.";
    return errors;
  }
  if (CONTROL_CHARACTER_PATTERN.test(url)) {
    errors.url = "Remove control characters from the website URL.";
    return errors;
  }
  if (new TextEncoder().encode(url).length > MAX_BROWSER_URL_BYTES) {
    errors.url = `Use a URL shorter than ${MAX_BROWSER_URL_BYTES} bytes.`;
    return errors;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      errors.url = "Use an http:// or https:// URL.";
    else if (parsed.username || parsed.password)
      errors.url = "URLs containing a username or password are not allowed.";
  } catch {
    errors.url = "Enter a complete http:// or https:// URL.";
  }

  if (Object.keys(errors).length === 0) {
    const validation = validateBrowserToolInput({ name, url });
    if (!validation.ok) errors.url = validation.error;
  }

  return errors;
}

export function normalizeBrowserToolDraft(
  draft: BrowserToolDraft,
): BrowserToolDraft {
  const validation = validateBrowserToolInput(draft);
  return validation.ok
    ? validation.tool
    : { name: draft.name.trim(), url: draft.url.trim() };
}

export function BrowserToolDialog({
  open,
  tool,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  tool?: BrowserToolDraft;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: BrowserToolDraft) => void;
}) {
  const [draft, setDraft] = useState<BrowserToolDraft>(
    tool ?? { name: "", url: "" },
  );
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateBrowserToolDraft(draft) : {};
  const editing = tool !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (Object.keys(validateBrowserToolDraft(draft)).length > 0) return;
            onSubmit(normalizeBrowserToolDraft(draft));
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit website tool" : "Add website tool"}
            </DialogTitle>
            <DialogDescription>
              Saved tools open in the selected managed browser profile.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="browser-tool-name">Name</Label>
              <Input
                id="browser-tool-name"
                autoFocus
                value={draft.name}
                maxLength={MAX_BROWSER_TOOL_NAME_LENGTH + 1}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "browser-tool-name-error" : undefined
                }
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Google Flow"
              />
              {errors.name ? (
                <p
                  id="browser-tool-name-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {errors.name}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="browser-tool-url">Website URL</Label>
              <Input
                id="browser-tool-url"
                type="url"
                inputMode="url"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                value={draft.url}
                aria-invalid={Boolean(errors.url)}
                aria-describedby={
                  errors.url ? "browser-tool-url-error" : undefined
                }
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder="https://example.com/"
              />
              {errors.url ? (
                <p
                  id="browser-tool-url-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {errors.url}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">
              {editing ? "Save changes" : "Add tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
