import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createPairingCode, effectivePermissionMode, verifyPairingCode } from "../src/modules/agent/pairing.js";

/** Pairing codes: signed, expiring, nonce-carrying; the laptop can only lower autonomy. */

const SECRET = "unit-test-secret-0123456789";

describe("pairing codes", () => {
  test("round-trip carries a unique nonce", () => {
    const input = { projectId: "p", workspaceId: "w", userId: "u", permissionMode: "MANUAL" as const };
    const a = verifyPairingCode(SECRET, createPairingCode(SECRET, input).code);
    const b = verifyPairingCode(SECRET, createPairingCode(SECRET, input).code);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.payload.n.length).toBeGreaterThan(10);
      expect(a.payload.n).not.toBe(b.payload.n);
    }
  });

  test("legacy codes without a nonce are rejected", () => {
    const body = Buffer.from(JSON.stringify({ p: "p", w: "w", u: "u", m: "AUTO_RUN", e: Date.now() + 60_000 })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(body).digest().subarray(0, 20).toString("base64url");
    expect(verifyPairingCode(SECRET, `SDDP1.${body}.${sig}`).ok).toBe(false);
  });

  test("only self-connect codes carry the self-connect flag, under the signature", () => {
    const input = { projectId: "p", workspaceId: "w", userId: "u", permissionMode: "MANUAL" as const };
    const plain = verifyPairingCode(SECRET, createPairingCode(SECRET, input).code);
    const self = verifyPairingCode(SECRET, createPairingCode(SECRET, { ...input, selfConnect: true }).code);
    expect(plain.ok && plain.payload.s).toBeFalsy();
    expect(self.ok && self.payload.s).toBe(1);
    // Adding the flag to an ordinary code breaks its signature.
    const [, body, sig] = createPairingCode(SECRET, input).code.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), s: 1 })).toString("base64url");
    expect(verifyPairingCode(SECRET, `SDDP1.${forged}.${sig}`).ok).toBe(false);
  });

  test("a tampered signature is rejected", () => {
    const { code } = createPairingCode(SECRET, { projectId: "p", workspaceId: "w", userId: "u", permissionMode: "MANUAL" });
    expect(verifyPairingCode("another-secret-0123456789", code).ok).toBe(false);
  });
});

describe("persistent reconnect mode", () => {
  test("omitted preference preserves saved checked and unchecked modes", () => {
    expect(effectivePermissionMode("MANUAL", null, "AUTO_RUN", true)).toBe("AUTO_RUN");
    expect(effectivePermissionMode("MANUAL", null, "MANUAL", true)).toBe("MANUAL");
    expect(effectivePermissionMode("MANUAL", null, null, true)).toBe("MANUAL");
  });
  test("deliberate mode change and laptop ceiling remain enforced", () => {
    expect(effectivePermissionMode("MANUAL", null, "AUTO_RUN", false)).toBe("MANUAL");
    expect(effectivePermissionMode("MANUAL", "AUTO_RUN", "MANUAL", true)).toBe("MANUAL");
    expect(effectivePermissionMode("AUTO_RUN", "MANUAL", "AUTO_RUN", true)).toBe("MANUAL");
  });
});

describe("effectivePermissionMode", () => {
  test("the code is a ceiling; requests can only lower it", () => {
    expect(effectivePermissionMode("MANUAL", "AUTO_RUN")).toBe("MANUAL");
    expect(effectivePermissionMode("AUTO_RUN", "ASSISTED")).toBe("ASSISTED");
    expect(effectivePermissionMode("ASSISTED", null)).toBe("ASSISTED");
  });
});
