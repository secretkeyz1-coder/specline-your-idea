import { expect, test, mock } from "bun:test";
mock.module("$env/dynamic/private", () => ({ env: {} }));
const { userFacingMessage } = await import("../src/lib/server/api.js");

test("developer references strip without changing ordinary or nested parentheses", () => {
  for (const [input, output] of [
    ["Failure (C7)", "Failure"],
    ["Failure (FR-036 / C7, ABC123a)", "Failure"],
    ["Failure (docs/12 §4)", "Failure"],
    ["Keep (ordinary text)", "Keep (ordinary text)"],
    ["Keep (C7 )", "Keep (C7 )"],
    ["Outer (ordinary (C7)) end", "Outer (ordinary) end"],
    ["Failure (docs/a (C7)) end", "Failure) end"],
    ["(C7,) keep", "(C7,) keep"],
    ["plain  text", "plain text"],
  ]) expect(userFacingMessage(input!)).toBe(output!);
});

test("bounded repeated groups and unmatched delimiters finish and preserve content", () => {
  expect(userFacingMessage(`failure${" (C7)".repeat(2048)}`)).toBe("failure");
  const bad = `(${"C7,".repeat(2048)}!`;
  expect(userFacingMessage(bad)).toBe(bad);
  expect(userFacingMessage("(".repeat(2048))).toBe("(".repeat(2048));
});
