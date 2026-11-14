// Fork feature: per-project notes, todos and plans. Additive to the upstream protocol.
import * as Schema from "effect/Schema";

import { AssistantCitation } from "./assistantCitations.ts";
import {
  IsoDateTime,
  MessageId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const KNOWLEDGE_NOTE_MAX_CHARS = 3000;
export const KNOWLEDGE_TODO_MAX_CHARS = 1000;
export const KNOWLEDGE_PLAN_TITLE_MAX_CHARS = 200;
export const KNOWLEDGE_PLAN_MAX_CHARS = 200_000;
export const KNOWLEDGE_EXCERPT_MAX_CHARS = 280;

const makeKnowledgeId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const KnowledgeNoteId = makeKnowledgeId("KnowledgeNoteId");
export type KnowledgeNoteId = typeof KnowledgeNoteId.Type;
export const KnowledgeTodoId = makeKnowledgeId("KnowledgeTodoId");
export type KnowledgeTodoId = typeof KnowledgeTodoId.Type;
export const KnowledgePlanId = makeKnowledgeId("KnowledgePlanId");
export type KnowledgePlanId = typeof KnowledgePlanId.Type;

const NoteBody = TrimmedNonEmptyString.check(Schema.isMaxLength(KNOWLEDGE_NOTE_MAX_CHARS));
const TodoBody = TrimmedNonEmptyString.check(Schema.isMaxLength(KNOWLEDGE_TODO_MAX_CHARS));
const PlanTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(KNOWLEDGE_PLAN_TITLE_MAX_CHARS));
const PlanMarkdown = Schema.String.check(Schema.isMaxLength(KNOWLEDGE_PLAN_MAX_CHARS));

/** Where a note or todo came from, so the panel can link back to the chat. */
export const KnowledgeSource = Schema.Struct({
  threadId: ThreadId,
  messageId: Schema.optionalKey(MessageId),
  excerpt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(KNOWLEDGE_EXCERPT_MAX_CHARS))),
  /** The selection the note was made from, so the link can scroll to it. */
  citation: Schema.optionalKey(AssistantCitation),
});
export type KnowledgeSource = typeof KnowledgeSource.Type;

export const KnowledgeNote = Schema.Struct({
  id: KnowledgeNoteId,
  projectId: ProjectId,
  body: NoteBody,
  pinned: Schema.Boolean,
  source: Schema.optionalKey(KnowledgeSource),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KnowledgeNote = typeof KnowledgeNote.Type;

export const KnowledgeTodo = Schema.Struct({
  id: KnowledgeTodoId,
  projectId: ProjectId,
  body: TodoBody,
  completed: Schema.Boolean,
  planId: Schema.optionalKey(KnowledgePlanId),
  /** Todos this one waits on. They share its plan. */
  dependsOn: Schema.Array(KnowledgeTodoId),
  sortKey: Schema.Number,
  source: Schema.optionalKey(KnowledgeSource),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KnowledgeTodo = typeof KnowledgeTodo.Type;

export const KnowledgePlan = Schema.Struct({
  id: KnowledgePlanId,
  projectId: ProjectId,
  title: PlanTitle,
  /** Absolute path of the plan's markdown file on the environment's disk. */
  path: Schema.String,
  threadId: Schema.optionalKey(ThreadId),
  createdAt: IsoDateTime,
  /** The later of the last save and the file's modification time, so disk edits show up. */
  updatedAt: IsoDateTime,
});
export type KnowledgePlan = typeof KnowledgePlan.Type;

export const KnowledgeSnapshot = Schema.Struct({
  projectId: ProjectId,
  notes: Schema.Array(KnowledgeNote),
  todos: Schema.Array(KnowledgeTodo),
  plans: Schema.Array(KnowledgePlan),
});
export type KnowledgeSnapshot = typeof KnowledgeSnapshot.Type;

export const KnowledgeSubscribeInput = Schema.Struct({ projectId: ProjectId });
export type KnowledgeSubscribeInput = typeof KnowledgeSubscribeInput.Type;

// An absent id creates; a present id patches the fields that are given.
const saveBase = {
  projectId: ProjectId,
  /** Rejects the save when the stored item is newer than the copy the client edited. */
  expectedUpdatedAt: Schema.optionalKey(IsoDateTime),
};

export const KnowledgeSaveNoteInput = Schema.Struct({
  kind: Schema.Literal("note"),
  id: Schema.optionalKey(KnowledgeNoteId),
  ...saveBase,
  body: Schema.optionalKey(NoteBody),
  pinned: Schema.optionalKey(Schema.Boolean),
  source: Schema.optionalKey(KnowledgeSource),
});
export type KnowledgeSaveNoteInput = typeof KnowledgeSaveNoteInput.Type;

export const KnowledgeSaveTodoInput = Schema.Struct({
  kind: Schema.Literal("todo"),
  id: Schema.optionalKey(KnowledgeTodoId),
  ...saveBase,
  body: Schema.optionalKey(TodoBody),
  completed: Schema.optionalKey(Schema.Boolean),
  /** Null moves the todo out of its plan. */
  planId: Schema.optionalKey(Schema.NullOr(KnowledgePlanId)),
  dependsOn: Schema.optionalKey(Schema.Array(KnowledgeTodoId)),
  sortKey: Schema.optionalKey(Schema.Number),
  source: Schema.optionalKey(KnowledgeSource),
});
export type KnowledgeSaveTodoInput = typeof KnowledgeSaveTodoInput.Type;

export const KnowledgeSavePlanInput = Schema.Struct({
  kind: Schema.Literal("plan"),
  id: Schema.optionalKey(KnowledgePlanId),
  ...saveBase,
  title: Schema.optionalKey(PlanTitle),
  /** Null unlinks the plan from its thread. */
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  /** Initial file content. Only read when creating; later edits use `knowledge.writePlan`. */
  markdown: Schema.optionalKey(PlanMarkdown),
});
export type KnowledgeSavePlanInput = typeof KnowledgeSavePlanInput.Type;

export const KnowledgeSaveInput = Schema.Union([
  KnowledgeSaveNoteInput,
  KnowledgeSaveTodoInput,
  KnowledgeSavePlanInput,
]);
export type KnowledgeSaveInput = typeof KnowledgeSaveInput.Type;

export const KnowledgeSaveResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("note"), note: KnowledgeNote }),
  Schema.Struct({ kind: Schema.Literal("todo"), todo: KnowledgeTodo }),
  Schema.Struct({ kind: Schema.Literal("plan"), plan: KnowledgePlan }),
]);
export type KnowledgeSaveResult = typeof KnowledgeSaveResult.Type;

export const KnowledgeDeleteInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("note"), id: KnowledgeNoteId }),
  Schema.Struct({ kind: Schema.Literal("todo"), id: KnowledgeTodoId }),
  Schema.Struct({ kind: Schema.Literal("plan"), id: KnowledgePlanId }),
]);
export type KnowledgeDeleteInput = typeof KnowledgeDeleteInput.Type;

export const KnowledgeReadPlanInput = Schema.Struct({ id: KnowledgePlanId });
export type KnowledgeReadPlanInput = typeof KnowledgeReadPlanInput.Type;

export const KnowledgePlanDocument = Schema.Struct({
  plan: KnowledgePlan,
  markdown: Schema.String,
});
export type KnowledgePlanDocument = typeof KnowledgePlanDocument.Type;

export const KnowledgeWritePlanInput = Schema.Struct({
  id: KnowledgePlanId,
  markdown: PlanMarkdown,
  expectedUpdatedAt: IsoDateTime,
});
export type KnowledgeWritePlanInput = typeof KnowledgeWritePlanInput.Type;

const KnowledgeKind = Schema.Literals(["note", "todo", "plan"]);

/** The stored item changed after the client loaded it. Reload and show the newer version. */
export class KnowledgeConflictError extends Schema.TaggedError<KnowledgeConflictError>()(
  "KnowledgeConflictError",
  { kind: KnowledgeKind, id: Schema.String, updatedAt: IsoDateTime },
) {
  override get message(): string {
    return `This ${this.kind} changed somewhere else. Reload it and try again.`;
  }
}

export class KnowledgeNotFoundError extends Schema.TaggedError<KnowledgeNotFoundError>()(
  "KnowledgeNotFoundError",
  { kind: KnowledgeKind, id: Schema.String },
) {
  override get message(): string {
    return `That ${this.kind} no longer exists.`;
  }
}

export class KnowledgeInvalidError extends Schema.TaggedError<KnowledgeInvalidError>()(
  "KnowledgeInvalidError",
  { message: Schema.String },
) {}

export class KnowledgeStorageError extends Schema.TaggedError<KnowledgeStorageError>()(
  "KnowledgeStorageError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not ${this.operation}.`;
  }
}

export const KnowledgeError = Schema.Union([
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeInvalidError,
  KnowledgeStorageError,
]);
export type KnowledgeError = typeof KnowledgeError.Type;
