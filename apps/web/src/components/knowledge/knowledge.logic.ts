import {
  type AssistantCitation,
  KNOWLEDGE_EXCERPT_MAX_CHARS,
  KNOWLEDGE_NOTE_MAX_CHARS,
  type KnowledgePlan,
  type KnowledgeSnapshot,
  type KnowledgeTodo,
  type MessageId,
} from "@t3tools/contracts";

export type KnowledgeTab = "notes" | "todos" | "plans";

/** Chat text on its way to becoming a note. The citation lets the note link back to it. */
export interface NoteFromChat {
  readonly text: string;
  readonly messageId: MessageId;
  readonly citation: AssistantCitation | null;
}

/** Items whose text contains `query`, ignoring case. A blank query keeps everything. */
export function filterKnowledge(snapshot: KnowledgeSnapshot, query: string): KnowledgeSnapshot {
  const needle = query.trim().toLowerCase();
  if (needle === "") return snapshot;
  const matches = (text: string) => text.toLowerCase().includes(needle);
  return {
    projectId: snapshot.projectId,
    notes: snapshot.notes.filter((note) => matches(note.body)),
    todos: snapshot.todos.filter((todo) => matches(todo.body)),
    plans: snapshot.plans.filter((plan) => matches(plan.title)),
  };
}

/** Selected or whole-message text as a note body: trimmed and cut to the note limit. */
export function noteBodyFromText(text: string): string {
  const body = text.trim();
  return body.length <= KNOWLEDGE_NOTE_MAX_CHARS
    ? body
    : `${body.slice(0, KNOWLEDGE_NOTE_MAX_CHARS - 1).trimEnd()}…`;
}

/** A one-line preview of the source text, stored so the note shows where it came from. */
export function sourceExcerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= KNOWLEDGE_EXCERPT_MAX_CHARS
    ? line
    : `${line.slice(0, KNOWLEDGE_EXCERPT_MAX_CHARS - 1)}…`;
}

/**
 * The sort key that moves `todoId` one step up or down among `todos` (already in display
 * order), or null when it is already at that end.
 */
export function sortKeyForMove(
  todos: ReadonlyArray<KnowledgeTodo>,
  todoId: string,
  direction: "up" | "down",
): number | null {
  const index = todos.findIndex((todo) => todo.id === todoId);
  const target = direction === "up" ? index - 1 : index + 1;
  const neighbor = todos[target];
  if (index === -1 || neighbor === undefined) return null;
  const beyond = todos[direction === "up" ? target - 1 : target + 1];
  if (beyond === undefined) return neighbor.sortKey + (direction === "up" ? -1 : 1);
  return (neighbor.sortKey + beyond.sortKey) / 2;
}

export interface TodoGroup {
  readonly plan: KnowledgePlan | null;
  readonly todos: ReadonlyArray<KnowledgeTodo>;
}

/** Todos without a plan first, then one group per plan that has todos, in plan order. */
export function groupTodosByPlan(
  todos: ReadonlyArray<KnowledgeTodo>,
  plans: ReadonlyArray<KnowledgePlan>,
): ReadonlyArray<TodoGroup> {
  const planIds = new Set<string>(plans.map((plan) => plan.id));
  const loose = todos.filter((todo) => todo.planId === undefined || !planIds.has(todo.planId));
  const groups: TodoGroup[] = loose.length > 0 ? [{ plan: null, todos: loose }] : [];
  for (const plan of plans) {
    const planned = todos.filter((todo) => todo.planId === plan.id);
    if (planned.length > 0) groups.push({ plan, todos: planned });
  }
  return groups;
}

// Phase 3 replaces these with editable magic prompts.
export function planThisPrompt(todoText: string): string {
  return `Help me plan this todo. Ask clarifying questions first, agree on an outline with me, then write the plan.\n\n> ${todoText.trim().split(/\r?\n/).join("\n> ")}`;
}

export function improvePlanPrompt(plan: KnowledgePlan): string {
  return `Review the plan "${plan.title}" at \`${plan.path}\`. Point out gaps, risks and unclear steps, then update the file with an improved version.`;
}

export function implementPlanPrompt(plan: KnowledgePlan): string {
  return `Implement the plan "${plan.title}" at \`${plan.path}\`. Read it first, then work through it step by step and keep the file's checklist up to date.`;
}
