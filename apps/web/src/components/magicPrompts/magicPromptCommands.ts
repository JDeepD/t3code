import type { MagicPromptTemplate } from "@t3tools/contracts";

/** A composer `/command` that inserts a magic prompt. */
export interface MagicPromptCommandItem {
  readonly id: string;
  readonly type: "magic-prompt";
  readonly template: MagicPromptTemplate;
  readonly label: string;
  readonly description: string;
}

/**
 * The templates offered for a `/query`, best match first. A name another command already uses
 * is left out, so a provider's own command or skill always wins.
 */
export function magicPromptCommandItems(
  templates: ReadonlyArray<MagicPromptTemplate>,
  query: string,
  takenNames: ReadonlyArray<string>,
): ReadonlyArray<MagicPromptCommandItem> {
  const needle = query.trim().toLowerCase();
  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  return templates
    .flatMap((template) => {
      const command = template.command?.toLowerCase();
      if (command === undefined || !template.hasVisiblePrompt || taken.has(command)) return [];
      const rank = command.startsWith(needle)
        ? 0
        : command.includes(needle)
          ? 1
          : template.title.toLowerCase().includes(needle)
            ? 2
            : null;
      if (rank === null) return [];
      const item: MagicPromptCommandItem = {
        id: `magic-prompt:${template.id}`,
        type: "magic-prompt",
        template,
        label: `/${command}`,
        description: template.description,
      };
      return [{ rank, item }];
    })
    .toSorted((left, right) => left.rank - right.rank)
    .map(({ item }) => item);
}
