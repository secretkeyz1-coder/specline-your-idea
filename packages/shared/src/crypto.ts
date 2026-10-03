/**
 * Authenticated application-layer secret storage (T025, FR-154).
 *
 * AES-256-GCM with an instance master key supplied OUTSIDE PostgreSQL.
 * Ciphertext format: `v1.<iv_b64>.<ciphertext_b64.(tag appended by WebCrypto)>`
 * The leading version enables future key rotation without changing records.
 * Master-key material is never logged, exported, or persisted.
 */
const KEY_VERSION = "v1";

export class SecretBox {
  private constructor(
    private readonly key: Uint8Array<ArrayBuffer>,
    private readonly cryptoObj: SubtleCrypto = globalThis.crypto.subtle,
  ) {}

  static fromMasterKey(masterKey: Uint8Array<ArrayBuffer>): SecretBox {
    if (masterKey.byteLength !== 32) {
      throw new Error("SecretBox requires a 32-byte master key");
    }
    return new SecretBox(masterKey);
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv: Uint8Array<ArrayBuffer> = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await this.importKey();
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await this.cryptoObj.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
    return [
      KEY_VERSION,
      toBase64(iv),
      toBase64(new Uint8Array(ciphertext)),
    ].join(".");
  }

  async decrypt(envelope: string): Promise<string> {
    const parts = envelope.split(".");
    if (parts.length !== 3 || parts[0] !== KEY_VERSION) {
      throw new Error("Unrecognized secret envelope version");
    }
    const [, ivB64, ctB64] = parts;
    const iv = fromBase64(ivB64!);
    const ciphertext = fromBase64(ctB64!);
    const cryptoKey = await this.importKey();
    const plaintext = await this.cryptoObj.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  private importKey(): Promise<CryptoKey> {
    return this.cryptoObj.importKey(
      "raw",
      this.key.buffer as ArrayBuffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, "base64");
  return new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
}

/** Constant-time string comparison for token comparison paths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
