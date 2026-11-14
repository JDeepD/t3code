import type { EnvironmentId, MagicPromptTemplate, ProjectId } from "@t3tools/contracts";
import { useServerConfigs } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { magicPromptEnvironment } from "~/state/magicPrompts";
import { useEnvironmentQuery } from "~/state/query";

const NO_TEMPLATES: ReadonlyArray<MagicPromptTemplate> = [];

/** Whether any connected environment serves magic prompts. False on upstream servers. */
export function useMagicPromptsOffered(): boolean {
  const { environments } = useEnvironments();
  return environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.magicPrompts === true,
  );
}

/** The templates as they apply to the project, or none where the server has no magic prompts. */
export function useMagicPromptTemplates(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ReadonlyArray<MagicPromptTemplate> {
  const configs = useServerConfigs();
  const supported =
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.magicPrompts === true;
  const query = useEnvironmentQuery(
    supported && environmentId !== null
      ? magicPromptEnvironment.list({
          environmentId,
          input: projectId === null ? {} : { projectId },
        })
      : null,
  );
  return query.data?.templates ?? NO_TEMPLATES;
}
