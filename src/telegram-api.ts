import type { PluginContext } from "@paperclipai/plugin-sdk";
import { METRIC_NAMES } from "./constants.js";

const TELEGRAM_API = "https://api.telegram.org";

type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

type InlineKeyboard = InlineButton[][];

export type SendMessageOptions = {
  parseMode?: "MarkdownV2" | "HTML";
  replyToMessageId?: number;
  messageThreadId?: number;
  inlineKeyboard?: InlineKeyboard;
  disableNotification?: boolean;
};

export async function sendMessage(
  ctx: PluginContext,
  token: string,
  chatId: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<number | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (options.parseMode) body.parse_mode = options.parseMode;
  if (options.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;
  if (options.messageThreadId) body.message_thread_id = options.messageThreadId;
  if (options.disableNotification) body.disable_notification = true;

  if (options.inlineKeyboard) {
    body.reply_markup = {
      inline_keyboard: options.inlineKeyboard,
    };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
        parameters?: { retry_after?: number };
      };

      if (!data.ok) {
        if (data.parameters?.retry_after && attempt < 2) {
          const wait = data.parameters.retry_after * 1000;
          ctx.logger.warn("Telegram rate limited, retrying", { retryAfter: data.parameters.retry_after, attempt });
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        if (options.parseMode === "MarkdownV2") {
          ctx.logger.warn("MarkdownV2 send failed, retrying as plain text", {
            error: data.description,
          });
          return sendMessage(ctx, token, chatId, stripMarkdown(text), {
            ...options,
            parseMode: undefined,
          });
        }
        ctx.logger.error("Telegram sendMessage failed", { error: data.description });
        await ctx.metrics.write(METRIC_NAMES.failed, 1);
        return null;
      }

      await ctx.metrics.write(METRIC_NAMES.sent, 1);
      return data.result?.message_id ?? null;
    } catch (err) {
      ctx.logger.error("Telegram API error", { error: String(err) });
      await ctx.metrics.write(METRIC_NAMES.failed, 1);
      return null;
    }
  }
  return null;
}

export async function editMessage(
  ctx: PluginContext,
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  options: { parseMode?: "MarkdownV2" | "HTML"; inlineKeyboard?: InlineKeyboard } = {},
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };

  if (options.parseMode) body.parse_mode = options.parseMode;
  if (options.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: options.inlineKeyboard };
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }

  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch (err) {
    ctx.logger.error("Telegram editMessage failed", { error: String(err) });
    return false;
  }
}

export async function answerCallbackQuery(
  ctx: PluginContext,
  token: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string; error_code?: number };
    if (!data.ok) {
      ctx.logger.error("Telegram answerCallbackQuery rejected", {
        callbackQueryId,
        error_code: data.error_code,
        description: data.description,
      });
    }
  } catch (err) {
    ctx.logger.error("Telegram answerCallbackQuery failed", { error: String(err) });
  }
}

export async function setMyCommands(
  ctx: PluginContext,
  token: string,
  commands: Array<{ command: string; description: string }>,
): Promise<boolean> {
  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch (err) {
    ctx.logger.error("Telegram setMyCommands failed", { error: String(err) });
    return false;
  }
}

export async function sendChatAction(
  ctx: PluginContext,
  token: string,
  chatId: string,
  action: "typing" = "typing",
): Promise<void> {
  try {
    await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Typing indicator failures are non-critical
  }
}

/**
 * Check if a chat is a forum (has topics enabled).
 * Caches the result per chatId for the lifetime of the process.
 */
const forumCache = new Map<string, boolean>();

export async function isForum(
  ctx: PluginContext,
  token: string,
  chatId: string,
): Promise<boolean> {
  const cached = forumCache.get(chatId);
  if (cached !== undefined) return cached;

  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = (await res.json()) as { ok: boolean; result?: { is_forum?: boolean } };
    const result = data.ok && data.result?.is_forum === true;
    forumCache.set(chatId, result);
    return result;
  } catch {
    return false;
  }
}

/** General topic thread ID for forum groups. */
export const GENERAL_TOPIC_THREAD_ID = 1;

export type TelegramBotIdentity = {
  id: number;
  username?: string;
  firstName?: string;
};

export type TelegramApiProbeResult =
  | { ok: true; bot?: TelegramBotIdentity; chatId?: string }
  | { ok: false; error: string };

/**
 * Verify a bot token against Telegram `getMe` and return its identity.
 * Used by the settings "Test configuration" action: a token saved as a secret
 * ref must still be valid/revoked-free before the board relies on the bot.
 */
export async function getMe(ctx: PluginContext, token: string): Promise<TelegramApiProbeResult> {
  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/getMe`, { method: "GET" });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { id: number; username?: string; first_name?: string };
      description?: string;
      error_code?: number;
    };

    if (!data.ok) {
      return {
        ok: false,
        error: describeTelegramProbeResponse("getMe", data.description, data.error_code),
      };
    }

    const me = data.result;
    if (!me || typeof me.id !== "number") {
      return { ok: false, error: "getMe returned no bot identity." };
    }

    return {
      ok: true,
      bot: {
        id: me.id,
        username: typeof me.username === "string" ? me.username : undefined,
        firstName: typeof me.first_name === "string" ? me.first_name : undefined,
      },
    };
  } catch (err) {
    return { ok: false, error: `getMe request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Reachability probe for a configured chat: the bot must be able to read the
 * chat (`getChat`), which fails when the bot is not in the chat or the ID is
 * wrong. Used by the settings "Test configuration" action.
 */
export async function getChat(
  ctx: PluginContext,
  token: string,
  chatId: string,
): Promise<TelegramApiProbeResult> {
  try {
    const res = await ctx.http.fetch(`${TELEGRAM_API}/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
      error_code?: number;
    };

    if (!data.ok) {
      return {
        ok: false,
        error: describeTelegramProbeResponse(`chat ${chatId}`, data.description, data.error_code),
      };
    }

    return { ok: true, chatId };
  } catch (err) {
    return { ok: false, error: `getChat request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function describeTelegramProbeResponse(probe: string, description?: string, errorCode?: number): string {
  const detail = (description ?? "").trim();
  if (errorCode === 401) {
    return `Telegram rejected the bot token (${probe}${detail ? `: ${detail}` : ""}); create/rotate the BotFather token and update the secret.`;
  }
  return detail
    ? `${probe}: ${detail}`
    : `${probe}: unknown Telegram error.`;
}

// MarkdownV2 requires escaping these characters
const MD_ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MD_ESCAPE_CHARS, "\\$1");
}

export function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, "$1")
    .replace(/[*_`~]/g, "");
}
