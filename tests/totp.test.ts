import { describe, expect, it } from "vitest";
import { totp, verifyTotp } from "@/server/auth/totp";

// RFC 6238 test vector: ASCII secret "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches the RFC 6238 vectors (last 6 digits)", () => {
    expect(totp(SECRET, 59_000)).toBe("287082");
    expect(totp(SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totp(SECRET, 1_234_567_890_000)).toBe("005924");
  });
  it("accepts one step of clock drift and rejects older codes", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(SECRET, totp(SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(SECRET, totp(SECRET, now - 90_000), now)).toBe(false);
    expect(verifyTotp(SECRET, "12ab56", now)).toBe(false);
  });
});
