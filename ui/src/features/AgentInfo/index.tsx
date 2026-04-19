import { AgentInfoView } from "./AgentInfoView";
import type { AgentInfoProps } from "./types";

export function AgentInfo(props: AgentInfoProps) {
  return <AgentInfoView {...props} />;
}

export type { AgentInfoProps } from "./types";
