/** Shared by every generating role: planning documents are read by the person who wrote the idea, so they follow that person's language, while identifiers stay machine-stable. */

export const LANGUAGE_RULE = `Language: write every human-readable string in the language the user wrote the idea and answers in (for example Indonesian if they wrote Indonesian). Keep keys (FR-…, AC-…, NFR-…, task refs), enum values, code, file paths, commands, env var names and technology names exactly as they are.`;
