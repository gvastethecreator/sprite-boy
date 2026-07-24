/**
 * Shared safe download naming (mirrors core/export createExportFileName rules
 * without pulling the ExportPort graph into the legacy host bundle).
 */

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}]/gu;
const RESERVED_WINDOWS_FILE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SAFE_FILE_EXTENSION = /^[a-z0-9][a-z0-9-]{0,15}$/;
const MAX_EXPORT_BASE_NAME_LENGTH = 128;

export function createSafeDownloadFileName(
  baseName: unknown,
  fileExtension: string,
): string {
  if (typeof fileExtension !== "string" || !SAFE_FILE_EXTENSION.test(fileExtension)) {
    throw new Error("Export file extension is invalid.");
  }
  if (typeof baseName !== "string") {
    throw new Error("Export base name must be a string.");
  }
  let safe = baseName
    .normalize("NFKC")
    .trim()
    .replace(/\.\.+/g, "-")
    .replace(INVALID_FILE_NAME_CHARACTERS, "-")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\.\./g, "-");
  const extensionSuffix = `.${fileExtension}`;
  if (safe.toLowerCase().endsWith(extensionSuffix.toLowerCase())) {
    safe = safe.slice(0, -extensionSuffix.length).replace(/[. ]+$/, "");
  }
  const safeCharacters = Array.from(safe);
  if (safeCharacters.length > MAX_EXPORT_BASE_NAME_LENGTH) {
    safe = safeCharacters
      .slice(0, MAX_EXPORT_BASE_NAME_LENGTH)
      .join("")
      .replace(/[. ]+$/, "");
  }
  if (safe.length === 0) {
    throw new Error("Export base name has no safe filename characters.");
  }
  if (RESERVED_WINDOWS_FILE_NAME.test(safe)) safe = `_${safe}`;
  return `${safe}.${fileExtension}`;
}
