import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BrowserProfileResetDialog({
  open,
  browserName,
  profileLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  browserName: string;
  profileLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm" className="rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset managed browser profile?</AlertDialogTitle>
          <AlertDialogDescription>
            This clears browsing data and sign-ins from the {profileLabel}{" "}
            {browserName}
            profile. Other Afflow profiles and your normal browser profile are
            not changed. Close its browser window before continuing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Reset profile
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
