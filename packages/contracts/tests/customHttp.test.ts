import { describe, expect, test } from "bun:test";
import { CustomHttpMappingSchema } from "../src/index.js";

/** Custom HTTP mapping template keys are attacker-influenced (workspace
 * admins configure providers). Reserved path segments must never survive
 * validation — they would let `assignPath` pollute Object.prototype. */
describe("custom http mapping template keys", () => {
  const base = {
    method: "POST",
    path: "/v1/chat",
    text_response_pointer: "/result/text",
  } as const;

  test("accepts ordinary dotted identifier paths", () => {
    const parsed = CustomHttpMappingSchema.parse({
      ...base,
      request_json_template: { "messages.0.content": "{{messages}}", model: "{{model}}" },
      headers: {},
    });
    expect(parsed.request_json_template["messages.0.content"]).toBe("{{messages}}");
  });

  test("rejects __proto__/prototype/constructor path segments", () => {
    for (const key of ["messages.__proto__.polluted", "__proto__.x", "model.prototype.y", "a.constructor.b"]) {
      const result = CustomHttpMappingSchema.safeParse({
        ...base,
        request_json_template: { [key]: "{{model}}" },
        headers: {},
      });
      expect(result.success).toBe(false);
    }
  });

  test("rejects non-identifier path characters", () => {
    for (const key of ["a b", "a;b", "a'b", "a\nb", ""]) {
      const result = CustomHttpMappingSchema.safeParse({
        ...base,
        request_json_template: { [key]: "{{model}}" },
        headers: {},
      });
      expect(result.success).toBe(false);
    }
  });
});
