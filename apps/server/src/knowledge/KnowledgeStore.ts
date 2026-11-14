// Fork feature. Owns its own SQLite file and plans directory, so it never touches the upstream
// migration chain. See FORK.md.
import {
  type KnowledgeDeleteInput,
  KnowledgeConflictError,
  KnowledgeInvalidError,
  KnowledgeNoteId,
  KnowledgeNotFoundError,
  type KnowledgeNote,
  type KnowledgePlan,
  type KnowledgePlanDocument,
  KnowledgePlanId,
  type KnowledgeReadPlanInput,
  type KnowledgeSaveInput,
  type KnowledgeSaveNoteInput,
  type KnowledgeSavePlanInput,
  type KnowledgeSaveResult,
  type KnowledgeSaveTodoInput,
  type KnowledgeSnapshot,
  KnowledgeSource,
  KnowledgeStorageError,
  type KnowledgeTodo,
  KnowledgeTodoId,
  type KnowledgeWritePlanInput,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";

type KnowledgeFailure =
  | KnowledgeConflictError
  | KnowledgeNotFoundError
  | KnowledgeInvalidError
  | KnowledgeStorageError;

export class KnowledgeStore extends Context.Service<
  KnowledgeStore,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<KnowledgeSnapshot, KnowledgeStorageError>;
    /** The project's snapshot now, then again after each change, including plan edits on disk. */
    readonly subscribe: (
      projectId: ProjectId,
    ) => Stream.Stream<KnowledgeSnapshot, KnowledgeStorageError>;
    readonly save: (
      input: KnowledgeSaveInput,
    ) => Effect.Effect<KnowledgeSaveResult, KnowledgeFailure>;
    readonly delete: (input: KnowledgeDeleteInput) => Effect.Effect<void, KnowledgeFailure>;
    readonly readPlan: (
      input: KnowledgeReadPlanInput,
    ) => Effect.Effect<KnowledgePlanDocument, KnowledgeFailure>;
    readonly writePlan: (
      input: KnowledgeWritePlanInput,
    ) => Effect.Effect<KnowledgePlanDocument, KnowledgeFailure>;
  }
>()("t3/knowledge/KnowledgeStore") {}

export interface KnowledgePaths {
  readonly dbPath: string;
  readonly plansDir: string;
}

// Each entry upgrades the schema by one version. Append; never edit a shipped entry.
const SCHEMA_MIGRATIONS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    `CREATE TABLE knowledge_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      source_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX knowledge_notes_project ON knowledge_notes (project_id)`,
    `CREATE TABLE knowledge_todos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      body TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      plan_id TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      sort_key REAL NOT NULL,
      source_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX knowledge_todos_project ON knowledge_todos (project_id)`,
    `CREATE TABLE knowledge_plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX knowledge_plans_project ON knowledge_plans (project_id)`,
  ],
];

type NoteRow = {
  readonly id: string;
  readonly project_id: string;
  readonly body: string;
  readonly pinned: number;
  readonly source_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

type TodoRow = Omit<NoteRow, "pinned"> & {
  readonly completed: number;
  readonly plan_id: string | null;
  readonly depends_on_json: string;
  readonly sort_key: number;
};

type PlanRow = {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly path: string;
  readonly thread_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

const SourceJson = Schema.fromJsonString(KnowledgeSource);
const DependsOnJson = Schema.fromJsonString(Schema.Array(KnowledgeTodoId));
const decodeSource = Schema.decodeUnknownOption(SourceJson);
const encodeSource = Schema.encodeSync(SourceJson);
const decodeDependsOn = Schema.decodeUnknownOption(DependsOnJson);
const encodeDependsOn = Schema.encodeSync(DependsOnJson);

// An unreadable source only loses the link back to the chat, so the item still loads.
const sourceField = (json: string | null) => {
  const source = json === null ? Option.none() : decodeSource(json);
  return Option.isSome(source) ? { source: source.value } : {};
};

const toNote = (row: NoteRow): KnowledgeNote => ({
  id: KnowledgeNoteId.make(row.id),
  projectId: ProjectId.make(row.project_id),
  body: row.body,
  pinned: row.pinned === 1,
  ...sourceField(row.source_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTodo = (row: TodoRow): KnowledgeTodo => ({
  id: KnowledgeTodoId.make(row.id),
  projectId: ProjectId.make(row.project_id),
  body: row.body,
  completed: row.completed === 1,
  ...(row.plan_id === null ? {} : { planId: KnowledgePlanId.make(row.plan_id) }),
  dependsOn: Option.getOrElse(decodeDependsOn(row.depends_on_json), () => []),
  sortKey: row.sort_key,
  ...sourceField(row.source_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const later = (left: string, right: string) => (left >= right ? left : right);

/** A timestamp after `previous`, so two saves in one millisecond still differ. */
const stampAfter = (now: string, previous: string) =>
  now > previous
    ? now
    : DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(previous), { milliseconds: 1 }));

const planFileSlug = (title: string) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "plan";

const projectDirectoryName = (projectId: ProjectId) => projectId.replace(/[^A-Za-z0-9_-]/g, "_");

const make = Effect.fn("KnowledgeStore.make")(function* (paths: KnowledgePaths) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;

  const storageError = (operation: string) => (cause: unknown) =>
    new KnowledgeStorageError({ operation, cause });

  yield* fs
    .makeDirectory(path.dirname(paths.dbPath), { recursive: true })
    .pipe(Effect.mapError(storageError("create the knowledge folder")));
  // A private client: the server's SqlClient service is the upstream database.
  const sql = Context.get(
    yield* Layer.build(NodeSqliteClient.layer({ filename: paths.dbPath })),
    SqlClient.SqlClient,
  );

  yield* Effect.gen(function* () {
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`CREATE TABLE IF NOT EXISTS fork_schema_version (version INTEGER NOT NULL)`;
    const recorded = yield* sql<{ readonly version: number }>`
      SELECT version FROM fork_schema_version
    `;
    const current = recorded[0]?.version ?? 0;
    if (recorded.length === 0) yield* sql`INSERT INTO fork_schema_version (version) VALUES (0)`;
    for (const [index, statements] of SCHEMA_MIGRATIONS.entries()) {
      if (index < current) continue;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const statement of statements) yield* sql.unsafe(statement);
          yield* sql`UPDATE fork_schema_version SET version = ${index + 1}`;
        }),
      );
    }
  }).pipe(Effect.mapError(storageError("open the knowledge database")));

  // Any change re-reads each subscriber's project; identical snapshots are dropped there.
  const changes = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const newId = random.uuidV4().pipe(Effect.mapError(storageError("create an id")));

  const fileModifiedAt = (filePath: string) =>
    fs.stat(filePath).pipe(
      Effect.map((info) => Option.map(info.mtime, (mtime) => mtime.toISOString())),
      Effect.orElseSucceed(() => Option.none<string>()),
    );

  const toPlan = Effect.fnUntraced(function* (row: PlanRow) {
    const modifiedAt = yield* fileModifiedAt(row.path);
    const plan: KnowledgePlan = {
      id: KnowledgePlanId.make(row.id),
      projectId: ProjectId.make(row.project_id),
      title: row.title,
      path: row.path,
      ...(row.thread_id === null ? {} : { threadId: ThreadId.make(row.thread_id) }),
      createdAt: row.created_at,
      updatedAt: Option.match(modifiedAt, {
        onNone: () => row.updated_at,
        onSome: (mtime) => later(row.updated_at, mtime),
      }),
    };
    return plan;
  });

  const list: KnowledgeStore["Service"]["list"] = Effect.fn("KnowledgeStore.list")(
    function* (projectId) {
      const [notes, todos, plans] = yield* Effect.all([
        sql<NoteRow>`
          SELECT * FROM knowledge_notes WHERE project_id = ${projectId}
          ORDER BY pinned DESC, created_at DESC, id
        `,
        sql<TodoRow>`
          SELECT * FROM knowledge_todos WHERE project_id = ${projectId} ORDER BY sort_key, id
        `,
        sql<PlanRow>`
          SELECT * FROM knowledge_plans WHERE project_id = ${projectId}
          ORDER BY created_at DESC, id
        `,
      ]).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(storageError("list notes, todos and plans")),
      );
      return {
        projectId,
        notes: notes.map(toNote),
        todos: todos.map(toTodo),
        plans: yield* Effect.forEach(plans, toPlan),
      };
    },
  );

  const projectPlansDir = (projectId: ProjectId) =>
    path.join(paths.plansDir, projectDirectoryName(projectId));

  const subscribe: KnowledgeStore["Service"]["subscribe"] = (projectId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading to buffer concurrent changes.
        const subscription = yield* PubSub.subscribe(changes);
        const directory = projectPlansDir(projectId);
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);
        // Editors emit several events per save, and fs.watch can fire before the flush.
        const diskEdits = fs.watch(directory).pipe(
          Stream.debounce(Duration.millis(150)),
          Stream.catchCause(() => Stream.empty),
        );
        return Stream.concat(
          Stream.fromEffect(list(projectId)),
          Stream.merge(Stream.fromSubscription(subscription), diskEdits).pipe(
            Stream.mapEffect(() => list(projectId)),
          ),
        ).pipe(Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)));
      }),
    );

  const checkExpected = (
    kind: "note" | "todo" | "plan",
    id: string,
    updatedAt: string,
    expected: string | undefined,
  ) =>
    expected === undefined || expected === updatedAt
      ? Effect.void
      : Effect.fail(new KnowledgeConflictError({ kind, id, updatedAt }));

  const findNote = Effect.fnUntraced(function* (id: KnowledgeNoteId, projectId?: ProjectId) {
    const rows = yield* sql<NoteRow>`SELECT * FROM knowledge_notes WHERE id = ${id}`.pipe(
      Effect.mapError(storageError("read the note")),
    );
    const row = rows[0];
    if (row === undefined || (projectId !== undefined && row.project_id !== projectId)) {
      return yield* new KnowledgeNotFoundError({ kind: "note", id });
    }
    return row;
  });

  const findTodo = Effect.fnUntraced(function* (id: KnowledgeTodoId, projectId?: ProjectId) {
    const rows = yield* sql<TodoRow>`SELECT * FROM knowledge_todos WHERE id = ${id}`.pipe(
      Effect.mapError(storageError("read the todo")),
    );
    const row = rows[0];
    if (row === undefined || (projectId !== undefined && row.project_id !== projectId)) {
      return yield* new KnowledgeNotFoundError({ kind: "todo", id });
    }
    return row;
  });

  const findPlan = Effect.fnUntraced(function* (id: KnowledgePlanId, projectId?: ProjectId) {
    const rows = yield* sql<PlanRow>`SELECT * FROM knowledge_plans WHERE id = ${id}`.pipe(
      Effect.mapError(storageError("read the plan")),
    );
    const row = rows[0];
    if (row === undefined || (projectId !== undefined && row.project_id !== projectId)) {
      return yield* new KnowledgeNotFoundError({ kind: "plan", id });
    }
    return row;
  });

  const sourceJson = (source: KnowledgeSource | undefined, fallback: string | null) =>
    source === undefined ? fallback : encodeSource(source);

  const saveNote = Effect.fn("KnowledgeStore.saveNote")(function* (input: KnowledgeSaveNoteInput) {
    const now = yield* nowIso;
    if (input.id === undefined) {
      if (input.body === undefined) {
        return yield* new KnowledgeInvalidError({ message: "A new note needs text." });
      }
      const row: NoteRow = {
        id: yield* newId,
        project_id: input.projectId,
        body: input.body,
        pinned: input.pinned === true ? 1 : 0,
        source_json: sourceJson(input.source, null),
        created_at: now,
        updated_at: now,
      };
      yield* sql`INSERT INTO knowledge_notes ${sql.insert(row)}`.pipe(
        Effect.mapError(storageError("save the note")),
      );
      return toNote(row);
    }
    const existing = yield* findNote(input.id, input.projectId);
    yield* checkExpected("note", existing.id, existing.updated_at, input.expectedUpdatedAt);
    const row: NoteRow = {
      ...existing,
      body: input.body ?? existing.body,
      pinned: input.pinned === undefined ? existing.pinned : input.pinned ? 1 : 0,
      source_json: sourceJson(input.source, existing.source_json),
      updated_at: stampAfter(now, existing.updated_at),
    };
    yield* sql`
      UPDATE knowledge_notes
      SET body = ${row.body}, pinned = ${row.pinned}, source_json = ${row.source_json},
        updated_at = ${row.updated_at}
      WHERE id = ${row.id}
    `.pipe(Effect.mapError(storageError("save the note")));
    return toNote(row);
  });

  /** Drops `todoId` from every other todo's dependencies in its project. */
  const removeDependents = Effect.fnUntraced(function* (projectId: string, todoId: string) {
    const todos = yield* sql<TodoRow>`
      SELECT * FROM knowledge_todos WHERE project_id = ${projectId} AND depends_on_json <> '[]'
    `;
    for (const todo of todos) {
      const dependsOn = toTodo(todo).dependsOn;
      if (!dependsOn.some((id) => id === todoId)) continue;
      yield* sql`
        UPDATE knowledge_todos
        SET depends_on_json = ${encodeDependsOn(dependsOn.filter((id) => id !== todoId))}
        WHERE id = ${todo.id}
      `;
    }
  });

  const checkDependencies = Effect.fnUntraced(function* (
    todoId: string,
    projectId: string,
    planId: string | null,
    dependsOn: ReadonlyArray<KnowledgeTodoId>,
  ) {
    for (const dependencyId of dependsOn) {
      if (dependencyId === todoId) {
        return yield* new KnowledgeInvalidError({ message: "A todo cannot depend on itself." });
      }
      const dependency = yield* findTodo(dependencyId);
      if (dependency.project_id !== projectId || dependency.plan_id !== planId) {
        return yield* new KnowledgeInvalidError({
          message: "A todo can only depend on todos in the same plan.",
        });
      }
    }
  });

  const saveTodo = Effect.fn("KnowledgeStore.saveTodo")(function* (input: KnowledgeSaveTodoInput) {
    const now = yield* nowIso;
    const existing =
      input.id === undefined ? undefined : yield* findTodo(input.id, input.projectId);
    if (existing !== undefined) {
      yield* checkExpected("todo", existing.id, existing.updated_at, input.expectedUpdatedAt);
    }
    const body = input.body ?? existing?.body;
    if (body === undefined) {
      return yield* new KnowledgeInvalidError({ message: "A new todo needs text." });
    }
    const planId = input.planId === undefined ? (existing?.plan_id ?? null) : input.planId;
    if (planId !== null && planId !== existing?.plan_id) {
      yield* findPlan(KnowledgePlanId.make(planId), input.projectId);
    }
    const moved = existing !== undefined && planId !== existing.plan_id;
    // Dependencies stay within one plan, so a move drops the ones it would break.
    const dependsOn =
      input.dependsOn ?? (existing === undefined || moved ? [] : toTodo(existing).dependsOn);
    const id = existing?.id ?? (yield* newId);
    yield* checkDependencies(id, input.projectId, planId, dependsOn);

    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const sortKey =
            input.sortKey ??
            existing?.sort_key ??
            ((yield* sql<{ readonly top: number | null }>`
              SELECT MAX(sort_key) AS top FROM knowledge_todos WHERE project_id = ${input.projectId}
            `)[0]?.top ?? 0) + 1;
          const row: TodoRow = {
            id,
            project_id: input.projectId,
            body,
            completed:
              input.completed === undefined ? (existing?.completed ?? 0) : input.completed ? 1 : 0,
            plan_id: planId,
            depends_on_json: encodeDependsOn(dependsOn),
            sort_key: sortKey,
            source_json: sourceJson(input.source, existing?.source_json ?? null),
            created_at: existing?.created_at ?? now,
            updated_at: existing === undefined ? now : stampAfter(now, existing.updated_at),
          };
          if (existing === undefined) {
            yield* sql`INSERT INTO knowledge_todos ${sql.insert(row)}`;
          } else {
            yield* sql`
              UPDATE knowledge_todos
              SET body = ${row.body}, completed = ${row.completed}, plan_id = ${row.plan_id},
                depends_on_json = ${row.depends_on_json}, sort_key = ${row.sort_key},
                source_json = ${row.source_json}, updated_at = ${row.updated_at}
              WHERE id = ${row.id}
            `;
            if (moved) yield* removeDependents(row.project_id, row.id);
          }
          return toTodo(row);
        }),
      )
      .pipe(Effect.mapError(storageError("save the todo")));
  });

  const newPlanPath = Effect.fnUntraced(function* (projectId: ProjectId, title: string) {
    const directory = projectPlansDir(projectId);
    yield* fs.makeDirectory(directory, { recursive: true });
    const slug = planFileSlug(title);
    for (let suffix = 1; ; suffix += 1) {
      const candidate = path.join(directory, `${suffix === 1 ? slug : `${slug}-${suffix}`}.md`);
      if (!(yield* fs.exists(candidate))) return candidate;
    }
  });

  const savePlan = Effect.fn("KnowledgeStore.savePlan")(function* (input: KnowledgeSavePlanInput) {
    const now = yield* nowIso;
    if (input.id === undefined) {
      if (input.title === undefined) {
        return yield* new KnowledgeInvalidError({ message: "A new plan needs a title." });
      }
      const title = input.title;
      const filePath = yield* newPlanPath(input.projectId, title).pipe(
        Effect.tap((file) => fs.writeFileString(file, input.markdown ?? `# ${title}\n`)),
        Effect.mapError(storageError("write the plan file")),
      );
      const row: PlanRow = {
        id: yield* newId,
        project_id: input.projectId,
        title,
        path: filePath,
        thread_id: input.threadId ?? null,
        created_at: now,
        updated_at: Option.getOrElse(yield* fileModifiedAt(filePath), () => now),
      };
      yield* sql`INSERT INTO knowledge_plans ${sql.insert(row)}`.pipe(
        Effect.mapError(storageError("save the plan")),
      );
      return yield* toPlan(row);
    }
    const existing = yield* findPlan(input.id, input.projectId);
    const current = yield* toPlan(existing);
    yield* checkExpected("plan", existing.id, current.updatedAt, input.expectedUpdatedAt);
    const row: PlanRow = {
      ...existing,
      title: input.title ?? existing.title,
      thread_id: input.threadId === undefined ? existing.thread_id : input.threadId,
      updated_at: stampAfter(now, current.updatedAt),
    };
    yield* sql`
      UPDATE knowledge_plans
      SET title = ${row.title}, thread_id = ${row.thread_id}, updated_at = ${row.updated_at}
      WHERE id = ${row.id}
    `.pipe(Effect.mapError(storageError("save the plan")));
    return yield* toPlan(row);
  });

  const save: KnowledgeStore["Service"]["save"] = Effect.fn("KnowledgeStore.save")(
    function* (input) {
      const result: KnowledgeSaveResult =
        input.kind === "note"
          ? { kind: "note", note: yield* saveNote(input) }
          : input.kind === "todo"
            ? { kind: "todo", todo: yield* saveTodo(input) }
            : { kind: "plan", plan: yield* savePlan(input) };
      yield* notifyChanged;
      return result;
    },
  );

  const deleteItem: KnowledgeStore["Service"]["delete"] = Effect.fn("KnowledgeStore.delete")(
    function* (input) {
      if (input.kind === "note") {
        yield* findNote(input.id);
        yield* sql`DELETE FROM knowledge_notes WHERE id = ${input.id}`.pipe(
          Effect.mapError(storageError("delete the note")),
        );
      } else if (input.kind === "todo") {
        const todo = yield* findTodo(input.id);
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM knowledge_todos WHERE id = ${todo.id}`;
              yield* removeDependents(todo.project_id, todo.id);
            }),
          )
          .pipe(Effect.mapError(storageError("delete the todo")));
      } else {
        const plan = yield* findPlan(input.id);
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM knowledge_plans WHERE id = ${plan.id}`;
              yield* sql`UPDATE knowledge_todos SET plan_id = NULL WHERE plan_id = ${plan.id}`;
            }),
          )
          .pipe(Effect.mapError(storageError("delete the plan")));
        yield* fs.remove(plan.path, { force: true }).pipe(Effect.ignore);
      }
      yield* notifyChanged;
    },
  );

  const readPlan: KnowledgeStore["Service"]["readPlan"] = Effect.fn("KnowledgeStore.readPlan")(
    function* (input) {
      const row = yield* findPlan(input.id);
      // A plan file deleted on disk reads as empty; saving writes it again.
      const markdown = yield* fs.readFileString(row.path).pipe(Effect.orElseSucceed(() => ""));
      return { plan: yield* toPlan(row), markdown };
    },
  );

  const writePlan: KnowledgeStore["Service"]["writePlan"] = Effect.fn("KnowledgeStore.writePlan")(
    function* (input) {
      const existing = yield* findPlan(input.id);
      const current = yield* toPlan(existing);
      yield* checkExpected("plan", existing.id, current.updatedAt, input.expectedUpdatedAt);
      yield* fs
        .makeDirectory(path.dirname(existing.path), { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(existing.path, input.markdown)),
          Effect.mapError(storageError("write the plan file")),
        );
      const written = Option.getOrElse(yield* fileModifiedAt(existing.path), () => "");
      const row: PlanRow = {
        ...existing,
        updated_at: later(stampAfter(yield* nowIso, current.updatedAt), written),
      };
      yield* sql`
        UPDATE knowledge_plans SET updated_at = ${row.updated_at} WHERE id = ${row.id}
      `.pipe(Effect.mapError(storageError("save the plan")));
      yield* notifyChanged;
      return { plan: yield* toPlan(row), markdown: input.markdown };
    },
  );

  return KnowledgeStore.of({ list, subscribe, save, delete: deleteItem, readPlan, writePlan });
});

export const layerAt = (paths: KnowledgePaths) => Layer.effect(KnowledgeStore, make(paths));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const forkDir = path.join(stateDir, "fork");
    return layerAt({
      dbPath: path.join(forkDir, "knowledge.sqlite"),
      plansDir: path.join(forkDir, "plans"),
    });
  }),
);
