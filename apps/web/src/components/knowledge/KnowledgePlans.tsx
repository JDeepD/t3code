import {
  KNOWLEDGE_PLAN_TITLE_MAX_CHARS,
  type KnowledgePlan,
  type KnowledgePlanId,
} from "@t3tools/contracts";
import { FileTextIcon, LinkIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import type { KnowledgeTabProps } from "./knowledgeActions";

export function KnowledgePlans(
  props: {
    readonly plans: ReadonlyArray<KnowledgePlan>;
    readonly onOpenPlan: (id: KnowledgePlanId) => void;
  } & KnowledgeTabProps,
) {
  const { plans, commands, projectId, onOpenPlan } = props;
  const [title, setTitle] = useState("");
  const create = async () => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    const result = await commands.save({ kind: "plan", projectId, title: trimmed });
    if (result._tag !== "Success") return;
    setTitle("");
    if (result.value.kind === "plan") onOpenPlan(result.value.plan.id);
  };
  return (
    <ScrollArea scrollFade className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-2">
        {props.canEdit ? (
          <Input
            size="sm"
            placeholder="Name a new plan and press Enter"
            aria-label="New plan title"
            maxLength={KNOWLEDGE_PLAN_TITLE_MAX_CHARS}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
        ) : null}
        {plans.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {props.filtered
              ? "No plans match your search."
              : "No plans yet. A plan is a markdown file agents can read and edit."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {plans.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
                  onClick={() => onOpenPlan(plan.id)}
                >
                  <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{plan.title}</span>
                  {plan.threadId === props.threadRef.threadId ? (
                    <LinkIcon
                      aria-label="Linked to this thread"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
}
