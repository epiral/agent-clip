import { useState, useCallback } from "react";
import type { Agent } from "../../lib/types";
import type { AgentPickerState, AgentPickerActions } from "./types";

export function useAgentPicker(agents: Agent[]): AgentPickerState & AgentPickerActions {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedAgentId(prev => prev === id ? null : id);
  }, []);

  const deselect = useCallback(() => {
    setSelectedAgentId(null);
  }, []);

  return {
    agents,
    selectedAgentId,
    loading: false,
    select,
    deselect,
  };
}
