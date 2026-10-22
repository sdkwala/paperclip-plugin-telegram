/**
 * Paperclip origin guard for the Telegram plugin config (PUP-89 M1 §5).
 *
 * `paperclipBaseUrl` is the host the worker calls for approvals and comments;
 * `paperclipPublicUrl` is the origin embedded in Telegram notification links.
 * The upstream default `http://localhost:3100` is a footgun on real
 * deployments (approval buttons dead because the URL points at a host the
 * recipient cannot reach), so validateConfig rejects malformed URLs and the
 * settings UI separately blocks localhost saves made from a non-localhost
 * browser.
 */

const BLOCKED_NON_HTTP_SCHEME_MESSAGE =
  "must be an absolute http(s) URL, e.g. \"https://paperclip.example.com\".";

export function parseHttpOrigin(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

/**
 * localhost-family hostnames the Telegram notifications would only reach when
 * the recipient/worker shares the machine: `localhost`, `.localhost` suffixes,
 * `127.x.x.x`, `0.0.0.0`, and `::1`.
 */
export function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "::1" || normalized === "0.0.0.0") return true;
  return /^127(\.\d{1,3}){3}$/.test(normalized);
}

export function isLocalhostOrigin(origin: URL | null): boolean {
  return origin !== null && isLocalhostHostname(origin.hostname);
}

export function resolveConfigOrigin(config: {
  paperclipPublicUrl?: unknown;
  paperclipBaseUrl?: unknown;
}): { origin: URL | null; source: "publicUrl" | "baseUrl" | "none" } {
  const publicUrl = parseHttpOrigin(config.paperclipPublicUrl);
  if (publicUrl) return { origin: publicUrl, source: "publicUrl" };
  const baseUrl = parseHttpOrigin(config.paperclipBaseUrl);
  if (baseUrl) return { origin: baseUrl, source: "baseUrl" };
  return { origin: null, source: "none" };
}

/**
 * Errors for `onValidateConfig` about the Paperclip origin override fields.
 *
 * `paperclipBaseUrl` is required — without it the worker falls back to a
 * hardcoded localhost URL and every link/action dies on real deployments.
 * `paperclipPublicUrl` is optional but must be a valid http(s) URL when set.
 */
export function validateTelegramOriginUrls(config: {
  paperclipBaseUrl?: unknown;
  paperclipPublicUrl?: unknown;
}): string[] {
  const errors: string[] = [];

  const baseUrl = parseHttpOrigin(config.paperclipBaseUrl);
  if (!baseUrl) {
    errors.push(`paperclipBaseUrl ${BLOCKED_NON_HTTP_SCHEME_MESSAGE}`);
  }

  const publicUrlInput = typeof config.paperclipPublicUrl === "string" ? config.paperclipPublicUrl.trim() : "";
  if (publicUrlInput && !parseHttpOrigin(publicUrlInput)) {
    errors.push(`paperclipPublicUrl ${BLOCKED_NON_HTTP_SCHEME_MESSAGE} Leave it empty to reuse paperclipBaseUrl.`);
  }

  return errors;
}