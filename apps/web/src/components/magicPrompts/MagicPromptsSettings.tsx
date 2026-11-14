import {
  MAGIC_PROMPT_INSTRUCTIONS_MAX_CHARS,
  MAGIC_PROMPT_VISIBLE_MAX_CHARS,
  MagicPromptId,
  type MagicPromptTemplate,
  unknownMagicPromptPlaceholders,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";
import { useServerConfigs } from "~/state/entities";
import { magicPromptEnvironment } from "~/state/magicPrompts";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsUnavailableGroup,
} from "../settings/settingsLayout";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { searchableSetting } from "../settings/settingsSearch";
import { useScopedSettingsWriteAllowed } from "../settings/useScopedSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";

const GROUPS = [
  { id: "git", title: "Git" },
  { id: "planning", title: "Planning" },
  { id: "session", title: "Session" },
] as const;

const isMagicPromptId = Schema.is(MagicPromptId);

type ScopeKind = "global" | "project";

function sourceLabel(source: MagicPromptTemplate["source"], scope: ScopeKind): string {
  if (source === "project") return "Project override";
  if (source === "global") return scope === "project" ? "Inherited from global" : "Global override";
  return "Using built-in default";
}

function placeholderList(names: ReadonlyArray<string>): string {
  return names.length === 0
    ? "This template takes no placeholders."
    : `Placeholders: ${names.map((name) => `{{${name}}}`).join(", ")}`;
}

function MagicPromptEditor(props: {
  readonly template: MagicPromptTemplate;
  readonly disabled: boolean;
  readonly onSave: (visible: string, instructions: string) => Promise<boolean>;
}) {
  const { template } = props;
  const [visible, setVisible] = useState(template.visible);
  const [instructions, setInstructions] = useState(template.instructions);
  const [saving, setSaving] = useState(false);
  const unknown = unknownMagicPromptPlaceholders(
    `${visible}\n${instructions}`,
    template.placeholders,
  );
  const changed = visible !== template.visible || instructions !== template.instructions;
  const save = async () => {
    setSaving(true);
    await props.onSave(visible, instructions);
    setSaving(false);
  };
  return (
    <div className="mt-3 flex max-w-2xl flex-col gap-3 pb-3.5">
      {template.hasVisiblePrompt ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`magic-visible-${template.id}`}>Visible prompt</Label>
          <Textarea
            id={`magic-visible-${template.id}`}
            rows={3}
            maxLength={MAGIC_PROMPT_VISIBLE_MAX_CHARS}
            disabled={props.disabled}
            value={visible}
            onChange={(event) => setVisible(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Sent as your message.{" "}
            {template.command === undefined ? null : `Type /${template.command} in the composer. `}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`magic-instructions-${template.id}`}>Instructions</Label>
        <Textarea
          id={`magic-instructions-${template.id}`}
          rows={6}
          maxLength={MAGIC_PROMPT_INSTRUCTIONS_MAX_CHARS}
          disabled={props.disabled}
          placeholder={template.hasVisiblePrompt ? undefined : "No extra instructions."}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {template.hasVisiblePrompt
            ? "Sent to the agent with the message, behind an instructions chip."
            : "Added to the request that writes the text."}{" "}
          {placeholderList(template.placeholders)}
        </p>
      </div>
      {unknown.length > 0 ? (
        <p className="text-xs text-warning">
          {unknown.map((name) => `{{${name}}}`).join(", ")}{" "}
          {unknown.length === 1 ? "is not a placeholder" : "are not placeholders"} this template
          fills. {unknown.length === 1 ? "It" : "They"} will be sent as written.
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.disabled || !changed || saving}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** Settings → Magic prompts. The page's scope picker chooses global or one project. */
export function MagicPromptsSettingsPanel() {
  const { target, targets } = useSettingsScope();
  const configs = useServerConfigs();
  const writeAllowed = useScopedSettingsWriteAllowed();
  const supports = (environmentId: NonNullable<typeof target>["environmentId"]) =>
    configs.get(environmentId)?.environment.capabilities.magicPrompts === true;
  const readable = target !== null && supports(target.environmentId) ? target : null;
  const scope: ScopeKind = readable?.projectId == null ? "global" : "project";
  const query = useEnvironmentQuery(
    readable === null
      ? null
      : magicPromptEnvironment.list({
          environmentId: readable.environmentId,
          input: readable.projectId === null ? {} : { projectId: readable.projectId },
        }),
  );
  const save = useAtomCommand(magicPromptEnvironment.save, { reportFailure: false });
  const reset = useAtomCommand(magicPromptEnvironment.reset, { reportFailure: false });
  const [openId, setOpenId] = useState<string | null>(null);

  if (readable === null) {
    return (
      <SettingsPageContainer>
        <SettingsUnavailableGroup message="This environment's server does not have magic prompts.">
          {null}
        </SettingsUnavailableGroup>
      </SettingsPageContainer>
    );
  }

  // One project can be checked out on several machines; each keeps its own copy.
  const writeTargets = targets.filter((candidate) => supports(candidate.environmentId));
  const applyToTargets = async (
    title: string,
    run: (candidate: (typeof writeTargets)[number]) => Promise<{ readonly _tag: string }>,
  ) => {
    const results = await Promise.all(writeTargets.map(run));
    const failed = results.some((result) => result._tag !== "Success");
    if (failed) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: "The server did not accept the change. Check that you can edit settings.",
        }),
      );
    }
    return !failed;
  };
  const templates = query.data?.templates ?? [];

  return (
    <SettingsPageContainer>
      <div id={searchableSetting("magic-prompts").id}>
        <p className="text-sm text-muted-foreground">
          Reusable prompts for Git, planning and session commands. Each has the message you send and
          instructions only the agent reads.{" "}
          {scope === "project"
            ? "Changes here apply to this project and win over the global text."
            : "Changes here apply to every project that has no override of its own."}
        </p>
      </div>
      {query.data === null && query.error !== null ? (
        <SettingsUnavailableGroup message={query.error}>{null}</SettingsUnavailableGroup>
      ) : null}
      {GROUPS.map((group) => {
        const groupTemplates = templates.filter((template) => template.group === group.id);
        if (groupTemplates.length === 0) return null;
        return (
          <SettingsSection key={group.id} title={group.title}>
            {groupTemplates.map((template) => {
              const { id } = template;
              const open = openId === id;
              const overriddenHere = template.source === scope;
              return (
                <SettingsRow
                  key={id}
                  title={template.title}
                  description={template.description}
                  status={
                    <Badge variant={overriddenHere ? "info" : "outline"} size="sm">
                      {sourceLabel(template.source, scope)}
                    </Badge>
                  }
                  resetAction={
                    overriddenHere && writeAllowed && isMagicPromptId(id) ? (
                      <SettingResetButton
                        label={`${template.title} magic prompt`}
                        tooltip={
                          scope === "project" ? "Reset to the global text" : "Reset to default"
                        }
                        onClick={() =>
                          void applyToTargets("Could not reset the magic prompt", (candidate) =>
                            reset({
                              environmentId: candidate.environmentId,
                              input: {
                                id,
                                scope,
                                ...(candidate.projectId === null
                                  ? {}
                                  : { projectId: candidate.projectId }),
                              },
                            }),
                          )
                        }
                      />
                    ) : null
                  }
                  control={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : id)}
                    >
                      {open ? "Close" : writeAllowed ? "Edit" : "View"}
                    </Button>
                  }
                >
                  {open ? (
                    <MagicPromptEditor
                      // Remount on scope, reset or save so the fields show the stored text.
                      key={`${readable.environmentId}:${readable.projectId}:${template.source}:${template.visible}:${template.instructions}`}
                      template={template}
                      disabled={!writeAllowed || !isMagicPromptId(id)}
                      onSave={(visible, instructions) =>
                        isMagicPromptId(id)
                          ? applyToTargets("Could not save the magic prompt", (candidate) =>
                              save({
                                environmentId: candidate.environmentId,
                                input: {
                                  id,
                                  scope,
                                  ...(candidate.projectId === null
                                    ? {}
                                    : { projectId: candidate.projectId }),
                                  ...(template.hasVisiblePrompt ? { visible } : {}),
                                  instructions,
                                },
                              }),
                            )
                          : Promise.resolve(false)
                      }
                    />
                  ) : null}
                </SettingsRow>
              );
            })}
          </SettingsSection>
        );
      })}
    </SettingsPageContainer>
  );
}
