import { describe, expect, test } from "bun:test";
import { checkEgress, embeddedIPv4, extractPointer, pinnedRequestOptions, pinTarget } from "../src/index.js";

/** Custom AI endpoint egress policy tests (T198, docs/13 §17). */

describe("egress policy", () => {
  test("hosted posture refuses loopback and private targets", async () => {
    const hosted = false;
    expect((await checkEgress("http://localhost:11434/v1", hosted)).allowed).toBe(false);
    expect((await checkEgress("http://127.0.0.1:8080", hosted)).allowed).toBe(false);
    expect((await checkEgress("http://192.168.1.10/v1", hosted)).allowed).toBe(false);
    expect((await checkEgress("http://10.0.0.5/v1", hosted)).allowed).toBe(false);
    expect((await checkEgress("http://169.254.169.254/latest", hosted)).allowed).toBe(false);
  });

  test("self-hosted opt-in permits LAN but never cloud metadata", async () => {
    const selfHost = true;
    expect((await checkEgress("http://127.0.0.1:11434/v1", selfHost)).allowed).toBe(true);
    expect((await checkEgress("http://192.168.1.10:1234/v1", selfHost)).allowed).toBe(true);
    expect((await checkEgress("http://169.254.169.254/latest", selfHost)).allowed).toBe(false);
  });

  test("non-http protocols and URL credentials are refused", async () => {
    expect((await checkEgress("file:///etc/passwd", true)).allowed).toBe(false);
    expect((await checkEgress("ftp://example.com", true)).allowed).toBe(false);
    expect((await checkEgress("http://user:pass@example.com", true)).allowed).toBe(false);
  });

  test("IPv4 inet_aton alias forms are classified as their real address", async () => {
    // Decimal/octal/hex/partial forms of 127.0.0.1 and 10.0.0.1 — the URL
    // host is NOT a DNS name for these; getaddrinfo would connect loopback.
    expect((await checkEgress("http://2130706433/", false)).allowed).toBe(false);
    expect((await checkEgress("http://127.1/", false)).allowed).toBe(false);
    expect((await checkEgress("http://0177.0.0.1/", false)).allowed).toBe(false);
    expect((await checkEgress("http://0x7f.0.0.1/", false)).allowed).toBe(false);
    expect((await checkEgress("http://0x7f.1/", false)).allowed).toBe(false);
    expect((await checkEgress("http://167772161/", false)).allowed).toBe(false); // 10.0.0.1
  });

  test("IPv6 hex-embedded and full-form private literals are refused", async () => {
    expect((await checkEgress("http://[0:0:0:0:0:0:0:1]:8080/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[::ffff:7f00:1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[::ffff:a00:1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[::a00:1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[64:ff9b::8.8.8.8]/", false)).allowed).toBe(false); // NAT64
    expect((await checkEgress("http://[fe80::1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[fd12::1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[ff02::1]/", false)).allowed).toBe(false);
  });

  test("cloud metadata is refused in every form, even with private egress allowed", async () => {
    expect((await checkEgress("http://[::ffff:169.254.169.254]/", true)).allowed).toBe(false);
    expect((await checkEgress("http://[fd00:ec2::254]/", true)).allowed).toBe(false);
  });

  test("metadata wrapped in NAT64, IPv4-compatible, 6to4 and Teredo is unwrapped and refused", async () => {
    const refused = [
      "http://[::169.254.169.254]/", // IPv4-compatible
      "http://[::a9fe:a9fe]/", // same, hex
      "http://[64:ff9b::169.254.169.254]/", // NAT64 well-known /96
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[64:ff9b::c000:c0]/", // Oracle 192.0.0.192 via NAT64
      "http://[64:ff9b:1::a9fe:a9fe]/", // NAT64 local-use, /96 position
      "http://[64:ff9b:1:a9fe:a9:fe00::]/", // NAT64 local-use, /48 position (RFC 6052 skips the u octet)
      "http://[64:ff9b:1:0:a9:fea9:fe00:0]/", // /64 position
      "http://[2002:a9fe:a9fe::1]/", // 6to4
      "http://[2002:6464:64c8::1]/", // 6to4 of Alibaba 100.100.100.200
      "http://[2001:0:4136:e378:8000:63bf:5601:5601]/", // Teredo client 169.254.169.254 (bit-inverted)
      "http://[2001:0:a9fe:a9fe::1]/", // Teredo server field
    ];
    for (const url of refused) {
      const decision = await checkEgress(url, true);
      expect({ url, allowed: decision.allowed }).toEqual({ url, allowed: false });
      expect(decision.reason).toContain("Metadata");
    }
  });

  test("the NAT64 range is the documented /96 plus the local-use /48", async () => {
    // Inside 64:ff9b::/96 and 64:ff9b:1::/48: refused on a hosted server.
    expect((await checkEgress("http://[64:ff9b::808:808]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[64:ff9b:1::808:808]/", false)).allowed).toBe(false);
    // 64:ff9b:0:0:1::/80 is outside both: no longer swallowed by a /32 bound.
    expect((await checkEgress("http://[64:ff9b:0:0:1::1]/", false)).allowed).toBe(true);
    // Allowed private egress reaches a NAT64'd private host, never metadata.
    expect((await checkEgress("http://[64:ff9b::a00:1]/", true)).allowed).toBe(true);
  });

  test("embeddedIPv4 finds the IPv4 in each wrapping", () => {
    const v4 = (s: string) => s.split(".").reduce((n, p) => (n << 8n) | BigInt(p), 0n);
    const v6 = (s: string) => {
      const [head, tail = ""] = s.split("::");
      const h = head ? head.split(":") : [];
      const t = tail ? tail.split(":") : [];
      const groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
      return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
    };
    expect(embeddedIPv4(v6("2002:c000:c0::1"))).toContain(v4("192.0.0.192"));
    expect(embeddedIPv4(v6("64:ff9b:1:a9fe:a9:fe00::"))).toContain(v4("169.254.169.254"));
    expect(embeddedIPv4(v6("2001:0:4136:e378:8000:63bf:5601:5601"))).toEqual([v4("65.54.227.120"), v4("169.254.169.254")]);
    expect(embeddedIPv4(v6("2606:4700::1111"))).toEqual([]);
    expect(embeddedIPv4(1n)).toEqual([]); // ::1 is loopback, not an IPv4
  });

  test("refusals name the host as typed, never the address it resolved to", async () => {
    const decision = await checkEgress("http://localhost:11434/v1", false);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("localhost");
    expect(decision.reason).not.toMatch(/127\.0\.0\.1|::1/);
  });

  test("public addresses pass in both families", async () => {
    expect((await checkEgress("http://8.8.8.8/", false)).allowed).toBe(true);
    expect((await checkEgress("http://[2606:4700::1111]/", false)).allowed).toBe(true);
    expect((await checkEgress("http://[::ffff:8.8.8.8]/", false)).allowed).toBe(true);
  });
});

describe("connection pinning", () => {
  test("an IP literal is dialled as typed, with no TLS override", async () => {
    const pin = await pinTarget("https://8.8.8.8/v1", false);
    expect(pin).toMatchObject({ fetchUrl: "https://8.8.8.8/v1", literal: true, servername: "8.8.8.8" });
    expect(pinnedRequestOptions(pin)).toEqual({});
  });

  test("a hostname is dialled at its validated IP, with Host, SNI and the certificate check on the name", async () => {
    // localhost resolves through the OS (hosts file): no network involved.
    const pin = await pinTarget("http://localhost:11434/v1/models", true);
    expect(pin.literal).toBe(false);
    expect(pin.servername).toBe("localhost");
    expect(pin.hostHeader).toBe("localhost:11434");
    expect(new URL(pin.fetchUrl).hostname).toMatch(/^(127\.0\.0\.1|\[::1\])$/);
    expect(new URL(pin.fetchUrl).pathname).toBe("/v1/models");

    const options = pinnedRequestOptions({ literal: false, servername: "api.example.com" });
    expect(options.tls?.serverName).toBe("api.example.com");
    // The certificate is checked against the ORIGINAL name, whatever host Bun passes in.
    const cert = (san: string) => ({ subject: { CN: san }, subjectaltname: `DNS:${san}` }) as unknown as import("node:tls").PeerCertificate;
    expect(options.tls!.checkServerIdentity("203.0.113.9", cert("api.example.com"))).toBeUndefined();
    expect(options.tls!.checkServerIdentity("api.example.com", cert("evil.example.net"))).toBeInstanceOf(Error);
  });

  test("a pin to a refused host fails before any connection", async () => {
    const error = await pinTarget("http://169.254.169.254/latest", true).catch((e) => e);
    expect(error.code).toBe("EGRESS_BLOCKED");
  });
});

describe("custom http response pointer", () => {
  test("extracts nested values (RFC 6901 subset)", () => {
    const payload = { result: { answer: "hello", items: ["a", "b"] } };
    expect(extractPointer(payload, "/result/answer")).toBe("hello");
    expect(extractPointer(payload, "/result/items/1")).toBe("b");
    expect(extractPointer(payload, "/missing/path")).toBeUndefined();
  });
});
