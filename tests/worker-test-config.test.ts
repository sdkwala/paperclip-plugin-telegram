import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";

// PUP-89 M1 "Test configuration": the test-config action must resolve the bot
// token secret via company-scoped ctx.secrets.resolve, verify the bot with
// Telegram getMe, probe chat reachability, and fail with actionable messages
// on bad UUIDs, unresolvable secrets, bad tokens, and unreachable hosts.

vi.mock("@paperclipai/plugin-sdk", async () => {
  const actual = await vi.importActual("@paperclipai/plugin-sdk") as Record<string, unknown>;
  return { ...actual, runWorker: vi.fn() };
});

vi.mock("../src/telegram-api.js", async () => {
  const actual = await vi.importActual("../src/telegram-api.js") as Record<string, unknown>;
  return { ...actual, sendMessage: vi.fn(), setMyCommands: vi.fn().mockResolvedValue(true) };
});

type RecordedAction = (params: unknown) => Promise<unknown>;

type Registered = {
  actions: Record<string, RecordedAction[]>;
};

function makeCtx(opts: {
  resolveSecret?: (ref: string, options?: { companyId?: string; configPath?: string }) => Promise<string>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
} = {}): { ctx: PluginContext; registered: Registered } {
  const registered: Registered = { actions: {} };

  const ctx = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    events: { on: vi.fn() },
    jobs: { register: vi.fn() },
    tools: { register: vi.fn() },
    actions: {
      register: vi.fn((key: string, fn: RecordedAction) => {
        (registered.actions[key] ??= []).push(fn);
      }),
    },
    data: { register: vi.fn() },
    state: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    companies: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    config: { get: vi.fn(async () => ({}) as unknown) },
    secrets: {
      resolve: vi.fn(
        opts.resolveSecret ??
          (async () => {
            throw new Error("secret resolution not configured for this test");
          }),
      ),
    },
    http: { fetch: vi.fn(opts.fetch ?? (async () => {
      throw new Error("network unavailable in tests");
    })) },
    metrics: { write: vi.fn().mockResolvedValue(undefined) },
    activity: { log: vi.fn().mockResolvedValue(undefined) },
    agents: { get: vi.fn().mockResolvedValue(null), list: vi.fn().mockResolvedValue([]) },
    issues: {
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      listComments: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PluginContext;

  return { ctx, registered };
}

const BOT_TOKEN = "123456:AAHfakesecretdonotmatter";
const SECRET_REF = "12f7ed4a-1234-4d0c-9abc-bd58d44d15e1";

function telegramJson(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("test-config action (Test configuration backend)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function runAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { plugin } = await import("../src/worker.js");

    const { ctx, registered } = makeCtx({
      resolveSecret: async () => BOT_TOKEN,
      fetch: (url) => {
        if (url.includes("/getMe")) {
          return Promise.resolve(telegramJson({ ok: true, result: { id: 42, username: "pupu_bot", first_name: "Pupu" } }));
        }
        if (url.includes("/getChat")) {
          return Promise.resolve(telegramJson({ ok: true }));
        }
        if (url.includes("/api/health")) {
          return Promise.resolve(telegramJson({ status: "ok", version: "2026.1012.0" }));
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      },
    });
    await plugin.definition.setup(ctx);

    const handler = registered.actions["test-config"]?.[0];
    expect(handler).toBeDefined();
    return (await handler!(params)) as Record<string, unknown>;
  }

  it("returns the bot identity from getMe plus paperclip host status", async () => {
    const result = await runAction({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://paperclip.example.com",
      probeChatIds: ["-1001"],
    });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe("complete");
    expect(result.bot).toEqual({ id: 42, username: "pupu_bot", firstName: "Pupu" });
    expect(result.paperclip).toEqual({ ok: true, status: "ok", version: "2026.1012.0" });
    expect(result.chats).toEqual([{ chatId: "-1001", ok: true }]);
  });

  it("fails with an actionable message on a bad UUID secret ref", async () => {
    const result = await runAction({
      companyId: "company-a",
      telegramBotTokenRef: "https://example.com/not-a-uuid",
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("secret");
    expect(String(result.error)).toContain("Bad telegramBotTokenRef");
    expect(String(result.error)).toContain("must be the UUID of a Paperclip secret");
  });

  it("fails with an actionable message when the secret cannot be resolved", async () => {
    const { plugin } = await import("../src/worker.js");
    const { ctx, registered } = makeCtx({
      resolveSecret: async () => {
        throw new Error("secret not found");
      },
    });
    await plugin.definition.setup(ctx);
    const handler = registered.actions["test-config"]?.[0]!;

    const result = (await handler({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("secret");
    expect(String(result.error)).toContain("Could not resolve the bot token secret");
    expect(String(result.error)).toContain("secret not found");
  });

  it("reports a revoked/invalid token as a telegram-stage failure", async () => {
    const { plugin } = await import("../src/worker.js");
    const { ctx, registered } = makeCtx({
      resolveSecret: async () => "expired-token",
      fetch: (url) => {
        if (url.includes("/getMe")) {
          return Promise.resolve({
            json: async () => ({ ok: false, description: "Unauthorized", error_code: 401 }),
          } as unknown as Response);
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      },
    });
    await plugin.definition.setup(ctx);
    const handler = registered.actions["test-config"]?.[0]!;

    const result = (await handler({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("telegram");
    expect(String(result.error)).toContain("rejected the bot token");
  });

  it("fails with an actionable message when the Paperclip API URL points at the wrong host", async () => {
    const { plugin } = await import("../src/worker.js");
    const { ctx, registered } = makeCtx({
      resolveSecret: async () => BOT_TOKEN,
      fetch: (url) => {
        if (url.includes("/getMe")) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, result: { id: 42, username: "pupu_bot" } }), { status: 200 }),
          );
        }
        return Promise.reject(new Error("ECONNREFUSED"));
      },
    });
    await plugin.definition.setup(ctx);
    const handler = registered.actions["test-config"]?.[0]!;

    const result = (await handler({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://wrong-host.example.com",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("paperclip");
    expect(String(result.error)).toContain("did not respond");
    expect(String(result.error)).toContain("wrong-host.example.com");
  });

  it("flags a non-Paperclip health answer", async () => {
    const { plugin } = await import("../src/worker.js");
    const { ctx, registered } = makeCtx({
      resolveSecret: async () => BOT_TOKEN,
      fetch: (url) => {
        if (url.includes("/getMe")) {
          return Promise.resolve(telegramJson({ ok: true, result: { id: 42 } }));
        }
        return Promise.resolve(
          new Response("<!DOCTYPE html><html><body>hi</body></html>", { status: 200 }),
        );
      },
    });
    await plugin.definition.setup(ctx);
    const handler = registered.actions["test-config"]?.[0]!;

    const result = (await handler({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://wrong-host.example.com",
    })) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("did not answer /api/health with JSON");
  });

  it("keeps overall ok for unreachable chats but reports them", async () => {
    const { plugin } = await import("../src/worker.js");
    const { ctx, registered } = makeCtx({
      resolveSecret: async () => BOT_TOKEN,
      fetch: (url) => {
        if (url.includes("/getMe")) {
          return Promise.resolve(telegramJson({ ok: true, result: { id: 42, username: "pupu_bot" } }));
        }
        if (url.includes("/getChat")) {
          return Promise.resolve({
            json: async () => ({ ok: false, description: "Forbidden: bot is not a member" }),
          } as unknown as Response);
        }
        if (url.includes("/api/health")) {
          return Promise.resolve(telegramJson({ status: "ok", version: "2026.1012.0" }));
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      },
    });
    await plugin.definition.setup(ctx);
    const handler = registered.actions["test-config"]?.[0]!;

    const result = (await handler({
      companyId: "company-a",
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://paperclip.example.com",
      probeChatIds: ["-1001", "", "  "],
    })) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    const chats = result.chats as Array<Record<string, unknown>>;
    expect(chats).toHaveLength(1);
    expect(chats[0]!.ok).toBe(false);
    expect(String(chats[0]!.error)).toContain("Forbidden");
  });

  it("refuses to run without a company id", async () => {
    const result = await runAction({ telegramBotTokenRef: SECRET_REF });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("secret");
    expect(String(result.error)).toContain("company");
  });
});

describe("onValidateConfig origin guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects malformed Paperclip origins before deeper checks", async () => {
    const { plugin } = await import("../src/worker.js");

    const result = await plugin.definition.onValidateConfig!({
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "not a url",
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("paperclipBaseUrl must be an absolute http(s) URL");
  });

  it("still enforces allowlist shape errors", async () => {
    const { plugin } = await import("../src/worker.js");

    const result = await plugin.definition.onValidateConfig!({
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://paperclip.example.com",
      allowedTelegramUserIds: "not-an-array",
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("allowedTelegramUserIds must be an array");
  });

  it("accepts a complete valid config", async () => {
    const { plugin } = await import("../src/worker.js");

    const result = await plugin.definition.onValidateConfig!({
      telegramBotTokenRef: SECRET_REF,
      paperclipBaseUrl: "https://paperclip.example.com",
      paperclipPublicUrl: "",
      enableCommands: true,
      allowedTelegramUserIds: ["1"],
    });

    expect(result.ok).toBe(true);
  });
});