import { describe, expect, it } from "vite-plus/test";

import { renderMagicPromptText, unknownMagicPromptPlaceholders } from "./magicPrompts.ts";

describe("magic prompt placeholders", () => {
  it("fills known placeholders and leaves the rest as written", () => {
    expect(
      renderMagicPromptText("Fix {{ problem }} in {{file}}; see {{problem}}. {not} {{}}", {
        problem: "the crash",
      }),
    ).toBe("Fix the crash in {{file}}; see the crash. {not} {{}}");
  });

  it("does not expand placeholders inside a filled value", () => {
    expect(renderMagicPromptText("{{a}}", { a: "{{b}}", b: "x" })).toBe("{{b}}");
  });

  it("reports each placeholder a template does not accept once", () => {
    expect(unknownMagicPromptPlaceholders("{{a}} {{b}} {{c}} {{b}}", ["a"])).toEqual(["b", "c"]);
  });
});
