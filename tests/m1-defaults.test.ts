import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/constants.js";

// PUP-89 M1 defaults product contract (§ "What we ship first"):
// lifecycle notifications off, only board approval gates ring by default, and
// inbound/commands cannot be enabled while both allowlists are empty — which
// starts them off by default and lets the host config policy enforce the rest.
describe("M1 default configuration", () => {
  it("keeps lifecycle noise off", () => {
    expect(DEFAULT_CONFIG.notifyOnAgentRunStarted).toBe(false);
    expect(DEFAULT_CONFIG.notifyOnAgentRunFinished).toBe(false);
  });

  it("defaults to board-approval-only notifications", () => {
    expect(DEFAULT_CONFIG.onlyNotifyBoardApprovals).toBe(true);
  });

  it("starts commands and inbound replies disabled with empty allowlists", () => {
    expect(DEFAULT_CONFIG.enableCommands).toBe(false);
    expect(DEFAULT_CONFIG.enableInbound).toBe(false);
    expect(DEFAULT_CONFIG.allowedTelegramUserIds).toEqual([]);
    expect(DEFAULT_CONFIG.allowedTelegramChatIds).toEqual([]);
  });

  it("keeps M1-disabled features off", () => {
    expect(DEFAULT_CONFIG.digestMode).toBe("off");
    expect(DEFAULT_CONFIG.topicRouting).toBe(false);
    expect(DEFAULT_CONFIG.briefAgentId).toBe("");
    expect(DEFAULT_CONFIG.transcriptionApiKeyRef).toBe("");
    expect(DEFAULT_CONFIG.maxSuggestionsPerHourPerCompany).toBe(10);
  });
});