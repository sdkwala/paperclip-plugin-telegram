import { describe, expect, it } from "vitest";
import {
  isTelegramUpdateAllowed,
  validateTelegramAllowlists,
  TELEGRAM_ALLOWLIST_REQUIRED_ERROR,
} from "../src/allowlist.js";

const baseConfig = {
  allowedTelegramUserIds: [],
  allowedTelegramChatIds: [],
};

describe("isTelegramUpdateAllowed", () => {
  it("allows all updates when allowlists are empty", () => {
    expect(isTelegramUpdateAllowed(baseConfig, {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 123 },
        chat: { id: 456, type: "private" },
        text: "/status",
      },
    })).toBe(true);
  });

  it("blocks messages from users outside the user allowlist", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: ["123"],
      allowedTelegramChatIds: [],
    }, {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 999 },
        chat: { id: 456, type: "private" },
        text: "/status",
      },
    })).toBe(false);
  });

  it("allows messages from users inside the user allowlist", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: ["123"],
      allowedTelegramChatIds: [],
    }, {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 123 },
        chat: { id: 456, type: "private" },
        text: "/status",
      },
    })).toBe(true);
  });

  it("blocks messages from chats outside the chat allowlist", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: [],
      allowedTelegramChatIds: ["-1001"],
    }, {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 123 },
        chat: { id: -2002, type: "supergroup" },
        text: "/status",
      },
    })).toBe(false);
  });

  it("requires both user and chat to match when both allowlists are configured", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: ["123"],
      allowedTelegramChatIds: ["-1001"],
    }, {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 123 },
        chat: { id: -2002, type: "supergroup" },
        text: "/status",
      },
    })).toBe(false);
  });

  it("applies the user allowlist to inline button callbacks", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: ["123"],
      allowedTelegramChatIds: [],
    }, {
      update_id: 1,
      callback_query: {
        id: "cb-1",
        from: { id: 999 },
        message: {
          message_id: 10,
          chat: { id: -1001 },
          text: "Approval",
        },
        data: "approve_apr-1",
      },
    })).toBe(false);
  });

  it("applies the chat allowlist to inline button callbacks", () => {
    expect(isTelegramUpdateAllowed({
      allowedTelegramUserIds: [],
      allowedTelegramChatIds: ["-1001"],
    }, {
      update_id: 1,
      callback_query: {
        id: "cb-1",
        from: { id: 123 },
        message: {
          message_id: 10,
          chat: { id: -1001 },
          text: "Approval",
        },
        data: "approve_apr-1",
      },
    })).toBe(true);
  });
});

describe("validateTelegramAllowlists", () => {
  it("accepts missing or array allowlists", () => {
    expect(validateTelegramAllowlists({})).toEqual([]);
    expect(validateTelegramAllowlists({
      allowedTelegramUserIds: ["123"],
      allowedTelegramChatIds: ["-1001"],
    })).toEqual([]);
  });

  it("rejects non-array allowlist values", () => {
    expect(validateTelegramAllowlists({
      allowedTelegramUserIds: "123",
      allowedTelegramChatIds: "-1001",
    })).toEqual([
      "allowedTelegramUserIds must be an array of Telegram ID strings. Leave it empty only when enableCommands and enableInbound are both disabled.",
      "allowedTelegramChatIds must be an array of Telegram ID strings. Leave it empty only when enableCommands and enableInbound are both disabled.",
    ]);
  });

  it("rejects an empty allowlist when commands are enabled", () => {
    expect(validateTelegramAllowlists({ enableCommands: true })).toEqual([
      TELEGRAM_ALLOWLIST_REQUIRED_ERROR,
    ]);
    expect(validateTelegramAllowlists({
      enableCommands: true,
      allowedTelegramUserIds: [],
      allowedTelegramChatIds: [],
    })).toEqual([TELEGRAM_ALLOWLIST_REQUIRED_ERROR]);
  });

  it("rejects an empty allowlist when inbound is enabled", () => {
    expect(validateTelegramAllowlists({ enableInbound: true })).toEqual([
      TELEGRAM_ALLOWLIST_REQUIRED_ERROR,
    ]);
  });

  it("rejects an allowlist that only contains blank entries", () => {
    expect(validateTelegramAllowlists({
      enableCommands: true,
      allowedTelegramUserIds: ["  "],
      allowedTelegramChatIds: [""],
    })).toEqual([TELEGRAM_ALLOWLIST_REQUIRED_ERROR]);
  });

  it("accepts an empty allowlist when commands and inbound are both disabled", () => {
    expect(validateTelegramAllowlists({ enableCommands: false, enableInbound: false })).toEqual([]);
    expect(validateTelegramAllowlists({
      enableCommands: false,
      enableInbound: false,
      allowedTelegramUserIds: [],
      allowedTelegramChatIds: [],
    })).toEqual([]);
  });

  it("accepts a non-empty allowlist when commands or inbound are enabled", () => {
    expect(validateTelegramAllowlists({
      enableCommands: true,
      allowedTelegramUserIds: ["123"],
    })).toEqual([]);
    expect(validateTelegramAllowlists({
      enableInbound: true,
      allowedTelegramChatIds: ["-1001"],
    })).toEqual([]);
  });

  it("keeps accepting configs that do not set the feature flags", () => {
    expect(validateTelegramAllowlists({})).toEqual([]);
    expect(validateTelegramAllowlists({ allowedTelegramUserIds: ["123"] })).toEqual([]);
  });

  it("treats feature flags the way the worker runtime reads them", () => {
    expect(validateTelegramAllowlists({ enableCommands: "true" })).toEqual([
      TELEGRAM_ALLOWLIST_REQUIRED_ERROR,
    ]);
    expect(validateTelegramAllowlists({ enableInbound: 1 })).toEqual([
      TELEGRAM_ALLOWLIST_REQUIRED_ERROR,
    ]);
    expect(validateTelegramAllowlists({ enableCommands: 0 })).toEqual([]);
    expect(validateTelegramAllowlists({ enableInbound: "" })).toEqual([]);
  });
});

describe("plugin.onValidateConfig", () => {
  const secretRef = "12f7ed4a-1234-4d0c-9abc-bd58d44d15e1";

  async function validate(config: Record<string, unknown>) {
    const { plugin } = await import("../src/worker.js");
    const onValidateConfig = plugin.definition.onValidateConfig;
    if (!onValidateConfig) throw new Error("plugin.onValidateConfig is not implemented");
    return onValidateConfig(config);
  }

  it("rejects a config that enables commands or inbound without an allowlist", async () => {
    const result = await validate({
      telegramBotTokenRef: secretRef,
      enableCommands: true,
      enableInbound: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(TELEGRAM_ALLOWLIST_REQUIRED_ERROR);
  });

  it("accepts a config that enables commands with an allowlist", async () => {
    const result = await validate({
      telegramBotTokenRef: secretRef,
      enableCommands: true,
      enableInbound: true,
      allowedTelegramUserIds: ["123"],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts a notify-only config with an empty allowlist", async () => {
    const result = await validate({
      telegramBotTokenRef: secretRef,
      enableCommands: false,
      enableInbound: false,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toBeUndefined();
  });
});
