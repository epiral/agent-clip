import { useState, useCallback } from "react";
import type { Agent, CreateAgentInput } from "../../lib/types";
import * as api from "../../lib/agent";
import type { AgentManagerState, AgentManagerActions } from "./types";

export function useAgentManager(
  agents: Agent[],
  onAgentsChange: () => void,
): AgentManagerState & AgentManagerActions {
  const [loading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);

  const openCreate = useCallback(() => {
    setEditingAgent(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingAgent(null);
  }, []);

  const saveAgent = useCallback(async (data: CreateAgentInput) => {
    setSaving(true);
    setError(null);
    try {
      if (editingAgent) {
        await api.updateAgent(editingAgent.id, data);
      } else {
        await api.createAgent(data);
      }
      closeForm();
      onAgentsChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editingAgent, closeForm, onAgentsChange]);

  const openDelete = useCallback((agent: Agent) => {
    setDeletingAgent(agent);
    setDeleteOpen(true);
  }, []);

  const closeDelete = useCallback(() => {
    setDeleteOpen(false);
    setDeletingAgent(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingAgent) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteAgent(deletingAgent.id);
      closeDelete();
      onAgentsChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [deletingAgent, closeDelete, onAgentsChange]);

  return {
    agents,
    loading,
    error,
    saving,
    formOpen,
    editingAgent,
    deleteOpen,
    deletingAgent,
    openCreate,
    openEdit,
    closeForm,
    saveAgent,
    openDelete,
    closeDelete,
    confirmDelete,
  };
}
