import type { Agent, CreateAgentInput } from "../../lib/types";

export interface AgentManagerOptions {
  availableProviders?: string[];
  availableClips?: string[];
}

export interface AgentManagerState {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  formOpen: boolean;
  editingAgent: Agent | null;
  deleteOpen: boolean;
  deletingAgent: Agent | null;
}

export interface AgentManagerActions {
  openCreate: () => void;
  openEdit: (agent: Agent) => void;
  closeForm: () => void;
  saveAgent: (data: CreateAgentInput) => void;
  openDelete: (agent: Agent) => void;
  closeDelete: () => void;
  confirmDelete: () => void;
}
