import type { MagicPromptTemplate } from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import {
  composeMagicPrompt,
  useMagicInstructionsStore,
  withMagicInstructionRecords,
} from "./magicPromptInstructions";

const debug: MagicPromptTemplate = {
  id: "session.debug",
  group: "session",
  title: "Debug",
  description: "",
  placeholders: ["problem"],
  command: "debug",
  hasVisiblePrompt: true,
  visible: "Debug this problem:\n\n{{problem}}",
  instructions: "Find the cause of {{problem}} first.",
  source: "builtin",
};

describe("composeMagicPrompt", () => {
  it("leads with an instructions chip and fills the placeholders it was given", () => {
    const text = composeMagicPrompt(debug, { problem: "the crash" }, "a");
    const [chip] = collectComposerContextReferences(text);
    expect(chip?.kind).toBe("instructions");
    expect(chip?.label).toBe("Debug instructions");
    expect(text.endsWith(" Debug this problem:\n\nthe crash")).toBe(true);

    const sent = withMagicInstructionRecords(undefined, text);
    expect(sent?.records).toEqual([
      expect.objectContaining({
        kind: "instructions",
        contextId: chip?.contextId,
        payload: expect.objectContaining({ instructions: "Find the cause of the crash first." }),
      }),
    ]);
  });

  it("leaves room to type when a command inserts a template without values", () => {
    const text = composeMagicPrompt(debug, null, "b");
    expect(text.endsWith(" Debug this problem:\n\n")).toBe(true);
    const contextId = collectComposerContextReferences(text)[0]?.contextId ?? "";
    expect(useMagicInstructionsStore.getState().pending[contextId]?.instructions).toBe(
      "Find the cause of {{problem}} first.",
    );
  });

  it("adds no chip when the template has no instructions", () => {
    expect(composeMagicPrompt({ ...debug, instructions: "  " }, { problem: "x" }, "c")).toBe(
      "Debug this problem:\n\nx",
    );
  });
});

describe("withMagicInstructionRecords", () => {
  it("drops instructions whose chip the user deleted and keeps the other records", () => {
    const text = composeMagicPrompt(debug, { problem: "x" }, "d");
    const existing = { version: 1 as const, records: [] };
    expect(withMagicInstructionRecords(existing, "Debug this problem: x")).toBe(existing);
    expect(withMagicInstructionRecords(existing, `${text} ${text}`)?.records).toHaveLength(1);
  });
});
