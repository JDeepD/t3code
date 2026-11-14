import {
  KNOWLEDGE_TODO_MAX_CHARS,
  type KnowledgePlan,
  type KnowledgeTodo,
} from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderInputIcon,
  LightbulbIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { groupTodosByPlan, planThisPrompt, sortKeyForMove } from "./knowledge.logic";
import { insertMagicPrompt, type KnowledgeTabProps } from "./knowledgeActions";
import { KnowledgeIconAction } from "./KnowledgeIconAction";

function TodoRow(
  props: {
    readonly todo: KnowledgeTodo;
    /** The todo's group in display order, for moving it up and down. */
    readonly siblings: ReadonlyArray<KnowledgeTodo>;
    readonly plans: ReadonlyArray<KnowledgePlan>;
  } & KnowledgeTabProps,
) {
  const { todo, commands, canEdit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const patch = (fields: Partial<Pick<KnowledgeTodo, "body" | "completed" | "sortKey">>) =>
    commands.save({ kind: "todo", id: todo.id, projectId: todo.projectId, ...fields });
  const move = (direction: "up" | "down") => {
    const sortKey = sortKeyForMove(props.siblings, todo.id, direction);
    if (sortKey !== null) void patch({ sortKey });
  };
  const commitDraft = async () => {
    const body = draft?.trim() ?? "";
    if (body === "" || body === todo.body) return setDraft(null);
    const result = await commands.save({
      kind: "todo",
      id: todo.id,
      projectId: todo.projectId,
      body,
      expectedUpdatedAt: todo.updatedAt,
    });
    if (result._tag === "Success") setDraft(null);
  };
  const index = props.siblings.findIndex((sibling) => sibling.id === todo.id);
  return (
    <li className="group/todo flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40">
      <Checkbox
        className="mt-0.5"
        aria-label={todo.completed ? "Mark as not done" : "Mark as done"}
        checked={todo.completed}
        disabled={!canEdit}
        onCheckedChange={(checked) => void patch({ completed: checked === true })}
      />
      {draft === null ? (
        <button
          type="button"
          disabled={!canEdit}
          className={
            todo.completed
              ? "min-w-0 flex-1 text-left text-sm wrap-anywhere text-muted-foreground line-through"
              : "min-w-0 flex-1 text-left text-sm wrap-anywhere"
          }
          onClick={() => setDraft(todo.body)}
        >
          {todo.body}
        </button>
      ) : (
        <Input
          size="sm"
          className="min-w-0 flex-1"
          aria-label="Todo text"
          autoFocus
          maxLength={KNOWLEDGE_TODO_MAX_CHARS}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitDraft()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitDraft();
            if (event.key === "Escape") setDraft(null);
          }}
        />
      )}
      <div className="flex shrink-0 items-center opacity-0 group-focus-within/todo:opacity-100 group-hover/todo:opacity-100 pointer-coarse:opacity-100">
        <KnowledgeIconAction
          label="Plan this"
          onClick={() =>
            insertMagicPrompt(
              props.composerDraftTarget,
              props.templates,
              "plan.todo",
              { todo_text: todo.body },
              planThisPrompt(todo.body),
            )
          }
        >
          <LightbulbIcon className="size-3" />
        </KnowledgeIconAction>
        {canEdit ? (
          <>
            <KnowledgeIconAction label="Move up" disabled={index <= 0} onClick={() => move("up")}>
              <ArrowUpIcon className="size-3" />
            </KnowledgeIconAction>
            <KnowledgeIconAction
              label="Move down"
              disabled={index === props.siblings.length - 1}
              onClick={() => move("down")}
            >
              <ArrowDownIcon className="size-3" />
            </KnowledgeIconAction>
            {props.plans.length > 0 ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="Move to a plan"
                    />
                  }
                >
                  <FolderInputIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end">
                  {todo.planId !== undefined ? (
                    <MenuItem
                      onClick={() =>
                        void commands.save({
                          kind: "todo",
                          id: todo.id,
                          projectId: todo.projectId,
                          planId: null,
                        })
                      }
                    >
                      No plan
                    </MenuItem>
                  ) : null}
                  {props.plans
                    .filter((plan) => plan.id !== todo.planId)
                    .map((plan) => (
                      <MenuItem
                        key={plan.id}
                        onClick={() =>
                          void commands.save({
                            kind: "todo",
                            id: todo.id,
                            projectId: todo.projectId,
                            planId: plan.id,
                          })
                        }
                      >
                        {plan.title}
                      </MenuItem>
                    ))}
                </MenuPopup>
              </Menu>
            ) : null}
            <KnowledgeIconAction
              label="Delete"
              destructive
              onClick={() => void commands.remove({ kind: "todo", id: todo.id })}
            >
              <Trash2Icon className="size-3" />
            </KnowledgeIconAction>
          </>
        ) : null}
      </div>
    </li>
  );
}

export function KnowledgeTodos(
  props: {
    readonly todos: ReadonlyArray<KnowledgeTodo>;
    readonly plans: ReadonlyArray<KnowledgePlan>;
  } & KnowledgeTabProps,
) {
  const { todos, plans, ...shared } = props;
  const [draft, setDraft] = useState("");
  const add = async () => {
    const body = draft.trim();
    if (body === "") return;
    const result = await shared.commands.save({ kind: "todo", projectId: shared.projectId, body });
    if (result._tag === "Success") setDraft("");
  };
  const groups = groupTodosByPlan(todos, plans);
  return (
    <ScrollArea scrollFade className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-2">
        {shared.canEdit ? (
          <Input
            size="sm"
            placeholder="Add a todo and press Enter"
            aria-label="New todo"
            maxLength={KNOWLEDGE_TODO_MAX_CHARS}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void add();
            }}
          />
        ) : null}
        {groups.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {shared.filtered ? "No todos match your search." : "No todos yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.plan?.id ?? "no-plan"}>
              {group.plan ? (
                <h3 className="truncate px-1.5 pt-1 pb-0.5 text-2xs font-medium text-muted-foreground">
                  {group.plan.title}
                </h3>
              ) : null}
              <ul className="flex flex-col">
                {group.todos.map((todo) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    siblings={group.todos}
                    plans={plans}
                    {...shared}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
