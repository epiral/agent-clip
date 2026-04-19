import type { Agent } from "../../lib/types";

export interface AgentPickerState {
  agents: Agent[];
  selectedAgentId: string | null;
  loading: boolean;
}

export interface AgentPickerActions {
  select: (id: string | null) => void;
  deselect: () => void;
}
