import { describe, expect, test } from "bun:test";
import { SecretBox, timingSafeEqual } from "../src/crypto.js";
import { redact, isSensitiveKey, redactEmbeddedCredentials } from "../src/redact.js";
import { displayKey, newTraceId } from "../src/ids.js";

/** Secret storage boundary tests (T025 DoD, NFR-013). */

describe("SecretBox (AES-256-GCM)", () => {
  test("round-trips a credential", async () => {
    const key = new Uint8Array(Buffer.from(Buffer.alloc(32).fill(7)));
    const box = SecretBox.fromMasterKey(key);
    const secret = "sk-live-abc123secretvalue";
    const envelope = await box.encrypt(secret);
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(envelope).not.toContain(secret);
    expect(await box.decrypt(envelope)).toBe(secret);
  });

  test("produces different ciphertexts per call (random IV)", async () => {
    const box = SecretBox.fromMasterKey(new Uint8Array(Buffer.alloc(32).fill(3)));
    const a = await box.encrypt("same-value");
    const b = await box.encrypt("same-value");
    expect(a).not.toBe(b);
  });

  test("rejects tampered ciphertext", async () => {
    const box = SecretBox.fromMasterKey(new Uint8Array(Buffer.alloc(32).fill(5)));
    const envelope = await box.encrypt("payload");
    const parts = envelope.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}xx`;
    expect(box.decrypt(tampered)).rejects.toThrow();
  });

  test("refuses wrong key length", () => {
    expect(() => SecretBox.fromMasterKey(new Uint8Array(16))).toThrow();
  });
});

describe("secret redaction", () => {
  test("masks sensitive keys recursively", () => {
    const input = {
      authorization: "Bearer abc",
      apiKey: "sk-123",
      nested: { password: "hunter2", safe: "value" },
      list: [{ secret_header: "x" }],
    };
    const output = redact(input) as Record<string, unknown>;
    expect(output["authorization"]).toBe("***REDACTED***");
    expect(output["apiKey"]).toBe("***REDACTED***");
    const nested = output["nested"] as Record<string, unknown>;
    expect(nested["password"]).toBe("***REDACTED***");
    expect(nested["safe"]).toBe("value");
    expect(JSON.stringify(output)).not.toContain("hunter2");
    expect(JSON.stringify(output)).not.toContain("sk-123");
  });

  test("masks embedded credentials in free text", () => {
    const text = "configured Authorization: Bearer abc.def and api_key=xyz123 in config";
    const out = redactEmbeddedCredentials(text);
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("xyz123");
  });

  test("isSensitiveKey matches token-ish names", () => {
    expect(isSensitiveKey("refresh_token")).toBe(true);
    expect(isSensitiveKey("PUBLIC_HEADERS")).toBe(false);
  });
});

describe("ids", () => {
  test("display keys pad and trace ids shorten", () => {
    expect(displayKey("TASK", 7)).toBe("TASK-007");
    expect(newTraceId()).toHaveLength(24);
    expect(timingSafeEqual("a", "a")).toBe(true);
    expect(timingSafeEqual("a", "b")).toBe(false);
  });
});
