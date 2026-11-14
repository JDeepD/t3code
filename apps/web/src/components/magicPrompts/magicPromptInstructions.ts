// A magic prompt's hidden instructions travel as a context record of a kind upstream does not
// know. The prompt holds a reference chip; deleting the chip drops the instructions.
import type {
  ComposerContextRecord,
  MagicPromptTemplate,
  OrchestrationMessageContext,
} from "@t3tools/contracts";
import { renderMagicPromptText } from "@t3tools/contracts";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  toComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAGIC_INSTRUCTIONS_KIND = "instructions";
/** Shown on the chip in place of "no longer available". */
export const MAGIC_INSTRUCTIONS_TOOLTIP = "Instructions sent to the agent with this message.";

const MAX_REMEMBERED = 40;

interface PendingInstructions {
  readonly label: string;
  readonly instructions: string;
}

/** Instructions for chips sitting in drafts, by context id. Persisted so a reload keeps them. */
export const useMagicInstructionsStore = create<{
  readonly pending: Readonly<Record<string, PendingInstructions>>;
}>()(persist(() => ({ pending: {} }), { name: "t3code:fork:magic-instructions:v1" }));

function remember(contextId: string, entry: PendingInstructions) {
  useMagicInstructionsStore.setState(({ pending }) => {
    const kept = Object.entries(pending).slice(-(MAX_REMEMBERED - 1));
    return { pending: { ...Object.fromEntries(kept), [contextId]: entry } };
  });
}

/**
 * The composer text for a template: the instructions chip, then the visible prompt. Without
 * `values`, placeholders are removed so the user types the missing part after the prompt.
 */
export function composeMagicPrompt(
  template: MagicPromptTemplate,
  values: Readonly<Record<string, string>> | null,
  uniqueId: string,
): string {
  const blanks = Object.fromEntries(template.placeholders.map((name) => [name, ""]));
  const fill = (text: string) => renderMagicPromptText(text, values ?? blanks);
  const visible =
    values === null ? fill(template.visible).trimEnd() : fill(template.visible).trim();
  const instructions = renderMagicPromptText(template.instructions, values ?? {}).trim();
  if (instructions === "") return visible;
  const contextId = toComposerContextId(`magic-${uniqueId}`);
  const label = `${template.title} instructions`;
  remember(contextId, { label, instructions });
  const chip = formatComposerContextReference({ kind: MAGIC_INSTRUCTIONS_KIND, contextId, label });
  // A prompt that ends with a colon is waiting for the user's text on the next line.
  return `${chip} ${visible}${values === null && visible.endsWith(":") ? "\n\n" : ""}`;
}

/** Adds the record behind each instructions chip in `text` to the outgoing message context. */
export function withMagicInstructionRecords(
  context: OrchestrationMessageContext | undefined,
  text: string,
  pending: Readonly<Record<string, PendingInstructions>> = useMagicInstructionsStore.getState()
    .pending,
): OrchestrationMessageContext | undefined {
  const records: ComposerContextRecord[] = [];
  for (const reference of collectComposerContextReferences(text)) {
    const entry = pending[reference.contextId];
    if (reference.kind !== MAGIC_INSTRUCTIONS_KIND || entry === undefined) continue;
    if (records.some((record) => record.contextId === reference.contextId)) continue;
    records.push({
      version: 1,
      contextId: reference.contextId,
      kind: MAGIC_INSTRUCTIONS_KIND,
      label: entry.label,
      payload: {
        note: "Follow these instructions for this message. The user chose them.",
        instructions: entry.instructions,
      },
    });
  }
  if (records.length === 0) return context;
  return { version: 1, ...context, records: [...(context?.records ?? []), ...records] };
}
