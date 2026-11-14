import { KnowledgeTodoId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ForkDatabase from "../fork/ForkDatabase.ts";
import * as KnowledgeStore from "./KnowledgeStore.ts";

const projectId = ProjectId.make("project-a");

const tempPaths = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-knowledge-" });
  return { dbPath: path.join(dir, "knowledge.sqlite"), plansDir: path.join(dir, "plans") };
});

/** Runs `use` against a store opened on `paths`, closing it afterwards. */
const withStore = <A, E, R>(
  paths: { readonly dbPath: string; readonly plansDir: string },
  use: (store: KnowledgeStore.KnowledgeStore["Service"]) => Effect.Effect<A, E, R>,
) =>
  KnowledgeStore.KnowledgeStore.pipe(
    Effect.flatMap(use),
    Effect.provide(
      KnowledgeStore.layerAt(paths.plansDir).pipe(
        Layer.provide(ForkDatabase.layerAt(paths.dbPath)),
      ),
    ),
  );

const newTodo = (store: KnowledgeStore.KnowledgeStore["Service"], body: string, extra = {}) =>
  store
    .save({ kind: "todo", projectId, body, ...extra })
    .pipe(
      Effect.map((result) => (result.kind === "todo" ? result.todo : assert.fail("not a todo"))),
    );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("KnowledgeStore", (it) => {
  it.effect("creates, edits, pins and deletes notes, keeping pinned ones first", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const source = { threadId: ThreadId.make("thread-1"), excerpt: "the quoted text" };
          const first = yield* store.save({ kind: "note", projectId, body: "first", source });
          yield* store.save({ kind: "note", projectId, body: "second" });
          assert.strictEqual(first.kind, "note");
          if (first.kind !== "note") return;
          yield* store.save({ kind: "note", projectId, id: first.note.id, pinned: true });

          const listed = yield* store.list(projectId);
          assert.deepStrictEqual(
            listed.notes.map((note) => [note.body, note.pinned]),
            [
              ["first", true],
              ["second", false],
            ],
          );
          assert.deepStrictEqual(listed.notes[0]?.source, source);
          assert.deepStrictEqual((yield* store.list(ProjectId.make("project-b"))).notes, []);

          yield* store.delete({ kind: "note", id: first.note.id });
          assert.deepStrictEqual(
            (yield* store.list(projectId)).notes.map((note) => note.body),
            ["second"],
          );
          const missing = yield* Effect.flip(store.delete({ kind: "note", id: first.note.id }));
          assert.strictEqual(missing._tag, "KnowledgeNotFoundError");
        }),
      );
    }),
  );

  it.effect("rejects a save made from a stale copy", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const created = yield* store.save({ kind: "note", projectId, body: "draft" });
          if (created.kind !== "note") return assert.fail("not a note");
          const { id, updatedAt } = created.note;
          const edited = yield* store.save({
            kind: "note",
            projectId,
            id,
            body: "edited elsewhere",
            expectedUpdatedAt: updatedAt,
          });
          if (edited.kind !== "note") return assert.fail("not a note");
          assert.notStrictEqual(edited.note.updatedAt, updatedAt);

          const conflict = yield* Effect.flip(
            store.save({ kind: "note", projectId, id, body: "mine", expectedUpdatedAt: updatedAt }),
          );
          assert.strictEqual(conflict._tag, "KnowledgeConflictError");
          assert.strictEqual((yield* store.list(projectId)).notes[0]?.body, "edited elsewhere");
        }),
      );
    }),
  );

  it.effect("orders todos and keeps dependencies inside one plan", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const planResult = yield* store.save({ kind: "plan", projectId, title: "Ship it" });
          if (planResult.kind !== "plan") return assert.fail("not a plan");
          const planId = planResult.plan.id;
          const a = yield* newTodo(store, "a", { planId });
          const b = yield* newTodo(store, "b", { planId, dependsOn: [a.id] });
          const loose = yield* newTodo(store, "loose");
          assert.deepStrictEqual(
            (yield* store.list(projectId)).todos.map((todo) => todo.body),
            ["a", "b", "loose"],
          );

          const crossPlan = yield* Effect.flip(
            store.save({ kind: "todo", projectId, id: loose.id, dependsOn: [a.id] }),
          );
          assert.strictEqual(crossPlan._tag, "KnowledgeInvalidError");
          const self = yield* Effect.flip(
            store.save({ kind: "todo", projectId, id: a.id, dependsOn: [a.id] }),
          );
          assert.strictEqual(self._tag, "KnowledgeInvalidError");
          const unknown = yield* Effect.flip(
            store.save({
              kind: "todo",
              projectId,
              id: a.id,
              dependsOn: [KnowledgeTodoId.make("missing")],
            }),
          );
          assert.strictEqual(unknown._tag, "KnowledgeNotFoundError");

          // Reorder: move "loose" to the top.
          yield* store.save({ kind: "todo", projectId, id: loose.id, sortKey: a.sortKey - 1 });
          yield* store.delete({ kind: "todo", id: a.id });
          const after = yield* store.list(projectId);
          assert.deepStrictEqual(
            after.todos.map((todo) => todo.body),
            ["loose", "b"],
          );
          assert.deepStrictEqual(after.todos.find((todo) => todo.id === b.id)?.dependsOn, []);
        }),
      );
    }),
  );

  it.effect("moving a todo to another plan drops the dependencies that would cross plans", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const a = yield* newTodo(store, "a");
          const b = yield* newTodo(store, "b", { dependsOn: [a.id] });
          const c = yield* newTodo(store, "c", { dependsOn: [b.id] });
          const plan = yield* store.save({ kind: "plan", projectId, title: "Other" });
          if (plan.kind !== "plan") return assert.fail("not a plan");
          yield* store.save({ kind: "todo", projectId, id: b.id, planId: plan.plan.id });

          const todos = (yield* store.list(projectId)).todos;
          assert.deepStrictEqual(todos.find((todo) => todo.id === b.id)?.dependsOn, []);
          assert.deepStrictEqual(todos.find((todo) => todo.id === c.id)?.dependsOn, []);

          yield* store.delete({ kind: "plan", id: plan.plan.id });
          const unlinked = (yield* store.list(projectId)).todos.find((todo) => todo.id === b.id);
          assert.strictEqual(unlinked?.planId, undefined);
        }),
      );
    }),
  );

  it.effect("keeps plans as markdown files and notices edits made on disk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const created = yield* store.save({
            kind: "plan",
            projectId,
            title: "Rework: the Login Flow!",
            markdown: "# Login\n",
          });
          if (created.kind !== "plan") return assert.fail("not a plan");
          const plan = created.plan;
          assert.isTrue(plan.path.endsWith("/project-a/rework-the-login-flow.md"));
          assert.strictEqual(yield* fs.readFileString(plan.path), "# Login\n");

          const twin = yield* store.save({
            kind: "plan",
            projectId,
            title: "Rework the login flow",
          });
          if (twin.kind !== "plan") return assert.fail("not a plan");
          assert.isTrue(twin.plan.path.endsWith("/rework-the-login-flow-2.md"));

          const written = yield* store.writePlan({
            id: plan.id,
            markdown: "# Login\n\n- step one\n",
            expectedUpdatedAt: plan.updatedAt,
          });
          assert.strictEqual(yield* fs.readFileString(plan.path), "# Login\n\n- step one\n");
          const stale = yield* Effect.flip(
            store.writePlan({ id: plan.id, markdown: "lost", expectedUpdatedAt: plan.updatedAt }),
          );
          assert.strictEqual(stale._tag, "KnowledgeConflictError");

          // An agent edits the file directly, later than the panel's last save.
          yield* fs.writeFileString(plan.path, "# Login\n\nedited by an agent\n");
          const future = DateTime.toDateUtc(
            DateTime.add(DateTime.makeUnsafe(written.plan.updatedAt), { minutes: 1 }),
          );
          yield* fs.utimes(plan.path, future, future);
          const onDisk = yield* store.readPlan({ id: plan.id });
          assert.strictEqual(onDisk.markdown, "# Login\n\nedited by an agent\n");
          assert.isAbove(Date.parse(onDisk.plan.updatedAt), Date.parse(written.plan.updatedAt));
          assert.strictEqual(
            (yield* store.list(projectId)).plans.find((item) => item.id === plan.id)?.updatedAt,
            onDisk.plan.updatedAt,
          );
          const overwrite = yield* Effect.flip(
            store.writePlan({
              id: plan.id,
              markdown: "panel copy",
              expectedUpdatedAt: written.plan.updatedAt,
            }),
          );
          assert.strictEqual(overwrite._tag, "KnowledgeConflictError");

          yield* store.delete({ kind: "plan", id: plan.id });
          assert.isFalse(yield* fs.exists(plan.path));
        }),
      );
    }),
  );

  it.effect("sends a new snapshot to subscribers after a change", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          const subscribed = yield* Deferred.make<void>();
          const snapshots = yield* store.subscribe(projectId).pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* Deferred.await(subscribed);
          yield* store.save({ kind: "note", projectId, body: "live" });
          const [initial, updated] = yield* Fiber.join(snapshots);
          assert.deepStrictEqual(initial?.notes, []);
          assert.deepStrictEqual(
            updated?.notes.map((note) => note.body),
            ["live"],
          );
        }),
      );
    }),
  );

  it.effect("keeps data across restarts and upgrades a database from an older schema", () =>
    Effect.gen(function* () {
      const paths = yield* tempPaths;
      yield* withStore(paths, (store) => store.save({ kind: "note", projectId, body: "kept" }));
      yield* TestClock.adjust("1 second");
      yield* withStore(paths, (store) =>
        Effect.gen(function* () {
          yield* store.save({ kind: "note", projectId, body: "added later" });
          assert.deepStrictEqual(
            (yield* store.list(projectId)).notes.map((note) => note.body),
            ["added later", "kept"],
          );
        }),
      );

      // A database that recorded version 0 has no tables yet; opening it runs every migration.
      const older = { ...paths, dbPath: `${paths.dbPath}.older` };
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_schema_version (version INTEGER NOT NULL)`;
        yield* sql`INSERT INTO fork_schema_version (version) VALUES (0)`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: older.dbPath })));
      yield* withStore(older, (store) => store.save({ kind: "todo", projectId, body: "works" }));
      const version = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ readonly version: number }>`SELECT version FROM fork_schema_version`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: older.dbPath })));
      assert.deepStrictEqual(version, [{ version: 2 }]);
    }),
  );
});
