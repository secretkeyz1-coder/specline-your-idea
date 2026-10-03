/** Password hashing via Bun's native hasher (application-owned credentials, OD-003
 * fallback path: no external identity provider is required for self-hosting). */

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

export function passwordIssues(plain: string): string[] {
  const issues: string[] = [];
  if (plain.length < 10) issues.push("at least 10 characters");
  if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain)) issues.push("mixed case letters");
  if (!/[0-9]/.test(plain)) issues.push("at least one digit");
  return issues;
}
