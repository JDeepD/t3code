// Fork feature: editable prompt templates. See FORK.md.
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createMagicPromptEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  /** The templates as they apply to `projectId`, or globally without one. */
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:magic-prompts:list",
    tag: WS_METHODS.magicPromptsList,
    staleTimeMs: 30_000,
  });
  return {
    list,
    // A global edit changes what every project inherits, so each open list re-reads on its own.
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:magic-prompts:save",
      tag: WS_METHODS.magicPromptsSave,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            list({
              environmentId,
              input: input.projectId === undefined ? {} : { projectId: input.projectId },
            }),
          ),
        ),
    }),
    reset: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:magic-prompts:reset",
      tag: WS_METHODS.magicPromptsReset,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            list({
              environmentId,
              input: input.projectId === undefined ? {} : { projectId: input.projectId },
            }),
          ),
        ),
    }),
  };
}
