import { useState, useCallback } from "react";
import { mockAgents } from "../lib/mock";
import type { Agent, CreateAgentInput } from "../lib/types";
import { AgentPickerView } from "./AgentPicker/AgentPickerView";
import { AgentManagerView } from "./AgentManager/AgentManagerView";
import { AgentFormView } from "./AgentForm/AgentFormView";
import { AgentInfoView } from "./AgentInfo/AgentInfoView";

type Section = "picker" | "manager" | "form-create" | "form-edit" | "info" | "all";

export function DevPage() {
  const [section, setSection] = useState<Section>("all");
  const [agents, setAgents] = useState<Agent[]>(mockAgents);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const handleSave = useCallback((data: CreateAgentInput) => {
    if (editingAgent) {
      setAgents(prev => prev.map(a => a.id === editingAgent.id ? { ...a, ...data, updated_at: Date.now() / 1000 } : a));
    } else {
      const newAgent: Agent = {
        id: `dev-${Date.now()}`,
        name: data.name,
        llm_provider: data.llm_provider ?? null,
        llm_model: data.llm_model ?? null,
        max_tokens: data.max_tokens ?? null,
        system_prompt: data.system_prompt ?? null,
        scope: data.scope ?? null,
        pinned: data.pinned ?? null,
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
      };
      setAgents(prev => [...prev, newAgent]);
    }
    setFormOpen(false);
    setEditingAgent(null);
  }, [editingAgent]);

  const tabs: { id: Section; label: string }[] = [
    { id: "all", label: "All" },
    { id: "picker", label: "AgentPicker" },
    { id: "manager", label: "AgentManager" },
    { id: "form-create", label: "Form (Create)" },
    { id: "form-edit", label: "Form (Edit)" },
    { id: "info", label: "AgentInfo" },
  ];

  const show = (s: Section) => section === "all" || section === s;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold text-foreground mr-4">Dev Page</h1>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                section === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-accent-foreground hover:bg-accent/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {show("picker") && (
          <DevSection title="AgentPicker — 空状态 Agent 选择">
            <div className="max-w-2xl mx-auto">
              <AgentPickerView
                agents={agents}
                selectedAgentId={selectedAgentId}
                loading={false}
                select={setSelectedAgentId}
                deselect={() => setSelectedAgentId(null)}
                onCreate={() => { setEditingAgent(null); setFormOpen(true); }}
              />
            </div>
          </DevSection>
        )}

        {show("picker") && (
          <DevSection title="AgentPicker — 空状态（无 Agent）">
            <div className="max-w-2xl mx-auto">
              <AgentPickerView
                agents={[]}
                selectedAgentId={null}
                loading={false}
                select={() => {}}
                deselect={() => {}}
                onCreate={() => { setEditingAgent(null); setFormOpen(true); }}
              />
            </div>
          </DevSection>
        )}

        {show("manager") && (
          <DevSection title="AgentManager — Sidebar Agent Tab">
            <div className="w-[300px] border border-border rounded-lg overflow-hidden">
              <AgentManagerView
                agents={agents}
                loading={false}
                error={null}
                saving={false}
                formOpen={false}
                editingAgent={null}
                deleteOpen={false}
                deletingAgent={null}
                openCreate={() => { setEditingAgent(null); setFormOpen(true); }}
                openEdit={(a) => { setEditingAgent(a); setFormOpen(true); }}
                closeForm={() => {}}
                saveAgent={() => {}}
                openDelete={() => {}}
                closeDelete={() => {}}
                confirmDelete={() => {}}
              />
            </div>
          </DevSection>
        )}

        {show("manager") && (
          <DevSection title="AgentManager — 空状态">
            <div className="w-[300px] border border-border rounded-lg overflow-hidden">
              <AgentManagerView
                agents={[]}
                loading={false}
                error={null}
                saving={false}
                formOpen={false}
                editingAgent={null}
                deleteOpen={false}
                deletingAgent={null}
                openCreate={() => { setEditingAgent(null); setFormOpen(true); }}
                openEdit={() => {}}
                closeForm={() => {}}
                saveAgent={() => {}}
                openDelete={() => {}}
                closeDelete={() => {}}
                confirmDelete={() => {}}
              />
            </div>
          </DevSection>
        )}

        {show("info") && (
          <DevSection title="AgentInfo — Popover">
            <div className="flex gap-4 items-center">
              <span className="text-sm text-muted-foreground">点击 ⓘ 查看:</span>
              <AgentInfoView
                agent={agents[0]}
                onEdit={() => alert("编辑 Agent")}
              />
            </div>
          </DevSection>
        )}

        {/* Form dialog — shared across sections */}
        <AgentFormView
          open={formOpen || show("form-create") && section === "form-create" || show("form-edit") && section === "form-edit"}
          onOpenChange={(open) => {
            if (!open) { setFormOpen(false); setEditingAgent(null); }
          }}
          agent={section === "form-edit" ? agents[0] : editingAgent}
          onSave={handleSave}
          saving={false}
        />
      </div>
    </div>
  );
}

function DevSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">{title}</h2>
      {children}
    </section>
  );
}
