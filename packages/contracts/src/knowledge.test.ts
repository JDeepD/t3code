import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";
import {
  KNOWLEDGE_NOTE_MAX_CHARS,
  KNOWLEDGE_TODO_MAX_CHARS,
  KnowledgeSaveInput,
} from "./knowledge.ts";

const decodeSaveInput = Schema.decodeUnknownOption(KnowledgeSaveInput);
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const decodes = (input: unknown) => decodeSaveInput(input)._tag === "Some";

describe("knowledge contracts", () => {
  it("caps note and todo length and rejects blank text", () => {
    const projectId = "project-1";
    expect(decodes({ kind: "note", projectId, body: "x".repeat(KNOWLEDGE_NOTE_MAX_CHARS) })).toBe(
      true,
    );
    expect(
      decodes({ kind: "note", projectId, body: "x".repeat(KNOWLEDGE_NOTE_MAX_CHARS + 1) }),
    ).toBe(false);
    expect(
      decodes({ kind: "todo", projectId, body: "x".repeat(KNOWLEDGE_TODO_MAX_CHARS + 1) }),
    ).toBe(false);
    expect(decodes({ kind: "note", projectId, body: "   " })).toBe(false);
    expect(decodes({ kind: "todo", projectId, id: "todo-1", planId: null })).toBe(true);
    expect(decodes({ kind: "task", projectId, body: "x" })).toBe(false);
  });

  it("stays absent from an upstream server's capabilities", () => {
    const upstream = decodeCapabilities({ repositoryIdentity: true });
    expect(upstream.knowledge).toBeUndefined();
  });
});
