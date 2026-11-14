import { ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ForkDatabase from "../fork/ForkDatabase.ts";
import * as MagicPromptStore from "./MagicPromptStore.ts";

const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");

const layerStore = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-magic-prompts-" });
    return MagicPromptStore.layer.pipe(
      Layer.provide(ForkDatabase.layerAt(path.join(dir, "fork.sqlite"))),
    );
  }),
);

const withStore = <A, E, R>(
  use: (store: MagicPromptStore.MagicPromptStore["Service"]) => Effect.Effect<A, E, R>,
) => MagicPromptStore.MagicPromptStore.pipe(Effect.flatMap(use), Effect.provide(layerStore));

it.layer(NodeServices.layer)("MagicPromptStore", (it) => {
  it.effect("resolves built-in, then global, then project text, and reset restores it", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const template = (projectId?: ProjectId) =>
          store.list(projectId === undefined ? {} : { projectId }).pipe(
            Effect.map(({ templates }) => {
              const found = templates.find((candidate) => candidate.id === "session.debug");
              return [found?.source, found?.visible, found?.instructions.slice(0, 12)];
            }),
          );
        const builtin = yield* template(projectA);
        assert.strictEqual(builtin[0], "builtin");

        yield* store.save({ id: "session.debug", scope: "global", visible: "global {{problem}}" });
        assert.deepStrictEqual(yield* template(), ["global", "global {{problem}}", builtin[2]]);
        assert.deepStrictEqual(yield* template(projectA), [
          "global",
          "global {{problem}}",
          builtin[2],
        ]);

        yield* store.save({
          id: "session.debug",
          scope: "project",
          projectId: projectA,
          instructions: "project only",
        });
        // The project overrides the instructions and still inherits the global visible text.
        assert.deepStrictEqual(yield* template(projectA), [
          "project",
          "global {{problem}}",
          "project only",
        ]);
        assert.strictEqual((yield* template(projectB))[0], "global");

        yield* store.reset({ id: "session.debug", scope: "project", projectId: projectA });
        assert.strictEqual((yield* template(projectA))[0], "global");
        yield* store.reset({ id: "session.debug", scope: "global" });
        assert.deepStrictEqual(yield* template(projectA), builtin);

        const noProject = yield* Effect.flip(store.save({ id: "git.pr", scope: "project" }));
        assert.strictEqual(noProject._tag, "MagicPromptError");
      }),
    ),
  );

  it.effect("renders git instructions with placeholders, and nothing while unedited", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const values = { branch: "feature/x", base: "main" };
        assert.strictEqual(yield* store.renderInstructions("git.pr", projectA, values), "");
        yield* store.save({
          id: "git.pr",
          scope: "global",
          instructions: "Target {{base}} from {{branch}}. Keep {{unknown}}.",
        });
        assert.strictEqual(
          yield* store.renderInstructions("git.pr", null, values),
          "Target main from feature/x. Keep {{unknown}}.",
        );
      }),
    ),
  );
});
