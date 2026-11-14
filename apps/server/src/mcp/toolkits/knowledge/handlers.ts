import {
  type KnowledgeNote,
  KnowledgeNoteId,
  type KnowledgePlan,
  KnowledgePlanId,
  type KnowledgeSaveInput,
  type KnowledgeTodo,
  KnowledgeTodoId,
  OrchestratorMcpFailure,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as KnowledgeStore from "../../../knowledge/KnowledgeStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, resolveProjectId, unavailable } from "../../threadAccess.ts";
import { KnowledgeToolkit } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const knowledgeFailure = (error: { readonly _tag: string; readonly message: string }) =>
  error._tag === "KnowledgeStorageError" ? unavailable() : invalid(error.message);

/** The project to act on, and the caller thread when it belongs to that project. */
const target = Effect.fn("mcp.knowledge.target")(function* (projectId: ProjectId | undefined) {
  const context = yield* loadCaller();
  const resolved = yield* resolveProjectId(context, projectId);
  if (resolved !== context.caller?.projectId) {
    const projects = yield* ProjectService.ProjectService;
    const project = yield* projects.getById(resolved).pipe(Effect.mapError(unavailable));
    if (Option.isNone(project)) return yield* invalid("The project was not found.");
  }
  return {
    projectId: resolved,
    threadId: resolved === context.caller?.projectId ? context.caller.id : undefined,
  };
});

const note = ({ id, body, pinned }: KnowledgeNote) => ({ id, body, pinned });
const todo = ({ id, body, completed, planId }: KnowledgeTodo) => ({
  id,
  body,
  completed,
  ...(planId === undefined ? {} : { planId }),
});
const plan = ({ id, title, path }: KnowledgePlan) => ({ id, title, path });

const defined = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

export const layer = McpToolAccess.toLayer(KnowledgeToolkit, {
  t3_todos_notes_list: McpToolAccess.reads(({ projectId }) =>
    Effect.gen(function* () {
      const scope = yield* target(projectId);
      const knowledge = yield* KnowledgeStore.KnowledgeStore;
      const snapshot = yield* knowledge
        .list(scope.projectId)
        .pipe(Effect.mapError(knowledgeFailure));
      return {
        projectId: snapshot.projectId,
        notes: snapshot.notes.map(note),
        todos: snapshot.todos.map(todo),
        plans: snapshot.plans.map(plan),
      };
    }),
  ),
  t3_todos_notes_save: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* target(input.projectId);
      const creating = input.id === undefined;
      const source =
        creating && scope.threadId !== undefined ? { threadId: scope.threadId } : undefined;
      const misplaced = {
        note: ["completed", "planId", "title", "markdown"],
        todo: ["pinned", "title", "markdown"],
        plan: ["body", "completed", "pinned", "planId"],
      }[input.kind].filter((field) => input[field as keyof typeof input] !== undefined);
      if (misplaced.length > 0) {
        return yield* invalid(`A ${input.kind} does not take ${misplaced.join(", ")}.`);
      }
      if (creating && input.kind !== "plan" && input.body === undefined) {
        return yield* invalid(`Give the new ${input.kind} a body.`);
      }
      if (creating && input.kind === "plan" && input.title === undefined) {
        return yield* invalid("Give the new plan a title.");
      }
      if (!creating && input.kind === "plan" && input.markdown !== undefined) {
        return yield* invalid("Edit an existing plan's file at its path with your file tools.");
      }
      const base = { projectId: scope.projectId, ...(source === undefined ? {} : { source }) };
      const save: KnowledgeSaveInput =
        input.kind === "note"
          ? defined({
              kind: "note",
              ...base,
              id: input.id === undefined ? undefined : KnowledgeNoteId.make(input.id),
              body: input.body,
              pinned: input.pinned,
            })
          : input.kind === "todo"
            ? defined({
                kind: "todo",
                ...base,
                id: input.id === undefined ? undefined : KnowledgeTodoId.make(input.id),
                body: input.body,
                completed: input.completed,
                planId: input.planId,
              })
            : defined({
                kind: "plan",
                projectId: scope.projectId,
                id: input.id === undefined ? undefined : KnowledgePlanId.make(input.id),
                title: input.title,
                threadId: creating ? scope.threadId : undefined,
                markdown: input.markdown,
              });
      const knowledge = yield* KnowledgeStore.KnowledgeStore;
      const saved = yield* knowledge.save(save).pipe(Effect.mapError(knowledgeFailure));
      switch (saved.kind) {
        case "note":
          return { kind: saved.kind, note: note(saved.note) };
        case "todo":
          return { kind: saved.kind, todo: todo(saved.todo) };
        case "plan":
          return { kind: saved.kind, plan: plan(saved.plan) };
      }
    }),
  ),
  t3_todos_notes_delete: McpToolAccess.writes(({ kind, id }) =>
    Effect.gen(function* () {
      const knowledge = yield* KnowledgeStore.KnowledgeStore;
      yield* knowledge
        .delete(
          kind === "note"
            ? { kind, id: KnowledgeNoteId.make(id) }
            : kind === "todo"
              ? { kind, id: KnowledgeTodoId.make(id) }
              : { kind, id: KnowledgePlanId.make(id) },
        )
        .pipe(Effect.mapError(knowledgeFailure));
      return { kind, id };
    }),
  ),
});
