// Fork feature: editable prompt templates. Additive to the upstream protocol.
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";

export const MAGIC_PROMPT_VISIBLE_MAX_CHARS = 4_000;
export const MAGIC_PROMPT_INSTRUCTIONS_MAX_CHARS = 8_000;

export const MagicPromptId = Schema.Literals([
  "git.commit",
  "git.pr",
  "git.conflict",
  "plan.todo",
  "plan.improve",
  "plan.implement",
  "session.catchup",
  "session.summary",
  "session.debug",
  "session.weigh",
  "session.tour",
  "session.review",
]);
export type MagicPromptId = typeof MagicPromptId.Type;

export const MagicPromptGroup = Schema.Literals(["git", "planning", "session"]);
export type MagicPromptGroup = typeof MagicPromptGroup.Type;

export const MagicPromptScope = Schema.Literals(["global", "project"]);
export type MagicPromptScope = typeof MagicPromptScope.Type;

const VisibleText = Schema.String.check(Schema.isMaxLength(MAGIC_PROMPT_VISIBLE_MAX_CHARS));
const InstructionsText = Schema.String.check(
  Schema.isMaxLength(MAGIC_PROMPT_INSTRUCTIONS_MAX_CHARS),
);

/** A template as it applies to one project, or to every project when none was asked for. */
export const MagicPromptTemplate = Schema.Struct({
  // A string, not MagicPromptId, so a client still decodes templates a newer server adds.
  id: Schema.String,
  group: Schema.String,
  title: Schema.String,
  description: Schema.String,
  /** Names accepted as `{{name}}` in either part. */
  placeholders: Schema.Array(Schema.String),
  /** The composer command that runs it, without the slash. */
  command: Schema.optionalKey(Schema.String),
  /** False for templates that only add instructions, such as commit message generation. */
  hasVisiblePrompt: Schema.Boolean,
  visible: Schema.String,
  instructions: Schema.String,
  /** The most specific scope that overrides this template. */
  source: Schema.Literals(["builtin", "global", "project"]),
});
export type MagicPromptTemplate = typeof MagicPromptTemplate.Type;

export const MagicPromptListInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
});
export type MagicPromptListInput = typeof MagicPromptListInput.Type;

export const MagicPromptListResult = Schema.Struct({
  templates: Schema.Array(MagicPromptTemplate),
});
export type MagicPromptListResult = typeof MagicPromptListResult.Type;

const overrideTarget = {
  id: MagicPromptId,
  scope: MagicPromptScope,
  /** Required for the project scope. */
  projectId: Schema.optionalKey(ProjectId),
};

export const MagicPromptSaveInput = Schema.Struct({
  ...overrideTarget,
  /** A part left out keeps inheriting from the scope above. */
  visible: Schema.optionalKey(VisibleText),
  instructions: Schema.optionalKey(InstructionsText),
});
export type MagicPromptSaveInput = typeof MagicPromptSaveInput.Type;

export const MagicPromptResetInput = Schema.Struct(overrideTarget);
export type MagicPromptResetInput = typeof MagicPromptResetInput.Type;

export class MagicPromptError extends Schema.TaggedError<MagicPromptError>()("MagicPromptError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Fills `{{name}}` from `values`. A name with no value is left as written. */
export function renderMagicPromptText(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return text.replace(PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? match) : match,
  );
}

/** The `{{name}}` placeholders in `text` that `allowed` does not list, for the editor's warning. */
export function unknownMagicPromptPlaceholders(
  text: string,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !allowed.includes(name)) unknown.add(name);
  }
  return [...unknown];
}
