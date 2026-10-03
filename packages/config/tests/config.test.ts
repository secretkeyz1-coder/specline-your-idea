import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig, mayRegister, resetConfigCache } from "../src/index.js";

afterEach(() => resetConfigCache());

const validEnv = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SDD_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  SDD_SESSION_SECRET: "0123456789abcdef",
};

describe("config validation", () => {
  test("empty-string NODE_ENV falls back to the default instead of failing", () => {
    // Ambient environments sometimes export NODE_ENV="" — a present-but-empty
    // value must not crash startup (z.enum rejects "" without preprocessing).
    const config = loadConfig({ ...validEnv, NODE_ENV: "" });
    expect(config.NODE_ENV).toBe("development");
  });

  test("TRUST_PROXY accepts 'true'/'1' and defaults to false", () => {
    expect(loadConfig({ ...validEnv, SDD_TRUST_PROXY: "true" }).SDD_TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...validEnv, SDD_TRUST_PROXY: "1" }).SDD_TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...validEnv }).SDD_TRUST_PROXY).toBe(false);
  });

  test("short session secrets are rejected at startup", () => {
    expect(() => loadConfig({ ...validEnv, SDD_SESSION_SECRET: "short" })).toThrow(/SDD_SESSION_SECRET/);
  });

  test("API binds to loopback in development and to all interfaces in production", () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: "development" }).apiHost).toBe("127.0.0.1");
    resetConfigCache();
    expect(loadConfig({ ...validEnv, NODE_ENV: "production" }).apiHost).toBe("0.0.0.0");
    resetConfigCache();
    expect(loadConfig({ ...validEnv, NODE_ENV: "development", API_HOST: "0.0.0.0" }).apiHost).toBe("0.0.0.0");
  });

  test("self-registration is open in development and closed in production by default", () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: "development" }).selfRegistration).toBe(true);
    resetConfigCache();
    expect(loadConfig({ ...validEnv, NODE_ENV: "production" }).selfRegistration).toBe(false);
    resetConfigCache();
    expect(loadConfig({ ...validEnv, NODE_ENV: "production", ALLOW_SELF_REGISTRATION: "true" }).selfRegistration).toBe(true);
  });

  test("a closed server still admits allowlisted emails and domains", () => {
    const config = loadConfig({ ...validEnv, NODE_ENV: "production", REGISTRATION_ALLOWLIST: " Ani@Example.com , @team.io " });
    expect(mayRegister(config, "ani@example.com")).toBe(true);
    expect(mayRegister(config, "budi@team.io")).toBe(true);
    expect(mayRegister(config, "stranger@example.com")).toBe(false);
    expect(mayRegister(config, "eve@notteam.io.evil.com")).toBe(false);
  });
});
