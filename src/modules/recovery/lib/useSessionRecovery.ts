import {
  acknowledgeSessionRecovery,
  readSessionStartupStatus,
  runRecoveryDiscard,
  type SessionStartupKind,
} from "@/modules/recovery/lib/sessionRecovery";
import { useCallback, useEffect, useRef, useState } from "react";

let recoveryAcknowledged = false;

type Params = {
  ready: boolean;
  restorationSucceeded: boolean;
  onDiscard: () => void | Promise<void>;
};

type RecoveryState = {
  open: boolean;
  kind: Extract<SessionStartupKind, "unclean" | "corrupt">;
  busy: boolean;
  error: string | null;
  restorationFailed: boolean;
  settled: boolean;
  keepRecovered: () => Promise<void>;
  discardRecovered: () => Promise<void>;
};

export function useSessionRecovery({
  ready,
  restorationSucceeded,
  onDiscard,
}: Params): RecoveryState {
  const [kind, setKind] = useState<SessionStartupKind | null>(null);
  const [dismissed, setDismissed] = useState(recoveryAcknowledged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discarding = useRef(false);

  useEffect(() => {
    let active = true;
    void readSessionStartupStatus()
      .then((result) => {
        if (active) setKind(result.status);
      })
      .catch((reason) => {
        console.error("[afflow] session recovery status failed:", reason);
        if (active) {
          setKind("corrupt");
          setError(
            "Afflow could not verify session recovery. The saved workspace was loaded without changing your files.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const keepRecovered = useCallback(async () => {
    if (discarding.current) return;
    discarding.current = true;
    setBusy(true);
    setError(null);
    try {
      await acknowledgeSessionRecovery();
      recoveryAcknowledged = true;
      setDismissed(true);
    } catch {
      setError("Afflow could not record the recovery choice. Try again.");
    } finally {
      discarding.current = false;
      setBusy(false);
    }
  }, []);

  const discardRecovered = useCallback(async () => {
    if (discarding.current) return;
    discarding.current = true;
    setBusy(true);
    setError(null);
    try {
      const nextError = await runRecoveryDiscard(onDiscard);
      if (nextError) {
        setError(nextError);
        return;
      }
      await acknowledgeSessionRecovery();
      recoveryAcknowledged = true;
      setDismissed(true);
    } catch {
      setError("Afflow could not record the recovery choice. Try again.");
    } finally {
      discarding.current = false;
      setBusy(false);
    }
  }, [onDiscard]);

  const recoveryKind = kind === "corrupt" ? "corrupt" : "unclean";
  const needsDecision = kind === "unclean" || kind === "corrupt";
  return {
    open: ready && !dismissed && needsDecision,
    kind: recoveryKind,
    busy,
    error,
    restorationFailed: ready && !restorationSucceeded,
    settled: kind !== null && (!needsDecision || dismissed),
    keepRecovered,
    discardRecovered,
  };
}
