type Listener<T> = (event: T) => void;

type AgentExecutionEvent = {
  execution_id: number;
  reason: string;
  at: string;
};

type CrewExecutionEvent = {
  execution_id: number;
  reason: string;
  at: string;
};

type WorkflowRunEvent = {
  run_id: number;
  reason: string;
  at: string;
};

const agentExecutionListeners = new Map<number, Set<Listener<AgentExecutionEvent>>>();
const crewExecutionListeners = new Map<number, Set<Listener<CrewExecutionEvent>>>();
const workflowRunListeners = new Map<number, Set<Listener<WorkflowRunEvent>>>();

function subscribeToMap<T>(
  map: Map<number, Set<Listener<T>>>,
  id: number,
  listener: Listener<T>
) {
  const current = map.get(id);
  if (current) {
    current.add(listener);
  } else {
    map.set(id, new Set([listener]));
  }
  return () => {
    const set = map.get(id);
    if (!set) return;
    set.delete(listener);
    if (!set.size) map.delete(id);
  };
}

function publishToMap<T extends { at: string }>(
  map: Map<number, Set<Listener<T>>>,
  id: number,
  event: Omit<T, 'at'>
) {
  const listeners = map.get(id);
  if (!listeners?.size) return;
  const payload = { ...event, at: new Date().toISOString() } as T;
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener failures
    }
  }
}

export function subscribeAgentExecution(executionId: number, listener: Listener<AgentExecutionEvent>) {
  return subscribeToMap(agentExecutionListeners, executionId, listener);
}

export function publishAgentExecution(executionId: number, reason: string) {
  publishToMap(agentExecutionListeners, executionId, { execution_id: executionId, reason });
}

export function subscribeCrewExecution(executionId: number, listener: Listener<CrewExecutionEvent>) {
  return subscribeToMap(crewExecutionListeners, executionId, listener);
}

export function publishCrewExecution(executionId: number, reason: string) {
  publishToMap(crewExecutionListeners, executionId, { execution_id: executionId, reason });
}

export function subscribeWorkflowRun(runId: number, listener: Listener<WorkflowRunEvent>) {
  return subscribeToMap(workflowRunListeners, runId, listener);
}

export function publishWorkflowRun(runId: number, reason: string) {
  publishToMap(workflowRunListeners, runId, { run_id: runId, reason });
}

