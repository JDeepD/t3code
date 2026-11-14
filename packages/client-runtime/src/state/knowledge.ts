// Fork feature: per-project notes, todos and plans. See FORK.md.
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createKnowledgeEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** One project's notes, todos and plans, re-sent whole after each change. */
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:knowledge:live",
      tag: WS_METHODS.knowledgeSubscribe,
    }),
    readPlan: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:knowledge:read-plan",
      tag: WS_METHODS.knowledgeReadPlan,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge:save",
      tag: WS_METHODS.knowledgeSave,
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge:delete",
      tag: WS_METHODS.knowledgeDelete,
    }),
    writePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge:write-plan",
      tag: WS_METHODS.knowledgeWritePlan,
    }),
  };
}
