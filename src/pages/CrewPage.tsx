import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Play, Trash2, CheckCircle2, Clock, Terminal, ArrowLeft, Globe, Copy, Check, X } from 'lucide-react';

import CrewWorkflow from '../components/CrewWorkflow';
import TaskAgentEditor from '../components/TaskAgentEditor';
import { loadPersisted, savePersisted } from '../utils/persistence';

interface Tool {
  id: number;
  name: string;
}

interface Agent {
  id: number;
  name: string;
  role: string;
  goal: string;
  backstory: string;
  model: string;
  provider: string;
  is_exposed: boolean;
  tools: Tool[];
}

interface Task {
  id: number;
  description: string;
  expected_output: string;
  agent_id: number;
}

interface Crew {
  id: number;
  name: string;
  description?: string;
  process: string;
  coordinator_agent_id?: number | null;
  project_id?: number | null;
  is_exposed?: boolean;
  max_runtime_ms?: number | null;
  max_cost_usd?: number | null;
  max_tool_calls?: number | null;
}

interface Log {
  timestamp?: string;
  type: 'start' | 'finish' | 'error' | 'thinking' | 'thought' | 'tool_call' | 'tool_result' | 'planner_handoff' | 'crew_summary' | 'crew_result' | 'canceled';
  agent?: string;
  task?: string;
  result?: string;
  message?: string;
  tool?: string;
  args?: any;
  title?: string;
  status?: string;
  child_execution_id?: number | null;
  plan?: string[];
}

type CrewThreadMessage = {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  executionId?: number | null;
};

function buildCrewThreadContext(messages: CrewThreadMessage[], latestInput: string, recentCount = 6) {
  const recent = messages.slice(-recentCount).map((message) => {
    const label = message.role === 'user' ? 'User' : 'Crew';
    return `${label}: ${message.content}`;
  });
  const current = String(latestInput || '').trim();
  return [
    recent.length ? `Conversation so far:\n${recent.join('\n\n')}` : '',
    current ? `Latest user message:\n${current}` : '',
  ].filter(Boolean).join('\n\n');
}

export default function CrewPage() {
  const { id } = useParams();
  const threadStorageKey = `crew_thread_${id || 'unknown'}`;
  const [crew, setCrew] = useState<Crew | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [isEditingCrew, setIsEditingCrew] = useState(false);
  const [editCrew, setEditCrew] = useState({
    name: '',
    process: '',
    coordinator_agent_id: '',
    is_exposed: false,
    max_runtime_ms: '',
    max_cost_usd: '',
    max_tool_calls: ''
  });
  const [isExposing, setIsExposing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [copied, setCopied] = useState(false);
  const runSectionRef = React.useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const executionIdRef = useRef<number | null>(null);
  const [threadMessages, setThreadMessages] = useState<CrewThreadMessage[]>([]);
  const [threadLinkedExecutionIds, setThreadLinkedExecutionIds] = useState<number[]>([]);

  const [initialInput, setInitialInput] = useState('');
  const [newTask, setNewTask] = useState({
    description: '',
    expected_output: '',
    agent_id: ''
  });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    fetchCrewData();
    fetchAgents();
  }, [id]);

  useEffect(() => {
    const persisted = loadPersisted<{ messages?: CrewThreadMessage[]; linkedExecutionIds?: number[] }>(threadStorageKey, {});
    setThreadMessages(Array.isArray(persisted?.messages) ? persisted.messages : []);
    setThreadLinkedExecutionIds(Array.isArray(persisted?.linkedExecutionIds) ? persisted.linkedExecutionIds : []);
  }, [threadStorageKey]);

  useEffect(() => {
    savePersisted(threadStorageKey, {
      messages: threadMessages,
      linkedExecutionIds: threadLinkedExecutionIds,
    });
  }, [threadMessages, threadLinkedExecutionIds, threadStorageKey]);

  useEffect(() => {
    executionIdRef.current = executionId;
  }, [executionId]);

  useEffect(() => {
    if (!isRunning || !executionId) return;
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    const es = new EventSource(`/api/executions/${executionId}/stream`);
    streamRef.current = es;
    es.addEventListener('update', (event: MessageEvent) => {
      if (streamRef.current !== es) return;
      try {
        const data = JSON.parse(event.data || '{}');
        const nextLogs = Array.isArray(data.logs) ? data.logs : [];
        setLogs(prev => {
          if (!nextLogs.length) return prev;
          return [...prev, ...nextLogs];
        });
        if (!nextLogs.length && Number(data.fullLogCount || 0) > 0) {
          void fetchLogs(Number(executionId));
        }
        if (data.status && data.status !== 'running') {
          setIsRunning(false);
        }
      } catch {
        // ignore parse errors
      }
    });
    es.addEventListener('done', () => {
      if (streamRef.current !== es) return;
      setIsRunning(false);
      void fetchLogs(Number(executionId));
      es.close();
      streamRef.current = null;
    });
    es.onerror = () => {
      if (streamRef.current !== es) return;
      void fetchLogs(Number(executionId));
      es.close();
      streamRef.current = null;
    };
    return () => {
      es.close();
      if (streamRef.current === es) streamRef.current = null;
    };
  }, [isRunning, executionId]);

  useEffect(() => {
    if (!isRunning || !executionId) return;
    const timer = window.setInterval(() => {
      void fetchLogs(Number(executionId));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isRunning, executionId]);

  const fetchCrewData = async () => {
    const crewRes = await fetch('/api/crews');
    const crews = await crewRes.json();
    const currentCrew = crews.find((c: any) => c.id === Number(id));
    setCrew(currentCrew);
    if (currentCrew) {
      setEditCrew({
        name: currentCrew.name,
        process: currentCrew.process || 'sequential',
        coordinator_agent_id: currentCrew.coordinator_agent_id != null ? String(currentCrew.coordinator_agent_id) : '',
        is_exposed: Boolean(currentCrew.is_exposed),
        max_runtime_ms: currentCrew.max_runtime_ms != null ? String(currentCrew.max_runtime_ms) : '',
        max_cost_usd: currentCrew.max_cost_usd != null ? String(currentCrew.max_cost_usd) : '',
        max_tool_calls: currentCrew.max_tool_calls != null ? String(currentCrew.max_tool_calls) : '',
      });
    }

    const tasksRes = await fetch(`/api/tasks?crew_id=${id}`);
    const tasksData = await tasksRes.json();
    setTasks(tasksData);
  };

  const fetchAgents = async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data);
  };

  const fetchLogs = async (targetExecutionId?: number) => {
    const resolvedExecutionId = Number(targetExecutionId || executionId || 0);
    if (!resolvedExecutionId) return;
    const res = await fetch(`/api/executions/${resolvedExecutionId}`);
    const data = await res.json();
    if (executionIdRef.current != null && resolvedExecutionId !== Number(executionIdRef.current)) {
      return;
    }
    setLogs(data.logs || []);
    const finalResult = Array.isArray(data.logs)
      ? ([...data.logs].reverse().find((entry: any) => entry.type === 'crew_result' || entry.type === 'crew_summary')?.result || '')
      : '';
    if (
      resolvedExecutionId &&
      finalResult &&
      !threadLinkedExecutionIds.includes(resolvedExecutionId)
    ) {
      setThreadMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: String(finalResult),
          ts: new Date().toISOString(),
          executionId: resolvedExecutionId,
        },
      ]);
      setThreadLinkedExecutionIds((prev) => [...prev, resolvedExecutionId]);
    }
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'canceled') {
      setIsRunning(false);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newTask,
        crew_id: id,
        agent_id: Number(newTask.agent_id)
      })
    });
    setNewTask({ description: '', expected_output: '', agent_id: '' });
    setIsAddingTask(false);
    fetchCrewData();
  };

  const runCrew = async () => {
    const trimmedInput = initialInput.trim();
    const requestInitialInput = buildCrewThreadContext(threadMessages, trimmedInput);
    setIsRunning(true);
    setLogs([]);
    try {
      if (trimmedInput) {
        setThreadMessages((prev) => [
          ...prev,
          {
            role: 'user',
            content: trimmedInput,
            ts: new Date().toISOString(),
          },
        ]);
      }
      const res = await fetch(`/api/crews/${id}/kickoff`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialInput: requestInitialInput || trimmedInput })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to run crew');
      }
      if (!data?.executionId) {
        throw new Error('Crew started but no execution id was returned');
      }
      setExecutionId(Number(data.executionId));
      setInitialInput('');
    } catch (e: any) {
      setIsRunning(false);
      setLogs([{
        timestamp: new Date().toISOString(),
        type: 'error',
        agent: 'system',
        message: e?.message || 'Failed to run crew'
      }]);
    }
  };

  const cancelExecution = async () => {
    if (!executionId) return;
    try {
      const res = await fetch(`/api/executions/${executionId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to cancel execution');
      }
    } catch (e: any) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        type: 'error',
        agent: 'system',
        message: e?.message || 'Failed to cancel execution',
      }]);
    } finally {
      await fetchLogs();
    }
  };

  const handleEditCrewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`/api/crews/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...crew,
        name: editCrew.name,
        process: editCrew.process,
        coordinator_agent_id: editCrew.coordinator_agent_id === '' ? null : Number(editCrew.coordinator_agent_id),
        is_exposed: editCrew.is_exposed,
        max_runtime_ms: editCrew.max_runtime_ms === '' ? null : Number(editCrew.max_runtime_ms),
        max_cost_usd: editCrew.max_cost_usd === '' ? null : Number(editCrew.max_cost_usd),
        max_tool_calls: editCrew.max_tool_calls === '' ? null : Number(editCrew.max_tool_calls),
      })
    });
    setIsEditingCrew(false);
    fetchCrewData();
  };

  const retryExecution = async () => {
    if (!executionId) return;
    const res = await fetch(`/api/executions/${executionId}/retry`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        type: 'error',
        agent: 'system',
        message: data?.error || 'Failed to retry execution',
      }]);
      return;
    }
    setLogs([]);
    setExecutionId(data.executionId);
    setIsRunning(true);
  };

  const timeline = useMemo(() => {
    const starts = new Map<string, string>();
    const rows: Array<{ label: string; status: string; started_at?: string; ended_at?: string; duration_ms?: number }> = [];
    rows.push({
      label: 'queued',
      status: isRunning && !logs.some((log) => log.type === 'start' || log.type === 'tool_call' || log.type === 'finish') ? 'running' : 'completed',
      started_at: logs[0]?.timestamp,
      ended_at: logs[0]?.timestamp,
      duration_ms: 0,
    });
    for (const log of logs) {
      if (log.type === 'start' && log.agent) {
        starts.set(log.agent, log.timestamp);
      }
      if (log.type === 'finish' && log.agent) {
        const started = starts.get(log.agent);
        const end = log.timestamp;
        const duration = started ? Math.max(0, new Date(end).getTime() - new Date(started).getTime()) : undefined;
        rows.push({ label: `agent:${log.agent}`, status: 'completed', started_at: started, ended_at: end, duration_ms: duration });
      }
      if (log.type === 'error') {
        rows.push({ label: 'error', status: 'failed', started_at: log.timestamp, ended_at: log.timestamp, duration_ms: 0 });
      }
      if (log.type === 'canceled') {
        rows.push({ label: 'execution', status: 'canceled', started_at: log.timestamp, ended_at: log.timestamp, duration_ms: 0 });
      }
    }
    if (!isRunning && logs.length > 0 && !rows.find(r => r.label === 'finished')) {
      const end = logs[logs.length - 1]?.timestamp;
      rows.push({ label: 'finished', status: rows.some(r => r.status === 'failed') ? 'failed' : 'completed', started_at: end, ended_at: end, duration_ms: 0 });
    }
    return rows;
  }, [logs, isRunning]);

  const finalCrewOutput = useMemo(() => {
    const summary = [...logs].reverse().find((l) => l.type === 'crew_result' || l.type === 'crew_summary');
    if (summary?.result) return summary.result;
    const lastFinish = [...logs].reverse().find((l) => l.type === 'finish' && l.result);
    return lastFinish?.result || '';
  }, [logs]);

  const handleExposeToggle = async (nextValue: boolean) => {
    if (!crew) return;
    setIsExposing(true);
    try {
      await fetch(`/api/crews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...crew,
          is_exposed: nextValue
        })
      });
      setCrew({ ...crew, is_exposed: nextValue });
      setEditCrew((prev) => ({ ...prev, is_exposed: nextValue }));
    } finally {
      setIsExposing(false);
    }
  };

  const crewToolName = (name: string) => `crew_${name.toLowerCase().replace(/\s+/g, '_')}`;
  const origin = window.location.origin;
  const apiUrl = `${origin}/api/crews/${id}/kickoff`;
  const curlCommand = `curl -X POST ${apiUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"initialInput": "Your input here", "user_id": "user_123"}'`;
  const mcpConfig = `{
  "mcpServers": {
    "${crewToolName(crew?.name || 'crew')}": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse", "--url", "${origin}/mcp/sse"]
    }
  }
}`;
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveTaskDetails = async (taskId: number, updates: Partial<Task>) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    fetchCrewData();
  };

  const handleSaveAgentDetails = async (agentId: number, updates: Partial<Agent>) => {
    await fetch(`/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    fetchAgents();
  };

  const handleDeleteTaskDetails = async (taskId: number) => {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    fetchCrewData();
  };

  if (!crew) return <div>Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
          <ArrowLeft size={20} />
        </Link>
        {isEditingCrew ? (
          <form onSubmit={handleEditCrewSubmit} className="flex-1 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Crew Name</label>
              <input
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-semibold text-slate-900"
                value={editCrew.name}
                onChange={e => setEditCrew({...editCrew, name: e.target.value})}
                placeholder="Crew Name"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Process</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-700 bg-white"
                value={editCrew.process}
                onChange={e => setEditCrew({...editCrew, process: e.target.value})}
              >
                <option value="sequential">Sequential</option>
                <option value="hierarchical">Hierarchical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Coordinator Agent</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-700 bg-white"
                value={editCrew.coordinator_agent_id}
                onChange={e => setEditCrew({...editCrew, coordinator_agent_id: e.target.value})}
              >
                <option value="">Auto Select</option>
                {agents
                  .filter((agent) => tasks.some((t) => Number(t.agent_id) === Number(agent.id)))
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Max Runtime (ms)</label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                value={editCrew.max_runtime_ms}
                onChange={e => setEditCrew({ ...editCrew, max_runtime_ms: e.target.value })}
                placeholder="120000"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Max Cost (USD)</label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                value={editCrew.max_cost_usd}
                onChange={e => setEditCrew({ ...editCrew, max_cost_usd: e.target.value })}
                placeholder="5"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Max Tool Calls</label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                value={editCrew.max_tool_calls}
                onChange={e => setEditCrew({ ...editCrew, max_tool_calls: e.target.value })}
                placeholder="20"
              />
            </div>
            <div className="md:col-span-6 flex items-center justify-end gap-3 pt-1">
              <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
                Save
              </button>
              <button type="button" onClick={() => setIsEditingCrew(false)} className="text-slate-500 hover:text-slate-700 text-sm">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-900">{crew.name}</h1>
                <button 
                  onClick={() => {
                    setIsEditingCrew(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="text-slate-400 hover:text-indigo-600 transition-colors"
                  title="Edit Crew"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
                {crew.is_exposed && (
                  <button
                    onClick={() => setShowConnection(true)}
                    className="text-slate-400 hover:text-green-600 transition-colors"
                    title="Connection Info"
                  >
                    <Globe size={18} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-slate-500">Manage tasks and execute workflow</p>
                <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full uppercase tracking-wide">
                  {crew.process}
                </span>
                {crew.process === 'hierarchical' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                    Coordinator {agents.find((a) => Number(a.id) === Number(crew.coordinator_agent_id))?.name || 'Auto'}
                  </span>
                )}
                {crew.max_runtime_ms ? <span className="text-[10px] font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Runtime {crew.max_runtime_ms}ms</span> : null}
                {crew.max_cost_usd ? <span className="text-[10px] font-medium px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">Cost ${crew.max_cost_usd}</span> : null}
                {crew.max_tool_calls ? <span className="text-[10px] font-medium px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">Tools {crew.max_tool_calls}</span> : null}
              </div>
            </div>
            <div className="ml-auto" />
          </>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Crew Exposure</h2>
        <p className="text-sm text-slate-500 mb-4">Expose this crew to MCP tool calls and the HTTP API.</p>
        <div className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            id="crewExposeToggle"
            className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
            checked={Boolean(crew.is_exposed)}
            onChange={(e) => handleExposeToggle(e.target.checked)}
            disabled={isExposing}
          />
          <label htmlFor="crewExposeToggle" className="text-sm text-slate-700">
            Expose crew via MCP/API
          </label>
          <button
            onClick={() => setShowConnection(true)}
            className="ml-auto text-xs text-indigo-600 hover:text-indigo-800"
          >
            View REST/MCP
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">MCP Tool Name</div>
            <div className="font-mono text-sm text-slate-800">{crewToolName(crew.name)}</div>
            <button
              onClick={() => copyToClipboard(crewToolName(crew.name))}
              className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} Copy
            </button>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">HTTP API</div>
            <div className="font-mono text-xs text-slate-800 break-all">{apiUrl}</div>
            <div className="mt-2 text-xs text-slate-500">POST JSON: {"{ \"initialInput\": \"...\" }"}</div>
            <button
              onClick={() => copyToClipboard(apiUrl)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} Copy
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Tasks */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Crew Conversation Thread</h2>
                <p className="text-sm text-slate-500">Follow-up runs reuse recent thread context so the crew behaves more like a continuing conversation.</p>
              </div>
              {threadMessages.length > 0 && (
                <button
                  onClick={() => {
                    setThreadMessages([]);
                    setThreadLinkedExecutionIds([]);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                >
                  <Trash2 size={14} /> Clear Thread
                </button>
              )}
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              {threadMessages.length === 0 ? (
                <div className="text-sm text-slate-500">No conversation yet. Start with an objective or follow-up request below.</div>
              ) : (
                threadMessages.map((message, index) => (
                  <div
                    key={`${message.ts}-${index}`}
                    className={`rounded-xl border px-4 py-3 text-sm whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'border-indigo-200 bg-indigo-50/80 text-slate-800'
                        : 'border-emerald-200 bg-emerald-50/80 text-slate-800'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em]">
                      <span className={message.role === 'user' ? 'text-indigo-600' : 'text-emerald-600'}>
                        {message.role === 'user' ? 'User' : 'Crew'}
                      </span>
                      <span className="text-slate-400">
                        {new Date(message.ts).toLocaleString()}
                        {message.executionId ? ` • exec #${message.executionId}` : ''}
                      </span>
                    </div>
                    <div>{message.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div ref={runSectionRef} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Initial Input (Optional)</h2>
            <p className="text-sm text-slate-500 mb-4">Provide the next user message or context. Recent thread history will be included automatically for continuity.</p>
            <textarea
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px] font-mono text-sm"
              placeholder="Enter initial input context here..."
              value={initialInput}
              onChange={(e) => setInitialInput(e.target.value)}
              disabled={isRunning}
            />
            <div className="mt-4 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {isRunning ? 'Crew is running. Logs update in real time.' : 'Run uses the input above and streams logs to the panel.'}
              </div>
              <div className="flex items-center gap-2">
                {isRunning && executionId && (
                  <button
                    onClick={cancelExecution}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={runCrew}
                  disabled={isRunning}
                  className={`px-5 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${
                    isRunning
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow-md'
                  }`}
                >
                  <Play size={16} />
                  {isRunning ? 'Running...' : 'Run Crew'}
                </button>
                {!isRunning && executionId && (
                  <button
                    onClick={retryExecution}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  >
                    Retry Last Run
                  </button>
                )}
              </div>
            </div>
            {tasks.length === 0 && (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No workflow tasks defined. Run will auto-generate one runtime step per assigned crew agent.
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Assignment Board</h2>
            <p className="text-sm text-slate-500 mb-4">Quickly re-assign task ownership without opening each task editor.</p>
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center border border-slate-100 rounded-lg p-3">
                  <div className="md:col-span-2 text-sm text-slate-800">{task.description}</div>
                  <div className="text-xs text-slate-500">Expected: <span className="text-slate-700">{task.expected_output}</span></div>
                  <select
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    value={String(task.agent_id)}
                    onChange={(e) => handleSaveTaskDetails(task.id, { agent_id: Number(e.target.value) } as any)}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>
                    ))}
                  </select>
                </div>
              ))}
              {!tasks.length && <div className="text-sm text-slate-500">No tasks yet.</div>}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-slate-800">Workflow Tasks</h2>
              <p className="text-sm text-slate-500 mt-1">The live canvas highlights the active node, flowing path, and current tool call so the crew feels more like an operator console than a static task list.</p>
            </div>
            <button 
              onClick={() => setIsAddingTask(true)}
              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-1"
            >
              <Plus size={16} /> Add Task
            </button>
          </div>

          {isAddingTask && (
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-2">
              <form onSubmit={handleAddTask} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-20"
                    value={newTask.description}
                    onChange={e => setNewTask({...newTask, description: e.target.value})}
                    placeholder="Describe the task in detail..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Expected Output</label>
                  <input
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={newTask.expected_output}
                    onChange={e => setNewTask({...newTask, expected_output: e.target.value})}
                    placeholder="What should the result look like?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assign Agent</label>
                  <select
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    value={newTask.agent_id}
                    onChange={e => setNewTask({...newTask, agent_id: e.target.value})}
                  >
                    <option value="">Select an agent...</option>
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsAddingTask(false)}
                    className="text-slate-500 px-4 py-2 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
                  >
                    Add Task
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="space-y-4">
            {tasks.length > 0 ? (
              <CrewWorkflow 
                tasks={tasks} 
                agents={agents} 
                onNodeClick={setSelectedTask} 
                processType={crew.process}
                logs={logs}
                isRunning={isRunning}
              />
            ) : (
              !isAddingTask && (
                <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                  <p className="text-slate-500">No tasks defined. Add tasks to build your workflow.</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Execution Logs */}
        <div className="lg:col-span-1">
          <div className="bg-slate-900 text-slate-200 rounded-xl overflow-hidden shadow-lg flex flex-col h-[600px]">
            <div className="p-4 border-b border-slate-800 flex items-center gap-2 bg-slate-950">
              <Terminal size={18} className="text-green-500" />
              <span className="font-mono text-sm font-bold">Execution Logs</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center mt-10">
                  {isRunning ? 'Waiting for worker claim...' : 'Ready to start...'}
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <Clock size={10} />
                      <span>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'now'}</span>
                    </div>
                    
                    {log.type === 'start' && (
                      <div className="text-yellow-400 border-t border-slate-800 pt-2 mt-2">
                        <span className="font-bold">➔ STARTING:</span> {log.agent} working on "{log.task}"...
                      </div>
                    )}
                    
                    {log.type === 'thinking' && (
                      <div className="text-slate-500 italic pl-4">
                         Thinking...
                      </div>
                    )}

                    {log.type === 'thought' && (
                      <div className="text-cyan-400 pl-4">
                        <span className="font-bold text-cyan-600">Thought:</span> {log.message}
                      </div>
                    )}

                    {log.type === 'planner_handoff' && (
                      <div className="text-sky-300 pl-4">
                        <span className="font-bold">Planner Handoff:</span>
                        <pre className="text-xs text-slate-400 mt-1 bg-slate-900/50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(log.plan || [], null, 2)}
                        </pre>
                      </div>
                    )}

                    {log.type === 'delegated_parent' && (
                      <div className="text-violet-300 pl-4">
                        <span className="font-bold">Supervisor Tree:</span> {log.message}
                      </div>
                    )}

                    {(log.type === 'crew_delegate' || log.type === 'crew_synthesis_step') && (
                      <div className="text-violet-200 pl-4 space-y-2">
                        <div>
                          <span className="font-bold">{log.type === 'crew_synthesis_step' ? 'Synthesis Step:' : 'Delegated Step:'}</span>{' '}
                          {log.title || log.agent || 'Delegation'}
                        </div>
                        <div className="text-slate-400">
                          {log.status || 'unknown'}{log.child_execution_id ? ` • child #${log.child_execution_id}` : ''}
                        </div>
                        {log.task ? (
                          <div className="text-slate-300 whitespace-pre-wrap bg-slate-900/40 p-2 rounded">
                            {log.task}
                          </div>
                        ) : null}
                        {log.result ? (
                          <div className="text-slate-300 whitespace-pre-wrap bg-slate-900/40 p-2 rounded">
                            {log.result}
                          </div>
                        ) : null}
                        {!log.result && log.message ? (
                          <div className="text-slate-300 whitespace-pre-wrap bg-slate-900/40 p-2 rounded">
                            {log.message}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {log.type === 'tool_call' && (
                      <div className="text-purple-400 pl-4">
                        <span className="font-bold">🛠 Tool Call:</span> {log.tool}
                        <pre className="text-xs text-purple-300 mt-1 bg-slate-900/50 p-1 rounded overflow-x-auto">
                          {JSON.stringify(log.args, null, 2)}
                        </pre>
                      </div>
                    )}

                    {log.type === 'tool_result' && (
                      <div className="text-purple-300 pl-4">
                        <span className="font-bold">↩ Tool Result:</span>
                        <pre className="text-xs text-slate-400 mt-1 bg-slate-900/50 p-1 rounded overflow-x-auto whitespace-pre-wrap">
                          {log.result}
                        </pre>
                      </div>
                    )}
                    
                    {log.type === 'finish' && (
                      <div className="space-y-2 pb-2 border-b border-slate-800">
                        <div className="text-green-400">
                          <span className="font-bold">✓ COMPLETED:</span> {log.agent} finished task.
                        </div>
                        <div className="pl-2 border-l-2 border-green-900/50 text-slate-300 whitespace-pre-wrap bg-slate-800/20 p-2 rounded">
                          {log.result}
                        </div>
                      </div>
                    )}

                    {(log.type === 'crew_summary' || log.type === 'crew_result') && (
                      <div className="space-y-2 pb-2 border-b border-slate-800">
                        <div className="text-emerald-300">
                          <span className="font-bold">◉ CUMULATIVE OUTPUT:</span> {log.agent ? `by ${log.agent}` : 'crew synthesis'}
                        </div>
                        <div className="pl-2 border-l-2 border-emerald-900/50 text-slate-200 whitespace-pre-wrap bg-emerald-950/20 p-2 rounded">
                          {log.result}
                        </div>
                      </div>
                    )}

                    {log.type === 'error' && (
                      <div className="text-red-400">
                        <span className="font-bold">✕ ERROR:</span> {log.message}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Execution Timeline</h3>
            <div className="space-y-2">
              {timeline.map((row, idx) => (
                <div key={`${row.label}-${idx}`} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                  <div className="text-slate-700">{row.label}</div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full ${
                      row.status === 'failed' ? 'bg-red-100 text-red-700' :
                      row.status === 'canceled' ? 'bg-amber-100 text-amber-700' :
                      row.status === 'running' ? 'bg-blue-100 text-blue-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>{row.status}</span>
                    <span className="font-mono text-slate-500">{row.duration_ms != null ? `${row.duration_ms}ms` : '-'}</span>
                  </div>
                </div>
              ))}
              {!timeline.length && <div className="text-xs text-slate-500">No timeline data yet.</div>}
            </div>
          </div>

          {!isRunning && logs.length > 0 && finalCrewOutput && (
            <div className="mt-8 bg-white p-6 rounded-xl border border-emerald-200 shadow-sm">
              <h2 className="text-xl font-bold text-emerald-800 mb-4 flex items-center gap-2">
                <CheckCircle2 className="text-emerald-500" />
                Final Crew Output
              </h2>
              <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap bg-emerald-50/50 p-4 rounded-lg border border-emerald-100">
                {finalCrewOutput}
              </div>
            </div>
          )}
        </div>
      </div>
      {selectedTask && (
        <TaskAgentEditor
          task={selectedTask}
          agent={agents.find(a => a.id === selectedTask.agent_id)}
          allAgents={agents}
          onClose={() => setSelectedTask(null)}
          onSaveTask={handleSaveTaskDetails}
          onSaveAgent={handleSaveAgentDetails}
          onDeleteTask={handleDeleteTaskDetails}
        />
      )}

      {showConnection && crew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Globe size={24} className="text-indigo-600" />
                Connect to {crew.name}
              </h3>
              <button onClick={() => setShowConnection(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-8">
              <div>
                <h4 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Terminal size={18} />
                  REST API
                </h4>
                <p className="text-sm text-slate-600 mb-3">
                  Execute this crew directly via HTTP POST. Include a stable <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">user_id</code> (or reuse <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">session_id</code>) if you want to keep per-user memory in the future.
                </p>
                <div className="bg-slate-900 rounded-lg p-4 relative group">
                  <button
                    onClick={() => copyToClipboard(curlCommand)}
                    className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                    {curlCommand}
                  </pre>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-indigo-600">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Model Context Protocol (MCP)
                  </h4>
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">Experimental</span>
                </div>
                <p className="text-sm text-slate-600 mb-3">
                  Add this crew as a tool to Claude Desktop or other MCP clients. Send <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">user_id</code> (or reuse <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">session_id</code>) in tool arguments if you want to keep per-user memory in the future.
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">claude_desktop_config.json</p>
                  <div className="bg-slate-900 rounded-lg p-4 relative group">
                    <button
                      onClick={() => copyToClipboard(mcpConfig)}
                      className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                    <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                      {mcpConfig}
                    </pre>
                  </div>
                  <p className="text-xs text-slate-500 mt-3">
                    Manifest URL: <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">{origin}/mcp/manifest</code>
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
              <button
                onClick={() => setShowConnection(false)}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
