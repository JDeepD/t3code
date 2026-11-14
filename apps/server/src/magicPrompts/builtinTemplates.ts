import type { MagicPromptGroup, MagicPromptId } from "@t3tools/contracts";

export interface BuiltinMagicPrompt {
  readonly id: MagicPromptId;
  readonly group: MagicPromptGroup;
  readonly title: string;
  readonly description: string;
  readonly placeholders: ReadonlyArray<string>;
  readonly command?: string;
  /** Null for templates that only add instructions to text T3 Code generates itself. */
  readonly visible: string | null;
  readonly instructions: string;
}

// The Git generation templates start empty so an unedited fork writes the same commits and
// pull requests as upstream.
export const BUILTIN_MAGIC_PROMPTS: ReadonlyArray<BuiltinMagicPrompt> = [
  {
    id: "git.commit",
    group: "git",
    title: "Commit message",
    description:
      "Extra instructions for generated commit messages. They are added after the commit style chosen in the source control settings.",
    placeholders: ["diff_summary"],
    visible: null,
    instructions: "",
  },
  {
    id: "git.pr",
    group: "git",
    title: "Pull request",
    description:
      "Extra instructions for generated pull request titles and descriptions. They are added after the style chosen in the source control settings.",
    placeholders: ["branch", "base"],
    visible: null,
    instructions: "",
  },
  {
    id: "git.conflict",
    group: "git",
    title: "Resolve conflicts",
    description: "Asks the agent to resolve merge or rebase conflicts.",
    placeholders: ["files"],
    command: "resolve-conflicts",
    visible: "Resolve the merge conflicts in this checkout.\n\n{{files}}",
    instructions: [
      "Run `git status` first to see which files are conflicted and whether a merge, rebase or cherry-pick is in progress.",
      "For each conflicted file, read both sides and the surrounding code, and work out what each side intended before editing. Keep both intents where they do not contradict. Never pick one side wholesale to make the markers go away.",
      "Remove every conflict marker, then run the project's type checks or tests for the files you touched.",
      "Stage the resolved files, but do not commit, continue the rebase or push. Finish with a short list of each conflict and how you resolved it, and call out any resolution you are unsure about.",
    ].join("\n"),
  },
  {
    id: "plan.todo",
    group: "planning",
    title: "Plan a todo",
    description: "Turns a todo into a written plan. Used by Plan this on a todo.",
    placeholders: ["todo_text"],
    visible: "Help me plan this todo:\n\n{{todo_text}}",
    instructions: [
      "Do not write code yet.",
      "First read the parts of the codebase this touches. Then ask me the clarifying questions whose answers would change the plan, a few at a time, and wait for my answers.",
      "Next propose a short outline (goal, approach, steps, risks, how to verify) and wait for me to agree or correct it.",
      "Once we agree, write the full plan as markdown with a checklist of small, ordered steps, and tell me where you saved it.",
    ].join("\n"),
  },
  {
    id: "plan.improve",
    group: "planning",
    title: "Improve a plan",
    description: "Reviews and tightens an existing plan file. Used by Improve plan.",
    placeholders: ["plan_path", "plan_title"],
    visible: 'Improve the plan "{{plan_title}}" at `{{plan_path}}`.',
    instructions: [
      "Read the plan file, then check its claims against the code: file paths, function names and assumptions about how things work today.",
      "Look for missing steps, steps in the wrong order, vague steps that hide real decisions, unhandled failure cases and missing verification.",
      "Edit the file in place. Keep the author's structure and intent, keep steps small and checkable, and do not start implementing.",
      "Finish with a short summary of what you changed and any open questions that need my decision.",
    ].join("\n"),
  },
  {
    id: "plan.implement",
    group: "planning",
    title: "Implement a plan",
    description: "Works through a plan file step by step. Used by Implement plan.",
    placeholders: ["plan_path", "plan_title"],
    visible: 'Implement the plan "{{plan_title}}" at `{{plan_path}}`.',
    instructions: [
      "Read the whole plan file before changing anything. If a step is unclear or contradicts the code, ask before guessing.",
      "Work through the steps in order. After each one, run the relevant checks and tick it off in the plan file, adding a note there when you had to deviate.",
      "Stay inside the plan's scope. Record anything else you notice as a follow-up at the end of the plan file instead of doing it.",
      "Finish with what is done, what is left, and the commands you ran with their results.",
    ].join("\n"),
  },
  {
    id: "session.catchup",
    group: "session",
    title: "Catch me up",
    description: "Summarizes where this thread stands for someone returning to it.",
    placeholders: [],
    command: "catch-up",
    visible: "Catch me up on this thread.",
    instructions: [
      "I have been away from this thread. Without doing any new work, tell me in this order: what we set out to do, what is done, what is in progress or half-finished, any decision you are waiting on from me, and the next step you would take.",
      "Be specific about files and commands. Say plainly what you verified and what you only assume. Keep it short enough to read in a minute.",
    ].join("\n"),
  },
  {
    id: "session.summary",
    group: "session",
    title: "Summarize",
    description: "Writes a hand-off summary of the thread.",
    placeholders: [],
    command: "summary",
    visible: "Summarize this thread.",
    instructions: [
      "Write a summary someone could use to continue this work in a new thread with no other context.",
      "Cover the goal, the decisions made and why, the files changed, the commands and checks that were run with their results, known problems, and the remaining work.",
      "Use short sections and lists. Do not do any new work.",
    ].join("\n"),
  },
  {
    id: "session.debug",
    group: "session",
    title: "Debug",
    description: "Investigates a problem methodically before fixing it.",
    placeholders: ["problem"],
    command: "debug",
    visible: "Debug this problem:\n\n{{problem}}",
    instructions: [
      "Do not change code until you can explain the cause.",
      "Reproduce the problem first, or say exactly why you cannot. List the plausible causes, then test them one at a time, starting with the cheapest check, and show the evidence for each.",
      "When you find the cause, explain it in two or three sentences, then propose the smallest fix and a test that would have caught it. Wait for my go-ahead before a fix that touches more than the failing path.",
    ].join("\n"),
  },
  {
    id: "session.weigh",
    group: "session",
    title: "Weigh options",
    description: "Compares approaches to a question and recommends one.",
    placeholders: ["question"],
    command: "weigh",
    visible: "Weigh the options for this:\n\n{{question}}",
    instructions: [
      "Do not change anything. Read the relevant code first so the options fit how this project works.",
      "Give two to four realistic options. For each: what it involves, what it costs, what could go wrong, and what it rules out later.",
      "Then recommend one, say what would change your mind, and name the first step.",
    ].join("\n"),
  },
  {
    id: "session.tour",
    group: "session",
    title: "Tour the code",
    description: "Explains how this project, or the part in question, fits together.",
    placeholders: [],
    command: "tour",
    visible: "Give me a tour of this codebase.",
    instructions: [
      "Do not change anything. If the thread is already about one area, tour that area instead of the whole project.",
      "Start with what the project does and how to run and test it. Then walk the main flow from entry point to output, naming the files and functions at each step. Point out the conventions to follow and the traps a newcomer would hit.",
      "Keep it to what someone needs before making their first change, and link each claim to a file.",
    ].join("\n"),
  },
  {
    id: "session.review",
    group: "session",
    title: "Review changes",
    description: "Reviews the uncommitted or branch changes for real problems.",
    placeholders: [],
    command: "review",
    visible: "Review the changes in this checkout.",
    instructions: [
      "Review the uncommitted changes, or the branch's changes against its base if the working tree is clean. Do not edit files.",
      "Look for bugs first: wrong logic, missed cases, broken callers, race conditions, security problems and missing tests for behavior that can break. Then note needless complexity.",
      "Check each finding against the code before reporting it. List findings most serious first, each with its file and line, what goes wrong, and a suggested fix. Skip style nitpicks. If you find nothing serious, say so.",
    ].join("\n"),
  },
];
