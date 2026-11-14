// Fork feature: agent access to the project's notes, todos and plans. See FORK.md.
import {
  KNOWLEDGE_NOTE_MAX_CHARS,
  KNOWLEDGE_PLAN_MAX_CHARS,
  KNOWLEDGE_PLAN_TITLE_MAX_CHARS,
  KNOWLEDGE_TODO_MAX_CHARS,
  KnowledgeNoteId,
  KnowledgePlanId,
  KnowledgeTodoId,
  OrchestratorMcpFailure,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as KnowledgeStore from "../../../knowledge/KnowledgeStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const Kind = Schema.Literals(["note", "todo", "plan"]);

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    KnowledgeStore.KnowledgeStore,
  ],
};

const projectIdParameter = Schema.optionalKey(
  ProjectId.annotate({ description: "Defaults to the caller thread's project." }),
);

const Note = Schema.Struct({ id: KnowledgeNoteId, body: Schema.String, pinned: Schema.Boolean });
const Todo = Schema.Struct({
  id: KnowledgeTodoId,
  body: Schema.String,
  completed: Schema.Boolean,
  planId: Schema.optionalKey(KnowledgePlanId),
});
const Plan = Schema.Struct({ id: KnowledgePlanId, title: Schema.String, path: Schema.String });

const KnowledgeListTool = Tool.make("t3_knowledge_list", {
  ...shared,
  description:
    "List the project's notes, todos and plans from the user's T3 Code notes panel. A plan is a markdown file at `path`; read and edit it with file tools.",
  parameters: Schema.Struct({ projectId: projectIdParameter }),
  success: Schema.Struct({
    projectId: ProjectId,
    notes: Schema.Array(Note),
    todos: Schema.Array(Todo),
    plans: Schema.Array(Plan),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const KnowledgeSaveTool = Tool.make("t3_knowledge_save", {
  ...shared,
  description:
    "Add or change an item in the user's T3 Code notes panel, only when the user asks for notes, todos or a plan there. No `id` creates; an `id` changes only the fields given. `completed` and `planId` are for todos, `pinned` for notes, `title` and `markdown` for a new plan.",
  parameters: Schema.Struct({
    kind: Kind,
    id: Schema.optionalKey(TrimmedNonEmptyString),
    projectId: projectIdParameter,
    body: Schema.optionalKey(
      TrimmedNonEmptyString.annotate({
        description: `Note (max ${KNOWLEDGE_NOTE_MAX_CHARS} chars) or todo (max ${KNOWLEDGE_TODO_MAX_CHARS}) text.`,
      }),
    ),
    completed: Schema.optionalKey(Schema.Boolean),
    pinned: Schema.optionalKey(Schema.Boolean),
    planId: Schema.optionalKey(
      Schema.NullOr(KnowledgePlanId).annotate({
        description: "Null moves the todo out of its plan.",
      }),
    ),
    title: Schema.optionalKey(
      TrimmedNonEmptyString.check(Schema.isMaxLength(KNOWLEDGE_PLAN_TITLE_MAX_CHARS)),
    ),
    markdown: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(KNOWLEDGE_PLAN_MAX_CHARS))),
  }),
  success: Schema.Struct({
    kind: Kind,
    note: Schema.optionalKey(Note),
    todo: Schema.optionalKey(Todo),
    plan: Schema.optionalKey(Plan),
  }),
}).annotate(Tool.Destructive, false);

const KnowledgeDeleteTool = Tool.make("t3_knowledge_delete", {
  ...shared,
  description:
    "Delete a note, todo or plan from the user's T3 Code notes panel, only when the user asks. Deleting a plan also deletes its file.",
  parameters: Schema.Struct({ kind: Kind, id: TrimmedNonEmptyString }),
  success: Schema.Struct({ kind: Kind, id: Schema.String }),
}).annotate(Tool.Destructive, true);

export const KnowledgeToolkit = Toolkit.make(
  KnowledgeListTool,
  KnowledgeSaveTool,
  KnowledgeDeleteTool,
);
