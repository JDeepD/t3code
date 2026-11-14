// Fork feature: editable prompt templates. Built-in text, then a global override, then a
// project override. See FORK.md.
import {
  MagicPromptError,
  type MagicPromptId,
  type MagicPromptListInput,
  type MagicPromptListResult,
  type MagicPromptResetInput,
  type MagicPromptSaveInput,
  type MagicPromptTemplate,
  type ProjectId,
  renderMagicPromptText,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ForkDatabase from "../fork/ForkDatabase.ts";
import { BUILTIN_MAGIC_PROMPTS, type BuiltinMagicPrompt } from "./builtinTemplates.ts";

export class MagicPromptStore extends Context.Service<
  MagicPromptStore,
  {
    /** Every template as it applies to the project, or globally when no project is given. */
    readonly list: (
      input: MagicPromptListInput,
    ) => Effect.Effect<MagicPromptListResult, MagicPromptError>;
    readonly save: (input: MagicPromptSaveInput) => Effect.Effect<void, MagicPromptError>;
    readonly reset: (input: MagicPromptResetInput) => Effect.Effect<void, MagicPromptError>;
    /**
     * One template's instructions with placeholders filled, or "" when there are none.
     * Never fails: generated text must not break because a template could not be read.
     */
    readonly renderInstructions: (
      id: MagicPromptId,
      projectId: ProjectId | null,
      values: Readonly<Record<string, string>>,
    ) => Effect.Effect<string>;
  }
>()("t3/magicPrompts/MagicPromptStore") {}

type OverrideRow = {
  readonly template_id: string;
  readonly project_id: string;
  readonly visible: string | null;
  readonly instructions: string | null;
};

// The global override's project_id. A real project id is never blank.
const GLOBAL = "";

/** Project text wins over global text, which wins over the built-in, one part at a time. */
function resolveMagicPrompt(
  builtin: BuiltinMagicPrompt,
  global: OverrideRow | undefined,
  project: OverrideRow | undefined,
): MagicPromptTemplate {
  return {
    id: builtin.id,
    group: builtin.group,
    title: builtin.title,
    description: builtin.description,
    placeholders: builtin.placeholders,
    ...(builtin.command === undefined ? {} : { command: builtin.command }),
    hasVisiblePrompt: builtin.visible !== null,
    visible: project?.visible ?? global?.visible ?? builtin.visible ?? "",
    instructions: project?.instructions ?? global?.instructions ?? builtin.instructions,
    source: project !== undefined ? "project" : global !== undefined ? "global" : "builtin",
  };
}

const make = Effect.gen(function* () {
  const { sql } = yield* ForkDatabase.ForkDatabase;

  const failed = (message: string) => (cause: unknown) => new MagicPromptError({ message, cause });

  const scopeProjectId = (input: MagicPromptResetInput) =>
    input.scope === "global"
      ? Effect.succeed(GLOBAL)
      : input.projectId === undefined
        ? Effect.fail(new MagicPromptError({ message: "A project override needs a project." }))
        : Effect.succeed<string>(input.projectId);

  const list: MagicPromptStore["Service"]["list"] = Effect.fn("MagicPromptStore.list")(
    function* (input) {
      const rows = yield* sql<OverrideRow>`
        SELECT template_id, project_id, visible, instructions FROM magic_prompt_overrides
        WHERE project_id IN (${GLOBAL}, ${input.projectId ?? GLOBAL})
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(failed("Could not read the magic prompts.")),
      );
      const find = (id: string, projectId: string) =>
        rows.find((row) => row.template_id === id && row.project_id === projectId);
      return {
        templates: BUILTIN_MAGIC_PROMPTS.map((builtin) =>
          resolveMagicPrompt(
            builtin,
            find(builtin.id, GLOBAL),
            input.projectId === undefined ? undefined : find(builtin.id, input.projectId),
          ),
        ),
      };
    },
  );

  const save: MagicPromptStore["Service"]["save"] = Effect.fn("MagicPromptStore.save")(
    function* (input) {
      const projectId = yield* scopeProjectId(input);
      const now = DateTime.formatIso(yield* DateTime.now);
      const visible = input.visible ?? null;
      const instructions = input.instructions ?? null;
      yield* sql`
        INSERT INTO magic_prompt_overrides (template_id, project_id, visible, instructions, updated_at)
        VALUES (${input.id}, ${projectId}, ${visible}, ${instructions}, ${now})
        ON CONFLICT (template_id, project_id) DO UPDATE SET
          visible = excluded.visible,
          instructions = excluded.instructions,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(failed("Could not save the magic prompt.")));
    },
  );

  const reset: MagicPromptStore["Service"]["reset"] = Effect.fn("MagicPromptStore.reset")(
    function* (input) {
      const projectId = yield* scopeProjectId(input);
      yield* sql`
        DELETE FROM magic_prompt_overrides
        WHERE template_id = ${input.id} AND project_id = ${projectId}
      `.pipe(Effect.mapError(failed("Could not reset the magic prompt.")));
    },
  );

  const renderInstructions: MagicPromptStore["Service"]["renderInstructions"] = Effect.fn(
    "MagicPromptStore.renderInstructions",
  )(
    function* (id, projectId, values) {
      const { templates } = yield* list(projectId === null ? {} : { projectId });
      const template = templates.find((candidate) => candidate.id === id);
      return renderMagicPromptText(template?.instructions ?? "", values).trim();
    },
    Effect.orElseSucceed(() => ""),
  );

  return MagicPromptStore.of({ list, save, reset, renderInstructions });
});

export const layer = Layer.effect(MagicPromptStore, make);
