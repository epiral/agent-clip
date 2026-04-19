import type { Agent, CreateAgentInput } from "../../lib/types";

export interface AgentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent | null;
  onSave: (data: CreateAgentInput) => void;
  saving: boolean;
  availableProviders?: string[];
  availableClips?: string[];
}
