import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ForkDatabase from "../../../fork/ForkDatabase.ts";
import * as KnowledgeStore from "../../../knowledge/KnowledgeStore.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as KnowledgeHandlers from "./handlers.ts";
import { KnowledgeToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:knowledge");
const callerProject = liveThreadShell(threadId).projectId;

it.effect("saves todos to the caller's project, linked to its thread, and lists them", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-knowledge-mcp-" });
    const dependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:knowledge"),
        requestNamespace: "provider:knowledge",
        thread: {
          threadId,
          providerSessionId: "provider:knowledge",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      }),
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeedNone,
      }),
      KnowledgeStore.layerAt(path.join(dir, "plans")).pipe(
        Layer.provide(ForkDatabase.layerAt(path.join(dir, "fork.sqlite"))),
      ),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* KnowledgeToolkit;
      const store = yield* KnowledgeStore.KnowledgeStore;
      const save = (params: Parameters<typeof toolkit.handle<"t3_knowledge_save">>[1]) =>
        toolkit.handle("t3_knowledge_save", params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );

      const created = yield* save({ kind: "todo", body: "Write the release notes" });
      expect(created).toMatchObject({ kind: "todo", todo: { completed: false } });
      const id = (created as { todo: { id: string } }).todo.id;
      expect(yield* save({ kind: "todo", id, completed: true })).toMatchObject({
        todo: { id, body: "Write the release notes", completed: true },
      });

      const stored = (yield* store.list(callerProject)).todos;
      expect(stored.map((todo) => [todo.body, todo.completed, todo.source])).toEqual([
        ["Write the release notes", true, { threadId }],
      ]);

      expect(yield* save({ kind: "todo" })).toMatchObject({ code: "invalid_request" });
      expect(yield* save({ kind: "note", body: "x", completed: true })).toMatchObject({
        code: "invalid_request",
        message: "A note does not take completed.",
      });
      expect(
        yield* save({ kind: "note", body: "x", projectId: ProjectId.make("project:other") }),
      ).toMatchObject({ code: "invalid_request", message: "The project was not found." });

      const listed = yield* toolkit.handle("t3_knowledge_list", {}).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts) => parts.at(-1)?.result),
      );
      expect(listed).toEqual({
        projectId: callerProject,
        notes: [],
        todos: [{ id, body: "Write the release notes", completed: true }],
        plans: [],
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(KnowledgeHandlers.layer).pipe(
          Layer.provideMerge(dependencies),
        ),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
