const controllers = new Map<string, AbortController>();

export function registerRunController(runId: string, controller: AbortController): void {
  controllers.set(runId, controller);
}

export function getRunController(runId: string): AbortController | null {
  return controllers.get(runId) ?? null;
}

export function unregisterRunController(runId: string): void {
  controllers.delete(runId);
}
