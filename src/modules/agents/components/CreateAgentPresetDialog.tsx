import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_AGENT_PRESET_NAME_LENGTH,
  type NewAgentPresetInput,
  validateNewAgentPresetInput,
} from "@/modules/agents/lib/presets";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewAgentPresetInput) => Promise<void>;
};

export function CreateAgentPresetDialog({
  open,
  onOpenChange,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPrompt("");
    setError(null);
    setSaving(false);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);

  const submit = async () => {
    const validation = validateNewAgentPresetInput({ name, prompt });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: validation.name,
        prompt: validation.prompt,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.8} />
            New agent preset
          </DialogTitle>
          <DialogDescription>
            Name the preset and paste the complete prompt.md content. Afflow
            saves it inside this workstation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label
            htmlFor="agent-preset-name"
            className="grid gap-1.5 text-xs font-medium"
          >
            Preset name
            <Input
              id="agent-preset-name"
              ref={nameRef}
              value={name}
              maxLength={MAX_AGENT_PRESET_NAME_LENGTH}
              disabled={saving}
              placeholder="Product Researcher"
              onChange={(event) => {
                setName(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>

          <label
            htmlFor="agent-preset-prompt"
            className="grid gap-1.5 text-xs font-medium"
          >
            Prompt markdown
            <Textarea
              id="agent-preset-prompt"
              value={prompt}
              disabled={saving}
              spellCheck={false}
              className="min-h-56 resize-y font-mono text-xs"
              placeholder="# Role\n\nYou are...\n\n# Instructions\n\n- ..."
              onChange={(event) => {
                setPrompt(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
        </div>

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "Creating" : "Create preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
