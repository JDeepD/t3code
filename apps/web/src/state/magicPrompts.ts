import { createMagicPromptEnvironmentAtoms } from "@t3tools/client-runtime/state/magicPrompts";

import { connectionAtomRuntime } from "../connection/runtime";

export const magicPromptEnvironment = createMagicPromptEnvironmentAtoms(connectionAtomRuntime);
