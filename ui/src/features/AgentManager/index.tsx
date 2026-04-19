import { useAgentManager } from "./useAgentManager";
import { AgentManagerView } from "./AgentManagerView";
import type { Agent } from "../../lib/types";

interface AgentManagerProps {
  agents: Agent[];
  onAgentsChange: () => void;
  onSelectAgent?: (agent: Agent) => void;
  availableProviders?: string[];
  availableClips?: string[];
}

export function AgentManager({ agents, onAgentsChange, onSelectAgent, availableProviders, availableClips }: AgentManagerProps) {
  const bag = useAgentManager(agents, onAgentsChange);
  return <AgentManagerView {...bag} onSelectAgent={onSelectAgent} availableProviders={availableProviders} availableClips={availableClips} />;
}

export { useAgentManager } from "./useAgentManager";
export type { AgentManagerState, AgentManagerActions } from "./types";
