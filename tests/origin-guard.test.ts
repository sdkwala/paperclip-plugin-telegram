import { describe, it, expect } from "vitest";
import {
  isLocalhostHostname,
  isLocalhostOrigin,
  parseHttpOrigin,
  resolveConfigOrigin,
  validateTelegramOriginUrls,
} from "../src/origin-guard.js";

describe("parseHttpOrigin", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(parseHttpOrigin("https://paperclip.example.com")?.hostname).toBe("paperclip.example.com");
    expect(parseHttpOrigin("http://localhost:3100")?.origin).toBe("http://localhost:3100");
    expect(parseHttpOrigin("  https://host.example.com/  ")?.hostname).toBe("host.example.com");
  });

  it("rejects empty, relative, and non-http values", () => {
    expect(parseHttpOrigin("")).toBeNull();
    expect(parseHttpOrigin("   ")).toBeNull();
    expect(parseHttpOrigin("/api")).toBeNull();
    expect(parseHttpOrigin("ftp://host")).toBeNull();
    expect(parseHttpOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("isLocalhostHostname / isLocalhostOrigin", () => {
  it("recognizes the localhost family", () => {
    expect(isLocalhostHostname("localhost")).toBe(true);
    expect(isLocalhostHostname("localhost.", )).toBe(true);
    expect(isLocalhostHostname("sub.localhost")).toBe(true);
    expect(isLocalhostHostname("127.0.0.1")).toBe(true);
    expect(isLocalhostHostname("127.1.2.3")).toBe(true);
    expect(isLocalhostHostname("::1")).toBe(true);
    expect(isLocalhostHostname("[::1]")).toBe(true);
    expect(isLocalhostHostname("0.0.0.0")).toBe(true);
  });

  it("does not flag real hosts, including 8.x/9.x strings inside other numbers", () => {
    expect(isLocalhostHostname("paperclip.example.com")).toBe(false);
    expect(isLocalhostHostname("127.0.0.1.example.com")).toBe(false);
    expect(isLocalhostHostname("::2")).toBe(false);
    expect(isLocalhostHostname("10.0.0.1")).toBe(false);
  });

  it("isLocalhostOrigin parses URLs", () => {
    expect(isLocalhostOrigin(parseHttpOrigin("http://localhost:3100/xyz"))).toBe(true);
    expect(isLocalhostOrigin(parseHttpOrigin("https://example.com"))).toBe(false);
    expect(isLocalhostOrigin(null)).toBe(false);
  });
});

describe("resolveConfigOrigin", () => {
  it("prefers the public URL, then the base URL", () => {
    expect(resolveConfigOrigin({ paperclipPublicUrl: "https://public.example.com", paperclipBaseUrl: "http://localhost:3100" })).toEqual({
      origin: new URL("https://public.example.com"),
      source: "publicUrl",
    });
    expect(resolveConfigOrigin({ paperclipBaseUrl: "http://localhost:3100" })).toEqual({
      origin: new URL("http://localhost:3100"),
      source: "baseUrl",
    });
    expect(resolveConfigOrigin({})).toEqual({ origin: null, source: "none" });
  });
});

describe("validateTelegramOriginUrls (onValidateConfig origin guard)", () => {
  it("accepts a valid override pair", () => {
    expect(
      validateTelegramOriginUrls({
        paperclipBaseUrl: "http://localhost:3100",
        paperclipPublicUrl: "https://paperclip.example.com",
      }),
    ).toEqual([]);
  });

  it("requires paperclipBaseUrl", () => {
    const errors = validateTelegramOriginUrls({ paperclipBaseUrl: "", paperclipPublicUrl: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("paperclipBaseUrl must be an absolute http(s) URL");
  });

  it("rejects non-http schemes and unparseable overrides", () => {
    expect(validateTelegramOriginUrls({ paperclipBaseUrl: "file:///etc" })).toHaveLength(1);
    expect(validateTelegramOriginUrls({ paperclipBaseUrl: "not a url" })).toHaveLength(1);
    expect(validateTelegramOriginUrls({ paperclipBaseUrl: "http://ok.example.com", paperclipPublicUrl: "javascript:alert(1)" })).toHaveLength(1);
  });

  it("allows an empty paperclipPublicUrl (falls back to the API URL)", () => {
    expect(validateTelegramOriginUrls({ paperclipBaseUrl: "https://api.example.com", paperclipPublicUrl: "" })).toEqual([]);
  });
});