let currentRunId = "";

export function setCurrentRunId(runId: string): void {
  currentRunId = runId;
}

export function log(event: string, data?: Record<string, unknown>): void {
  console.error(JSON.stringify({ t: Date.now(), run: currentRunId || undefined, event, ...data }));
}
