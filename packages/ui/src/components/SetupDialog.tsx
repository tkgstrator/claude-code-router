import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfig } from "./ConfigProvider";
import { api } from "@/lib/api";

interface SetupDialogProps {
  open: boolean;
}

type Phase = "idle" | "saving" | "restarting";

// Generate 32 random bytes as 64-char lower-case hex (matches `openssl rand -hex 32`).
const generateHexKey = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export function SetupDialog({ open }: SetupDialogProps) {
  const { t } = useTranslation();
  const { config, setConfig } = useConfig();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  const isBusy = phase !== "idle";

  const handleGenerate = () => {
    setDraft(generateHexKey());
    setError(null);
  };

  const handleSave = async () => {
    if (!config) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError(t("setup.error_required"));
      return;
    }
    if (trimmed.length < 16) {
      setError(t("setup.error_too_short"));
      return;
    }
    setError(null);
    setPhase("saving");
    try {
      const next = { ...config, APIKEY: trimmed };
      await api.updateConfig(next);
      setConfig(next);
      // Persist locally so subsequent requests pass authentication after restart.
      api.setApiKey(trimmed);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "apiKey",
          newValue: trimmed,
          url: window.location.href,
        }),
      );
      await api.restartService();
      setPhase("restarting");
      // The server exits ~100ms after /api/restart returns; give it time to
      // come back up before reloading.
      setTimeout(() => window.location.reload(), 5000);
    } catch (err) {
      setError((err as Error).message ?? t("setup.error_save_failed"));
      setPhase("idle");
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t("setup.title")}</DialogTitle>
          <DialogDescription>{t("setup.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="setup-apikey">{t("setup.apiKey")}</Label>
          <div className="flex gap-2">
            <Input
              id="setup-apikey"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("setup.placeholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={isBusy}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerate}
              disabled={isBusy}
            >
              {t("setup.generate")}
            </Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {phase === "restarting" && (
            <p className="text-sm text-amber-600">{t("setup.waiting_restart")}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isBusy}
            className="w-full"
          >
            {phase === "saving"
              ? t("setup.saving")
              : phase === "restarting"
                ? t("setup.waiting_restart")
                : t("setup.save_and_restart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
