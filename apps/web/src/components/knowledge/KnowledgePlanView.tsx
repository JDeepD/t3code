import {
  KNOWLEDGE_PLAN_MAX_CHARS,
  type KnowledgePlan,
  type MagicPromptTemplate,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  CopyIcon,
  HammerIcon,
  LinkIcon,
  PencilRulerIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DraftId } from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { knowledgeEnvironment } from "~/state/knowledge";
import { useEnvironmentQuery } from "~/state/query";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { implementPlanPrompt, improvePlanPrompt } from "./knowledge.logic";
import { insertMagicPrompt, type KnowledgeCommands } from "./knowledgeActions";
import { KnowledgeIconAction } from "./KnowledgeIconAction";

/** One plan: its markdown file rendered, with an editor that will not overwrite a newer copy. */
export function KnowledgePlanView(props: {
  /** From the live snapshot, so its `updatedAt` moves when the file changes on disk. */
  readonly plan: KnowledgePlan;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly canEdit: boolean;
  readonly commands: KnowledgeCommands;
  readonly templates: ReadonlyArray<MagicPromptTemplate>;
  readonly onBack: () => void;
}) {
  const { plan, commands, threadRef } = props;
  const document = useEnvironmentQuery(
    knowledgeEnvironment.readPlan({
      environmentId: threadRef.environmentId,
      input: { id: plan.id },
    }),
  );
  const loaded = document.data;
  const outdated = loaded !== null && plan.updatedAt > loaded.plan.updatedAt;
  const refresh = document.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the file changed on the server, so the loaded copy is re-read
  useEffect(() => {
    if (outdated) refresh();
  }, [outdated, refresh]);

  // The copy being edited: its text and the version it started from.
  const [draft, setDraft] = useState<{ markdown: string; base: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const changedElsewhere = draft !== null && plan.updatedAt !== draft.base;
  const linked = plan.threadId === threadRef.threadId;

  const save = async (base: string) => {
    if (draft === null || saving) return;
    setSaving(true);
    const result = await commands.writePlan({
      id: plan.id,
      markdown: draft.markdown,
      expectedUpdatedAt: base,
    });
    setSaving(false);
    if (result._tag === "Success") setDraft(null);
  };
  const planValues = { plan_path: plan.path, plan_title: plan.title };
  const setLink = (threadId: ScopedThreadRef["threadId"] | null) =>
    commands.save({ kind: "plan", id: plan.id, projectId: plan.projectId, threadId });
  const implement = () => {
    if (props.canEdit && !linked) void setLink(threadRef.threadId);
    insertMagicPrompt(
      props.composerDraftTarget,
      props.templates,
      "plan.implement",
      planValues,
      implementPlanPrompt(plan),
    );
  };
  const remove = async () => {
    const confirmed = await readLocalApi()?.dialogs.confirm(
      `Delete the plan "${plan.title}"? Its file is deleted too.`,
    );
    if (confirmed !== true) return;
    const result = await commands.remove({ kind: "plan", id: plan.id });
    if (result._tag === "Success") props.onBack();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b border-border/60 p-2">
        <KnowledgeIconAction label="Back to plans" onClick={props.onBack}>
          <ArrowLeftIcon className="size-3.5" />
        </KnowledgeIconAction>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{plan.title}</h2>
        <KnowledgeIconAction
          label="Improve plan"
          onClick={() =>
            insertMagicPrompt(
              props.composerDraftTarget,
              props.templates,
              "plan.improve",
              planValues,
              improvePlanPrompt(plan),
            )
          }
        >
          <PencilRulerIcon className="size-3" />
        </KnowledgeIconAction>
        <KnowledgeIconAction label="Implement plan" onClick={implement}>
          <HammerIcon className="size-3" />
        </KnowledgeIconAction>
        {props.canEdit ? (
          <KnowledgeIconAction
            label={linked ? "Unlink from this thread" : "Link to this thread"}
            onClick={() => void setLink(linked ? null : threadRef.threadId)}
          >
            {linked ? <UnlinkIcon className="size-3" /> : <LinkIcon className="size-3" />}
          </KnowledgeIconAction>
        ) : null}
        <KnowledgeIconAction
          label="Copy file path"
          onClick={() => void writeTextToClipboard(plan.path)}
        >
          <CopyIcon className="size-3" />
        </KnowledgeIconAction>
        {props.canEdit ? (
          <KnowledgeIconAction label="Delete plan" destructive onClick={() => void remove()}>
            <Trash2Icon className="size-3" />
          </KnowledgeIconAction>
        ) : null}
      </header>
      <p className="truncate border-b border-border/60 px-2.5 py-1 font-mono text-2xs text-muted-foreground">
        {plan.path}
      </p>
      {draft === null ? (
        <>
          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="p-3 text-sm">
              {loaded === null ? (
                <p className="text-xs text-muted-foreground">{document.error ?? "Loading…"}</p>
              ) : loaded.markdown.trim() === "" ? (
                <p className="text-xs text-muted-foreground">This plan is empty.</p>
              ) : (
                <ChatMarkdown text={loaded.markdown} cwd={undefined} headingLevelOffset={2} />
              )}
            </div>
          </ScrollArea>
          {props.canEdit && loaded !== null ? (
            <footer className="flex justify-end border-t border-border/60 p-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setDraft({ markdown: loaded.markdown, base: loaded.plan.updatedAt })}
              >
                Edit
              </Button>
            </footer>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
            <Textarea
              aria-label="Plan markdown"
              rows={16}
              maxLength={KNOWLEDGE_PLAN_MAX_CHARS}
              value={draft.markdown}
              onChange={(event) => setDraft({ ...draft, markdown: event.target.value })}
            />
          </div>
          <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 p-2">
            {changedElsewhere ? (
              <span className="mr-auto text-xs text-warning">
                This plan changed on disk while you were editing.
              </span>
            ) : null}
            <Button type="button" size="xs" variant="ghost" onClick={() => setDraft(null)}>
              {changedElsewhere ? "Discard mine" : "Cancel"}
            </Button>
            <Button
              type="button"
              size="xs"
              variant={changedElsewhere ? "warning-outline" : "outline"}
              disabled={saving}
              onClick={() => void save(changedElsewhere ? plan.updatedAt : draft.base)}
            >
              {changedElsewhere ? "Overwrite" : "Save"}
            </Button>
          </footer>
        </>
      )}
    </div>
  );
}
