// The fork's own SQLite file. Fork features keep their tables here, with their own schema
// version, so nothing is added to the upstream migration chain. See FORK.md.
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";

export class ForkDatabaseOpenError extends Schema.TaggedError<ForkDatabaseOpenError>()(
  "ForkDatabaseOpenError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not open the fork database at ${this.path}.`;
  }
}

export class ForkDatabase extends Context.Service<
  ForkDatabase,
  {
    /** A private client: the server's `SqlClient` service is the upstream database. */
    readonly sql: SqlClient.SqlClient;
    /** The folder holding the database, for fork files kept beside it. */
    readonly directory: string;
  }
>()("t3/fork/ForkDatabase") {}

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
  [
    // project_id is '' for the global override, so one primary key covers both scopes.
    `CREATE TABLE magic_prompt_overrides (
      template_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      visible TEXT,
      instructions TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (template_id, project_id)
    )`,
  ],
];

const make = Effect.fn("ForkDatabase.make")(function* (dbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(dbPath);
  const openError = (cause: unknown) => new ForkDatabaseOpenError({ path: dbPath, cause });

  yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(openError));
  const sql = Context.get(
    yield* Layer.build(NodeSqliteClient.layer({ filename: dbPath })).pipe(
      Effect.mapError(openError),
    ),
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
  }).pipe(Effect.mapError(openError));

  return ForkDatabase.of({ sql, directory });
});

export const layerAt = (dbPath: string) => Layer.effect(ForkDatabase, make(dbPath));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(stateDir, "fork", "fork.sqlite"));
  }),
);
