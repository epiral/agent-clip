import type { Agent } from "../../lib/types";

export interface AgentInfoProps {
  agent: {
    id: string;
    name: string;
    llm_model: string | null;
    llm_provider?: string | null;
    system_prompt?: string | null;
    scope?: string[] | null;
    pinned?: string[] | null;
  };
  onEdit?: () => void;
}
