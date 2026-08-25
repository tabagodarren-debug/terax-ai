import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SessionStartupKind } from "@/modules/recovery/lib/sessionRecovery";

type RecoveryKind = Extract<SessionStartupKind, "unclean" | "corrupt">;

export type SessionRecoveryDialogProps = {
  open: boolean;
  kind: RecoveryKind;
  busy: boolean;
  error: string | null;
  restorationFailed: boolean;
  onKeep: () => void;
  onDiscard: () => void;
};

export function recoveryDialogCopy(
  kind: RecoveryKind,
  restorationFailed = false,
) {
  if (restorationFailed) {
    return {
      title: "Workspace recovery needs attention",
      description:
        "Afflow detected a previous shutdown problem but could not load the last saved workstation state. Your workstation files were not changed. Continue with the fresh tab and restart Afflow to try loading the saved state again.",
    };
  }
  return kind === "corrupt"
    ? {
        title: "Previous shutdown could not be verified",
        description:
          "Afflow restored the last saved workstation and tabs because its session marker was invalid. Terminal tabs start as new sessions, and browser windows are not restored.",
      }
    : {
        title: "Workspace recovered",
        description:
          "Afflow did not shut down cleanly, so it restored the last saved workstation and tabs. Terminal tabs start as new sessions, and browser windows are not restored.",
      };
}

export function SessionRecoveryDialog({
  open,
  kind,
  busy,
  error,
  restorationFailed,
  onKeep,
  onDiscard,
}: SessionRecoveryDialogProps) {
  const copy = recoveryDialogCopy(kind, restorationFailed);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          {!restorationFailed ? (
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={onDiscard}
            >
              {busy ? "Starting fresh..." : "Start fresh"}
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction disabled={busy} onClick={onKeep}>
            {restorationFailed ? "Continue" : "Keep restored tabs"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
