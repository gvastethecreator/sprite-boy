import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Upload } from "lucide-react";

export type FileDropAssetKind = "file" | "image";

export interface FileDropControlProps {
  readonly accept: string;
  readonly assetKind?: FileDropAssetKind;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly multiple?: boolean;
  readonly name?: string;
  readonly onFileSelect?: (file: File) => void;
  readonly onFilesSelect?: (files: readonly File[]) => void;
}

const ACCEPT_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  gif: [".gif", "image/gif"],
  jpeg: [".jpg", ".jpeg", "image/jpeg"],
  jpg: [".jpg", ".jpeg", "image/jpeg"],
  mp4: [".mp4", "video/mp4"],
  png: [".png", "image/png"],
  webm: [".webm", "video/webm"],
  webp: [".webp", "image/webp"],
});

export function normalizeFileAccept(accept: string): string {
  const values = accept
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .flatMap((value) => ACCEPT_ALIASES[value] ?? (
      value.startsWith(".") || /^[\w.+-]+\/[\w.*+-]+$/.test(value) ? [value] : []
    ));
  return [...new Set(values)].join(",");
}

function isInternalDrag(event: DragEvent<HTMLDivElement>): boolean {
  const nextTarget = event.relatedTarget;
  return nextTarget instanceof Node && event.currentTarget.contains(nextTarget);
}

export function FileDropControl({
  accept,
  assetKind = "image",
  className = "",
  disabled = false,
  multiple = false,
  name,
  onFileSelect,
  onFilesSelect,
}: FileDropControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const normalizedAccept = normalizeFileAccept(accept);
  const targetName = name ?? (multiple
    ? `Browse ${assetKind} files`
    : `Browse ${assetKind} file`);

  function handleFiles(fileList: FileList | readonly File[] | null | undefined): void {
    if (disabled) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (!multiple) {
      const first = files[0];
      if (first) onFileSelect?.(first);
      return;
    }
    if (onFilesSelect) onFilesSelect(files);
    else files.forEach((file) => onFileSelect?.(file));
  }

  function openPicker(): void {
    if (!disabled) inputRef.current?.click();
  }

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    openPicker();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openPicker();
  }

  return (
    <div className={`min-w-0 ${className}`} data-disabled={disabled ? "true" : undefined}>
      <input
        ref={inputRef}
        type="file"
        accept={normalizedAccept}
        multiple={multiple}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div
        role="button"
        aria-label={targetName}
        aria-disabled={disabled ? "true" : undefined}
        tabIndex={disabled ? -1 : 0}
        data-drag-over={dragOver ? "true" : undefined}
        className="flex min-h-20 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-3 text-center text-xs text-textMuted transition-colors hover:border-white/30 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[drag-over=true]:border-accent data-[drag-over=true]:bg-accent/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!disabled && !isInternalDrag(event)) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          handleFiles(event.dataTransfer?.files);
        }}
      >
        <Upload className="size-5" aria-hidden="true" />
        <span>{multiple ? "Choose files or drop them here" : "Choose a file or drop it here"}</span>
        {normalizedAccept ? <span className="font-mono text-[9px] opacity-70">{normalizedAccept}</span> : null}
      </div>
    </div>
  );
}
