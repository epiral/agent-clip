import { useAgentPicker } from "./useAgentPicker";
import { AgentPickerView } from "./AgentPickerView";
import type { Agent } from "../../lib/types";

interface AgentPickerProps {
  agents: Agent[];
  onCreate: () => void;
  onSendWithAgent: (agentId: string | null) => void;
}

export function AgentPicker({ agents, onCreate, onSendWithAgent }: AgentPickerProps) {
  const bag = useAgentPicker(agents);
  return <AgentPickerView {...bag} onCreate={onCreate} />;
}

export { useAgentPicker } from "./useAgentPicker";
export type { AgentPickerState, AgentPickerActions } from "./types";
