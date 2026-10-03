import { DomainError, silentLogger, type Logger } from "@sdd/shared";
import { promises as dns } from "node:dns";
import { checkServerIdentity } from "node:tls";

/**
 * SSRF/egress policy for custom AI endpoints (T198, FR-161, docs/13 §17).
 *
 * Two hard guarantees:
 *  1. Correct IP classification. Addresses are parsed into numbers and matched
 *     against real ranges — never string prefixes. This covers every IPv4
 *     inet_aton form (decimal/octal/hex/partial: 2130706433, 127.1, 0177.0.0.1)
 *     and every IPv6 form, including hex-embedded IPv4-mapped (::ffff:7f00:1)
 *     and full-form loopback (0:0:0:0:0:0:0:1). Cloud metadata is recognised
 *     through every IPv4-in-IPv6 wrapping (mapped, compatible, NAT64 incl. the
 *     local-use prefix, 6to4, Teredo), so it stays refused even when private
 *     egress is allowed.
 *  2. Connection pinning. The hostname is resolved ONCE here; the fetch below
 *     connects to the validated IP (Host header + TLS SNI carry the original
 *     hostname). A rebinding DNS answer cannot redirect the actual connection
 *     to a private target after the check has passed.
 */

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/* ── IP parsing (BigInt; no string-prefix matching anywhere) ── */

const V4_MAPPED_LOW = 0xffffn << 32n; // ::ffff:0:0/96 lower bound (group 5 = bits 32..47)
const V4_MAPPED_HIGH = 0x1_0000n << 32n; // exclusive upper bound
const NAT64_LOW = 0x64ff9bn << 96n; // 64:ff9b::/96 (RFC 6052 well-known prefix)
const NAT64_HIGH = NAT64_LOW + (1n << 32n); // a /96 leaves 32 bits: the IPv4
const NAT64_LOCAL_LOW = 0x64ff9b0001n << 80n; // 64:ff9b:1::/48 (RFC 8215 local-use)
const NAT64_LOCAL_HIGH = NAT64_LOCAL_LOW + (1n << 80n);
const SIX_TO_FOUR_LOW = 0x2002n << 112n; // 2002::/16 — embeds an IPv4 in bits 80..111
const SIX_TO_FOUR_HIGH = 0x2003n << 112n;
const TEREDO_LOW = 0x20010000n << 96n; // 2001:0000::/32 — tunnels to an (obfuscated) IPv4
const TEREDO_HIGH = TEREDO_LOW + (1n << 96n);

/** Cloud metadata endpoints that are refused even when private egress is allowed. */
const METADATA_IPV4 = new Set<bigint>([
  (100n << 24n) | (100n << 16n) | (100n << 8n) | 200n, // Alibaba Cloud 100.100.100.200
  (192n << 24n) | (0n << 16n) | (0n << 8n) | 192n, // Oracle Cloud 192.0.0.192
]);

/** Strict dotted-quad (4 decimal parts 0-255) → 32-bit BigInt. */
function parseIPv4Strict(host: string): bigint | null {
  const parts = host.split(".");
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number.parseInt(p, 10);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

/** inet_aton semantics (1-4 parts; decimal / 0-octal / 0x-hex). `2130706433`,
 * `127.1`, `0177.0.0.1`, `0x7f.1` all parse to their real IPv4 value. */
function parseInetAton(host: string): bigint | null {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: bigint[] = [];
  for (const p of parts) {
    if (!p) return null;
    let v: bigint | null = null;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) v = BigInt(p);
    else if (/^0[0-7]+$/.test(p)) v = BigInt("0o" + p.slice(1));
    else if (/^[0-9]+$/.test(p)) v = BigInt(p);
    if (v === null || v > 0xffffffffn) return null;
    nums.push(v);
  }
  const last = nums[nums.length - 1]!;
  const lastMax = 1n << BigInt(8 * (5 - nums.length)); // 2^32, 2^24, 2^16, 2^8
  if (last >= lastMax) return null;
  if (nums.length === 4) return (nums[0]! << 24n) | (nums[1]! << 16n) | (nums[2]! << 8n) | nums[3]!;
  let n = nums[0]!;
  for (let i = 1; i < nums.length; i++) n = (n << 8n) | nums[i]!;
  return n;
}

/** Full RFC 4291 IPv6 (compression `::`, embedded IPv4 tail, no zone ids). */
function parseIPv6(input: string): bigint | null {
  let s = input.toLowerCase();
  if (!s || s.includes("%") || s.includes(":::")) return null;
  if (s.includes(".")) {
    const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (!m) return null;
    const v4 = parseIPv4Strict(m[2]!);
    if (v4 === null) return null;
    s = `${m[1]!}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  let groups: string[];
  const dbl = s.indexOf("::");
  if (dbl !== -1) {
    if (s.indexOf("::", dbl + 1) !== -1) return null;
    const left = dbl === 0 ? [] : s.slice(0, dbl).split(":");
    const right = dbl + 2 === s.length ? [] : s.slice(dbl + 2).split(":");
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null; // `::` must stand for at least one group
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = s.split(":");
  }
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/* ── Classification by range ── */

function isPrivateIPv4Num(n: bigint): boolean {
  const a = n >> 24n;
  const b = (n >> 16n) & 0xffn;
  if (a === 0n || a === 10n || a === 127n) return true; // this-network, private, loopback
  if (a === 169n && b === 254n) return true; // link-local incl. cloud metadata
  if (a === 172n && b >= 16n && b <= 31n) return true; // private
  if (a === 192n && b === 168n) return true; // private
  if (a === 100n && b >= 64n && b <= 127n) return true; // CGNAT
  if (a === 198n && (b === 18n || b === 19n)) return true; // benchmarking
  const c = (n >> 8n) & 0xffn;
  if (a === 192n && b === 0n && (c === 0n || c === 2n)) return true; // IETF protocol assignments (incl. Oracle metadata) + TEST-NET-1
  if (a === 198n && b === 51n && c === 100n) return true; // TEST-NET-2
  if (a === 203n && b === 0n && c === 113n) return true; // TEST-NET-3
  if (a >= 224n) return true; // multicast + reserved
  return false;
}

function isMetadataIPv4Num(n: bigint): boolean {
  if ((n >> 16n) === (169n << 8n | 254n)) return true; // 169.254.0.0/16
  return METADATA_IPV4.has(n);
}

function isPrivateIPv6Num(n: bigint): boolean {
  if (n === 0n || n === 1n) return true; // :: / ::1
  if (n >= V4_MAPPED_LOW && n < V4_MAPPED_HIGH) {
    return isPrivateIPv4Num(n & 0xffffffffn); // IPv4-mapped → classify embedded
  }
  if (n < 1n << 96n) return true; // ::/96 legacy IPv4-compatible — refuse
  if (n >= NAT64_LOW && n < NAT64_HIGH) return true; // NAT64 well-known prefix
  if (n >= NAT64_LOCAL_LOW && n < NAT64_LOCAL_HIGH) return true; // NAT64 local-use: a translator on this network
  if (n >= SIX_TO_FOUR_LOW && n < SIX_TO_FOUR_HIGH) return isPrivateIPv4Num((n >> 80n) & 0xffffffffn); // 6to4 → embedded IPv4
  if (n >= TEREDO_LOW && n < TEREDO_HIGH) return true; // Teredo tunnels — refuse
  if (n >= 0xfe80n << 112n && n < 0xfec0n << 112n) return true; // fe80::/10 link-local
  if (n >= 0xfec0n << 112n && n < 0xff00n << 112n) return true; // fec0::/10 deprecated site-local
  if (n >= 0xfc00n << 112n && n < 0xfe00n << 112n) return true; // fc00::/7 ULA
  if (n >= 0xff00n << 112n) return true; // ff00::/8 multicast
  return false;
}

/** Bits `from`..`from+len-1` of an IPv6 address, counted from the most significant bit. */
function bits(n: bigint, from: number, len: number): bigint {
  return (n >> BigInt(128 - from - len)) & ((1n << BigInt(len)) - 1n);
}

/**
 * Every IPv4 address an IPv6 address may carry, by each standard wrapping
 * that could route to it: IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible
 * (::a.b.c.d), NAT64 (64:ff9b::/96, and 64:ff9b:1::/48 at every RFC 6052
 * position a /48–/96 prefix allows), 6to4 (2002:AABB:CCDD::/48) and Teredo
 * (server in bits 32..63, client bit-inverted in the last 32 bits).
 */
export function embeddedIPv4(n: bigint): bigint[] {
  const out: bigint[] = [];
  if (n >= V4_MAPPED_LOW && n < V4_MAPPED_HIGH) out.push(n & 0xffffffffn);
  if (n > 1n && n < 1n << 32n) out.push(n); // ::a.b.c.d (:: and ::1 are not IPv4)
  if (n >= NAT64_LOW && n < NAT64_HIGH) out.push(n & 0xffffffffn);
  if (n >= NAT64_LOCAL_LOW && n < NAT64_LOCAL_HIGH) {
    // RFC 6052 §2.2: the IPv4 skips the "u" octet (bits 64..71).
    out.push((bits(n, 48, 16) << 16n) | bits(n, 72, 16)); // /48
    out.push((bits(n, 56, 8) << 24n) | bits(n, 72, 24)); // /56
    out.push(bits(n, 72, 32)); // /64
    out.push(n & 0xffffffffn); // /96
  }
  if (n >= SIX_TO_FOUR_LOW && n < SIX_TO_FOUR_HIGH) out.push(bits(n, 16, 32));
  if (n >= TEREDO_LOW && n < TEREDO_HIGH) {
    out.push(bits(n, 32, 32)); // Teredo server
    out.push((n & 0xffffffffn) ^ 0xffffffffn); // Teredo client
  }
  return out;
}

function isMetadataIPv6Num(n: bigint): boolean {
  if (n === 0xfd000ec2000000000000000000000254n) return true; // AWS IMDS over IPv6, fd00:ec2::254
  return embeddedIPv4(n).some(isMetadataIPv4Num);
}

/**
 * Resolve through the OS resolver (getaddrinfo), exactly like a normal connect
 * would: this honours /etc/hosts and container `extra_hosts` (e.g. a self-hosted
 * `localhost:11434` Ollama), which `dns.resolve4/6` silently ignored.
 */
async function resolveAll(hostname: string): Promise<string[]> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return [...new Set(records.map((r) => r.address))];
  } catch {
    return [];
  }
}

/** Any address form a URL hostname may legally carry. */
function parseIpLiteral(host: string): { kind: "v4" | "v6"; value: bigint } | null {
  if (host.includes(":")) {
    const v6 = parseIPv6(host);
    return v6 === null ? null : { kind: "v6", value: v6 };
  }
  const v4 = parseIPv4Strict(host) ?? parseInetAton(host);
  return v4 === null ? null : { kind: "v4", value: v4 };
}

export interface EgressDecision {
  allowed: boolean;
  /** Safe to show the person: names the host they typed, never a resolved address. */
  reason?: string;
}

/**
 * Where refused egress is logged with the resolved address. The client only
 * learns that a name resolves somewhere private or to metadata — echoing the
 * IP would map the server's internal network for whoever typed the URL.
 */
let egressLogger: Logger = silentLogger;
export function setEgressLogger(logger: Logger): void {
  egressLogger = logger;
}

/**
 * `shown` is what the client sees (the host as typed); `resolvedIp`, the DNS
 * answer behind a hostname, goes to the server log only.
 */
function validateLiteral(literal: { kind: "v4" | "v6"; value: bigint }, shown: string, allowPrivateEgress: boolean, resolvedIp?: string): EgressDecision {
  const isPrivate = literal.kind === "v4" ? isPrivateIPv4Num(literal.value) : isPrivateIPv6Num(literal.value);
  const isMetadata = literal.kind === "v4" ? isMetadataIPv4Num(literal.value) : isMetadataIPv6Num(literal.value);
  const via = resolvedIp ? " (the name resolves to such an address)" : "";
  let decision: EgressDecision = { allowed: true };
  if (isMetadata) decision = { allowed: false, reason: `Metadata target always refused: ${shown}${via}` };
  else if (isPrivate && !allowPrivateEgress) decision = { allowed: false, reason: `Private network target refused: ${shown}${via}` };
  if (!decision.allowed && resolvedIp) egressLogger.warn("egress refused", { host: shown, resolved_ip: resolvedIp, metadata: isMetadata });
  return decision;
}

/** Validate the URL shape and (when hosted) that resolved IPs are public. */
export async function checkEgress(rawUrl: string, allowPrivateEgress: boolean): Promise<EgressDecision> {
  const basic = basicUrlChecks(rawUrl);
  if (!basic.allowed) return basic;
  const { hostname } = parseHostParts(rawUrl);

  const literal = parseIpLiteral(hostname);
  if (literal) return validateLiteral(literal, hostname, allowPrivateEgress);

  // Hostnames are resolved and EVERY address validated.
  try {
    const ips = await resolveAll(hostname);
    if (ips.length === 0) return { allowed: false, reason: `DNS resolution failed for ${hostname}` };
    for (const ip of ips) {
      const lit = parseIpLiteral(ip);
      if (!lit) {
        egressLogger.warn("egress refused: unparseable DNS answer", { host: hostname, answer: ip.slice(0, 80) });
        return { allowed: false, reason: `Unparseable DNS answer for ${hostname}` };
      }
      const decision = validateLiteral(lit, hostname, allowPrivateEgress, ip);
      if (!decision.allowed) return decision;
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: `DNS resolution failed for ${hostname}` };
  }
}

function basicUrlChecks(rawUrl: string): EgressDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: `Invalid URL: ${rawUrl}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, reason: `Blocked protocol ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: "Credentials in URL are not allowed" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { allowed: false, reason: `Blocked host ${hostname}` };
  }
  return { allowed: true };
}

function parseHostParts(rawUrl: string): { hostname: string } {
  const url = new URL(rawUrl);
  return { hostname: url.hostname.toLowerCase().replace(/^\[|\]$/g, "") };
}

export class EgressBlockedError extends DomainError {
  constructor(reason: string) {
    super("EGRESS_BLOCKED", `Blocked AI endpoint: ${reason}`, 400);
    this.name = "EgressBlockedError";
  }
}

/* ── Connection pinning ── */

/**
 * Request options for a pinned target. The connection goes to the validated
 * IP; SNI and certificate validation must still use the ORIGINAL hostname
 * (Bun's option is `serverName`; `checkServerIdentity` makes the name check
 * explicit rather than trusting Bun to derive it from SNI). An IP literal
 * needs neither: the URL already names what is dialled and verified.
 */
export function pinnedRequestOptions(pin: Pick<PinnedTarget, "literal" | "servername">): {
  tls?: { serverName: string; checkServerIdentity: (host: string, cert: import("node:tls").PeerCertificate) => Error | undefined };
} {
  if (pin.literal) return {};
  return {
    tls: {
      serverName: pin.servername,
      checkServerIdentity: (_host, cert) => checkServerIdentity(pin.servername, cert),
    },
  };
}

export interface PinnedTarget {
  /** URL whose host is the VALIDATED IP; scheme/port/path unchanged. */
  fetchUrl: string;
  /** Original hostname (with non-default port) for the Host header. */
  hostHeader: string;
  /** TLS SNI + certificate name — the original hostname, never the IP. */
  servername: string;
  /** True when the target was already an IP literal (no rewrite needed). */
  literal: boolean;
}

/** Validate a URL and produce a pin: the connection goes to a validated IP,
 * with the original hostname carried in Host/SNI. Rebinding DNS answers can
 * no longer steer the connect after validation. */
export async function pinTarget(rawUrl: string, allowPrivateEgress: boolean): Promise<PinnedTarget> {
  const basic = basicUrlChecks(rawUrl);
  if (!basic.allowed) throw new EgressBlockedError(basic.reason ?? "policy");
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const hostHeader = url.port && Number.parseInt(url.port, 10) !== defaultPort ? `${hostname}:${url.port}` : hostname;

  const literal = parseIpLiteral(hostname);
  if (literal) {
    const decision = validateLiteral(literal, hostname, allowPrivateEgress);
    if (!decision.allowed) throw new EgressBlockedError(decision.reason ?? "policy");
    return { fetchUrl: rawUrl, hostHeader, servername: hostname, literal: true };
  }

  const ips = await resolveAll(hostname);
  if (ips.length === 0) throw new EgressBlockedError(`DNS resolution failed for ${hostname}`);
  let chosen: string | null = null;
  for (const ip of ips) {
    const lit = parseIpLiteral(ip);
    if (!lit) {
      egressLogger.warn("egress refused: unparseable DNS answer", { host: hostname, answer: ip.slice(0, 80) });
      throw new EgressBlockedError(`Unparseable DNS answer for ${hostname}`);
    }
    const decision = validateLiteral(lit, hostname, allowPrivateEgress, ip);
    if (!decision.allowed) throw new EgressBlockedError(decision.reason ?? "policy");
    if (chosen === null && lit.kind === "v4") chosen = ip; // prefer IPv4 for the connect
  }
  const connectIp = chosen ?? ips[0]!;
  const connectUrl = new URL(rawUrl);
  connectUrl.hostname = connectIp.includes(":") ? `[${connectIp}]` : connectIp;
  return { fetchUrl: connectUrl.toString(), hostHeader, servername: hostname, literal: false };
}

/**
 * Guarded fetch for provider traffic: egress check with connection pinning,
 * no uncontrolled redirects, and a hard response-size cap enforced on the
 * stream itself. Two clocks bound the exchange:
 * - `timeoutMs` is an idle limit: it covers the wait for headers and every gap
 *   between body chunks, so a provider that sends headers and then stalls
 *   still fails after `timeoutMs`;
 * - a total cap of `timeoutMs * TOTAL_TIMEOUT_FACTOR` ends a response that
 *   keeps trickling forever. A streamed generation that is still writing
 *   (long designs on slower models) is no longer cut at `timeoutMs`.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit & { timeoutMs: number; maxBytes: number; allowPrivateEgress: boolean },
): Promise<Response> {
  const { timeoutMs, maxBytes, allowPrivateEgress, ...requestInit } = init;
  const controller = new AbortController();
  const totalMs = timeoutMs * TOTAL_TIMEOUT_FACTOR;
  let timedOut: TimedOut = false;
  const expire = (kind: "idle" | "total") => () => {
    timedOut = kind;
    controller.abort();
  };
  let idleTimer = setTimeout(expire("idle"), timeoutMs);
  const totalTimer = setTimeout(expire("total"), totalMs);
  const stopTimers = () => {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  };
  const progressed = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(expire("idle"), timeoutMs);
  };
  const fail = (error: unknown): never => {
    stopTimers();
    throw toProviderError(error, timedOut, timeoutMs, totalMs);
  };

  let response: Response | undefined;
  try {
    let currentUrl = url;
    let method = (requestInit.method ?? "GET").toUpperCase();
    let body = requestInit.body;
    for (let hop = 0; hop < 3; hop++) {
      const pin = await pinTarget(currentUrl, allowPrivateEgress);
      const headers = new Headers(requestInit.headers);
      headers.set("host", pin.hostHeader);
      if (body === undefined || body === null) headers.delete("content-type");
      response = await fetch(pin.fetchUrl, {
        ...requestInit,
        method,
        body,
        headers,
        redirect: "manual",
        signal: controller.signal,
        ...pinnedRequestOptions(pin),
      } as RequestInit);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        // Always drain the redirect body so the connection is released.
        await response.body?.cancel().catch(() => undefined);
        if (!location) break;
        const next = new URL(location, currentUrl);
        const current = new URL(currentUrl);
        // Credential forwarding across origins is a leak: redirects must stay
        // on the same scheme+host+port as the configured endpoint (docs/13 §17).
        if (next.origin !== current.origin) {
          throw new EgressBlockedError("cross-origin redirect refused");
        }
        if (hop === 2) throw new EgressBlockedError("too many redirects");
        // RFC 9110: 301/302/303 turn a non-GET into a body-less GET; 307/308 keep it.
        if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") {
          method = "GET";
          body = undefined;
        }
        currentUrl = next.toString();
        continue;
      }
      break;
    }
  } catch (error) {
    fail(error);
  }

  const res = response!;
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    fail(new DomainError("PROVIDER_RESPONSE_TOO_LARGE", `Provider response exceeds ${maxBytes} bytes`, 502));
  }
  if (!res.body) {
    stopTimers();
    return res;
  }

  // Re-wrap the body: the clocks stay armed until the body is fully read (or
  // cancelled), every chunk resets the idle clock, and the byte cap applies
  // to every consumer (JSON or SSE).
  const upstream = res.body.getReader();
  let total = 0;
  const guardedBody = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { done, value } = await upstream.read();
        if (done) {
          stopTimers();
          ctrl.close();
          return;
        }
        progressed();
        total += value.byteLength;
        if (total > maxBytes) {
          stopTimers();
          await upstream.cancel().catch(() => undefined);
          ctrl.error(new DomainError("PROVIDER_RESPONSE_TOO_LARGE", `Provider response exceeds ${maxBytes} bytes`, 502));
          return;
        }
        ctrl.enqueue(value);
      } catch (error) {
        stopTimers();
        ctrl.error(toProviderError(error, timedOut, timeoutMs, totalMs));
      }
    },
    async cancel(reason) {
      stopTimers();
      await upstream.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(guardedBody, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** How much longer than the idle limit a response that keeps streaming may run. */
export const TOTAL_TIMEOUT_FACTOR = 4;

type TimedOut = false | "idle" | "total";

/** Map transport failures to domain errors (never a raw AbortError/TypeError 500). */
function toProviderError(error: unknown, timedOut: TimedOut, timeoutMs: number, totalMs: number): Error {
  if (error instanceof DomainError) return error;
  if (timedOut === "total") {
    return new DomainError("PROVIDER_TIMEOUT", `AI provider did not finish within ${Math.round(totalMs / 60_000)} minutes`, 504);
  }
  if (timedOut || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    return new DomainError("PROVIDER_TIMEOUT", `AI provider did not respond within ${Math.round(timeoutMs / 1000)}s`, 504);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DomainError("PROVIDER_UNREACHABLE", `AI provider request failed: ${message.slice(0, 200)}`, 502);
}

/** Read a response body enforcing the size cap even without content-length. */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DomainError("PROVIDER_RESPONSE_TOO_LARGE", `Provider response exceeds ${maxBytes} bytes`, 502);
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode(); // flush a trailing partial multi-byte sequence
    return out;
  } finally {
    reader.releaseLock();
  }
}
