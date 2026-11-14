import {
  KNOWLEDGE_NOTE_MAX_CHARS,
  type KnowledgePlan,
  KnowledgePlanId,
  type KnowledgeTodo,
  KnowledgeTodoId,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterKnowledge,
  groupTodosByPlan,
  noteBodyFromText,
  sortKeyForMove,
  sourceExcerpt,
} from "./knowledge.logic";

const projectId = ProjectId.make("project");
const stamp = "2026-11-14T00:00:00.000Z";

const todo = (id: string, sortKey: number, planId?: string): KnowledgeTodo => ({
  id: KnowledgeTodoId.make(id),
  projectId,
  body: `todo ${id}`,
  completed: false,
  ...(planId === undefined ? {} : { planId: KnowledgePlanId.make(planId) }),
  dependsOn: [],
  sortKey,
  createdAt: stamp,
  updatedAt: stamp,
});

const plan = (id: string, title: string): KnowledgePlan => ({
  id: KnowledgePlanId.make(id),
  projectId,
  title,
  path: `/plans/${id}.md`,
  createdAt: stamp,
  updatedAt: stamp,
});

describe("sortKeyForMove", () => {
  const todos = [todo("a", 1), todo("b", 2), todo("c", 3)];

  it("lands between the two todos it moves past", () => {
    expect(sortKeyForMove(todos, "c", "up")).toBe(1.5);
    expect(sortKeyForMove(todos, "a", "down")).toBe(2.5);
  });

  it("steps past the end todo when there is nothing beyond it", () => {
    expect(sortKeyForMove(todos, "b", "up")).toBe(0);
    expect(sortKeyForMove(todos, "b", "down")).toBe(4);
  });

  it("does nothing at either end or for an unknown todo", () => {
    expect(sortKeyForMove(todos, "a", "up")).toBeNull();
    expect(sortKeyForMove(todos, "c", "down")).toBeNull();
    expect(sortKeyForMove(todos, "missing", "up")).toBeNull();
  });
});

describe("groupTodosByPlan", () => {
  it("puts plan-less todos first and treats a deleted plan's todos as plan-less", () => {
    const groups = groupTodosByPlan(
      [todo("a", 1, "p1"), todo("b", 2), todo("c", 3, "gone")],
      [plan("p1", "First"), plan("p2", "Empty")],
    );
    expect(
      groups.map((group) => [group.plan?.title ?? null, group.todos.map((t) => t.id)]),
    ).toEqual([
      [null, ["b", "c"]],
      ["First", ["a"]],
    ]);
  });
});

describe("filterKnowledge", () => {
  it("matches text without regard to case and keeps everything for a blank query", () => {
    const snapshot = {
      projectId,
      notes: [],
      todos: [todo("Alpha", 1), todo("beta", 2)],
      plans: [plan("p1", "Alpha rollout"), plan("p2", "Other")],
    };
    const filtered = filterKnowledge(snapshot, "  ALPHA ");
    expect(filtered.todos.map((t) => t.id)).toEqual(["Alpha"]);
    expect(filtered.plans.map((p) => p.title)).toEqual(["Alpha rollout"]);
    expect(filterKnowledge(snapshot, "  ")).toBe(snapshot);
  });
});

describe("note text from chat", () => {
  it("cuts an over-long selection to the note limit", () => {
    const body = noteBodyFromText(`  ${"x".repeat(KNOWLEDGE_NOTE_MAX_CHARS + 50)}  `);
    expect(body).toHaveLength(KNOWLEDGE_NOTE_MAX_CHARS);
    expect(body.endsWith("…")).toBe(true);
    expect(noteBodyFromText("  short  ")).toBe("short");
  });

  it("flattens the excerpt to one line", () => {
    expect(sourceExcerpt("first\n\n  second\tthird")).toBe("first second third");
  });
});
