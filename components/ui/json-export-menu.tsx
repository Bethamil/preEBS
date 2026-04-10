"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
type ButtonSize = "sm" | "md" | "lg";
type Align = "left" | "right";
type ExportAction = "download" | "copy";

interface JsonExportMenuProps {
  exportUrl: string;
  fallbackFilename: string;
  buttonLabel: string;
  fetchErrorMessage: string;
  downloadSuccessMessage: string;
  copySuccessMessage: string;
  downloadErrorMessage?: string;
  copyErrorMessage?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: Align;
  disabled?: boolean;
  buttonClassName?: string;
}

function parseFilename(response: Response, fallbackFilename: string): string {
  const contentDisposition = response.headers.get("Content-Disposition");
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] ?? fallbackFilename;
}

function downloadJson(json: string, filename: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

async function copyJson(json: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(json);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = json;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

export function JsonExportMenu({
  exportUrl,
  fallbackFilename,
  buttonLabel,
  fetchErrorMessage,
  downloadSuccessMessage,
  copySuccessMessage,
  downloadErrorMessage = "Could not download JSON.",
  copyErrorMessage = "Could not copy JSON.",
  variant = "ghost",
  size = "sm",
  align = "right",
  disabled = false,
  buttonClassName,
}: JsonExportMenuProps) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ExportAction | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const runAction = async (action: ExportAction) => {
    setPendingAction(action);

    try {
      const response = await fetch(exportUrl, { cache: "no-store" });
      if (!response.ok) {
        pushToast(fetchErrorMessage, "error");
        return;
      }

      const json = await response.text();

      if (action === "copy") {
        await copyJson(json);
        pushToast(copySuccessMessage, "success");
      } else {
        downloadJson(json, parseFilename(response, fallbackFilename));
        pushToast(downloadSuccessMessage, "success");
      }

      setOpen(false);
    } catch {
      pushToast(action === "copy" ? copyErrorMessage : downloadErrorMessage, "error");
    } finally {
      setPendingAction(null);
    }
  };

  const busy = pendingAction !== null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        variant={variant}
        size={size}
        className={buttonClassName}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {buttonLabel}
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <path
            d="M4 6.5L8 10l4-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={buttonLabel}
          className={cn(
            "absolute top-full z-30 mt-2 min-w-44 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.28)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--color-text)] transition hover:bg-[var(--color-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            disabled={busy}
            onClick={() => void runAction("copy")}
          >
            <span>{pendingAction === "copy" ? "Copying..." : "Copy JSON"}</span>
            <span className="text-xs text-[var(--color-text-muted)]">Clipboard</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--color-text)] transition hover:bg-[var(--color-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            disabled={busy}
            onClick={() => void runAction("download")}
          >
            <span>{pendingAction === "download" ? "Downloading..." : "Download JSON"}</span>
            <span className="text-xs text-[var(--color-text-muted)]">File</span>
          </button>
        </div>
      )}
    </div>
  );
}
