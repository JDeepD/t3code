import { createFileRoute } from "@tanstack/react-router";
import { MagicPromptsSettingsPanel } from "../components/magicPrompts/MagicPromptsSettings";

export const Route = createFileRoute("/_chat/settings/magic-prompts")({
  component: MagicPromptsSettingsPanel,
});
