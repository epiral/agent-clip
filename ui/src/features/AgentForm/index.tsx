import { AgentFormView } from "./AgentFormView";
import type { AgentFormProps } from "./types";

export function AgentForm(props: AgentFormProps) {
  return <AgentFormView {...props} />;
}

export type { AgentFormProps } from "./types";
