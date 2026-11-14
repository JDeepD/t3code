import type { KnowledgePlanId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { NotebookPenIcon } from "lucide-react";
import { useState } from "react";
import type { DraftId } from "~/composerDraftStore";
import { useServerConfigs, useThreadShell } from "~/state/entities";
import { knowledgeEnvironment } from "~/state/knowledge";
import { useEnvironmentQuery } from "~/state/query";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { filterKnowledge, type KnowledgeTab } from "./knowledge.logic";
import { useKnowledgeCommands } from "./knowledgeActions";
import { useMagicPromptTemplates } from "../magicPrompts/useMagicPrompts";
import { KnowledgeNotes } from "./KnowledgeNotes";
import { KnowledgePlanView } from "./KnowledgePlanView";
import { KnowledgePlans } from "./KnowledgePlans";
import { KnowledgeTodos } from "./KnowledgeTodos";

function Unavailable({ title, description }: { title: string; description: string }) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <NotebookPenIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** The project's notes, todos and plans, for the thread's right panel. */
export function KnowledgePanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const { threadRef } = props;
  const supported =
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities.knowledge === true;
  const projectId = useThreadShell(threadRef)?.projectId ?? null;
  const live = useEnvironmentQuery(
    supported && projectId !== null
      ? knowledgeEnvironment.live({ environmentId: threadRef.environmentId, input: { projectId } })
      : null,
  );
  const canEdit = useAtomValue(knowledgeEnvironment.save.permissionAtom(threadRef.environmentId));
  const commands = useKnowledgeCommands(threadRef.environmentId);
  const templates = useMagicPromptTemplates(threadRef.environmentId, projectId);
  const [tab, setTab] = useState<KnowledgeTab>("notes");
  const [query, setQuery] = useState("");
  const [openPlanId, setOpenPlanId] = useState<KnowledgePlanId | null>(null);

  if (!supported) {
    return (
      <Unavailable
        title="Notes are not available here"
        description="This environment's server does not keep notes, todos and plans."
      />
    );
  }
  if (projectId === null) {
    return (
      <Unavailable
        title="No project yet"
        description="Notes, todos and plans belong to a project. Send the first message to start."
      />
    );
  }
  const snapshot = live.data;
  if (snapshot === null) {
    return live.error === null ? null : (
      <Unavailable title="Could not load notes" description={live.error} />
    );
  }

  const openPlan = snapshot.plans.find((plan) => plan.id === openPlanId);
  if (openPlan !== undefined) {
    return (
      <KnowledgePlanView
        key={openPlan.id}
        plan={openPlan}
        threadRef={threadRef}
        composerDraftTarget={props.composerDraftTarget}
        canEdit={canEdit}
        commands={commands}
        templates={templates}
        onBack={() => setOpenPlanId(null)}
      />
    );
  }

  const visible = filterKnowledge(snapshot, query);
  const shared = {
    projectId,
    threadRef,
    composerDraftTarget: props.composerDraftTarget,
    canEdit,
    commands,
    filtered: query.trim() !== "",
    templates,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
        <ToggleGroup
          aria-label="Notes, todos or plans"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "notes" || value === "todos" || value === "plans") setTab(value);
          }}
        >
          <Toggle value="notes">Notes ({visible.notes.length})</Toggle>
          <Toggle value="todos">Todo ({visible.todos.length})</Toggle>
          <Toggle value="plans">Plans ({visible.plans.length})</Toggle>
        </ToggleGroup>
        <Input
          type="search"
          size="sm"
          className="min-w-24 flex-1"
          placeholder="Search"
          aria-label="Search notes, todos and plans"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      {tab === "notes" ? (
        <KnowledgeNotes notes={visible.notes} {...shared} />
      ) : tab === "todos" ? (
        <KnowledgeTodos todos={visible.todos} plans={snapshot.plans} {...shared} />
      ) : (
        <KnowledgePlans plans={visible.plans} onOpenPlan={setOpenPlanId} {...shared} />
      )}
    </div>
  );
}
