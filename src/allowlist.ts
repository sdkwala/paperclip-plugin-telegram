export type TelegramAllowlistConfig = {
  allowedTelegramUserIds?: unknown;
  allowedTelegramChatIds?: unknown;
  enableCommands?: unknown;
  enableInbound?: unknown;
};

export type TelegramAllowlistUpdate = {
  update_id: number;
  message?: {
    from?: { id: number };
    chat: { id: number };
  };
  callback_query?: {
    from: { id: number };
    message?: {
      chat: { id: number };
    };
  };
};

function normalizeAllowlist(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set();
  return new Set(
    values
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0),
  );
}

export const TELEGRAM_ALLOWLIST_REQUIRED_ERROR =
  "enableCommands/enableInbound requires a non-empty allowedTelegramUserIds or allowedTelegramChatIds.";

/**
 * Mirrors the runtime gate in worker.ts (`if (config.enableCommands)`), which
 * treats any truthy value as enabled. Matching it here keeps the validator
 * from waving through a config the worker would otherwise honour.
 */
function isFeatureEnabled(value: unknown): boolean {
  return Boolean(value);
}

export function validateTelegramAllowlists(config: TelegramAllowlistConfig): string[] {
  const errors: string[] = [];
  for (const key of ["allowedTelegramUserIds", "allowedTelegramChatIds"] as const) {
    const value = config[key];
    if (value === undefined || Array.isArray(value)) continue;
    errors.push(`${key} must be an array of Telegram ID strings. Leave it empty only when enableCommands and enableInbound are both disabled.`);
  }
  if (errors.length > 0) return errors;

  // An empty allowlist makes isTelegramUpdateAllowed accept every sender, so
  // enabling commands or inbound without one exposes the bot to anyone who
  // can reach it. Require at least one entry whenever either feature runs.
  if (!isFeatureEnabled(config.enableCommands) && !isFeatureEnabled(config.enableInbound)) {
    return errors;
  }

  const allowedUserIds = normalizeAllowlist(config.allowedTelegramUserIds);
  const allowedChatIds = normalizeAllowlist(config.allowedTelegramChatIds);
  if (allowedUserIds.size === 0 && allowedChatIds.size === 0) {
    errors.push(TELEGRAM_ALLOWLIST_REQUIRED_ERROR);
  }
  return errors;
}

export function isTelegramUpdateAllowed(
  config: TelegramAllowlistConfig,
  update: TelegramAllowlistUpdate,
): boolean {
  const allowedUserIds = normalizeAllowlist(config.allowedTelegramUserIds);
  const allowedChatIds = normalizeAllowlist(config.allowedTelegramChatIds);

  if (allowedUserIds.size === 0 && allowedChatIds.size === 0) {
    return true;
  }

  const fromId = update.message?.from?.id ?? update.callback_query?.from.id;
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;

  if (allowedUserIds.size > 0 && (!fromId || !allowedUserIds.has(String(fromId)))) {
    return false;
  }

  if (allowedChatIds.size > 0 && (!chatId || !allowedChatIds.has(String(chatId)))) {
    return false;
  }

  return true;
}
