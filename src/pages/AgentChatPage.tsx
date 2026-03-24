import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Plus, Send, Bot, User, Loader2, GitBranch, ExternalLink, Search, Sparkles, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadPersisted, savePersisted } from '../utils/persistence';

type Agent = { id: number; name: string; role?: string; status?: string };
type SessionSummary = {
  id: string;
  user_id?: string | null;
  created_at?: string;
  last_seen_at?: string;
  message_count?: number;
  preview?: string;
};
type TraceEvent = {
  type?: string;
  message?: string;
  tool?: string;
  args?: any;
  result?: string;
  agent?: string;
  duration_ms?: number;
  status?: string;
  execution_id?: number | null;
};
type ChatMessage = { role: 'user' | 'assistant'; content: string; ts?: string; debug?: MessageDebug; trace?: TraceEvent[] };
type DebugUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
type DebugStep = { stage?: string; status?: string; duration_ms?: number; error?: string | null; at?: string };
type MessageDebug = {
  executionId: number | null;
  status: string;
  usage: DebugUsage;
  timeline: DebugStep[];
};

async function safeJson(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function parseSseChunk(buffer: string) {
  const events: Array<{ event: string; data: any }> = [];
  let rest = buffer;
  while (true) {
    const idx = rest.indexOf('\n\n');
    if (idx === -1) break;
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const raw = dataLines.join('\n');
    let data: any = raw;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    events.push({ event: eventName, data });
  }
  return { events, rest };
}

function appendToolSnapshotTrace(existing: TraceEvent[], tools: any[]): TraceEvent[] {
  const base = existing.filter((e) => e.type !== 'timeline');
  const mapped = (Array.isArray(tools) ? tools : []).map((t: any) => ({
    type: 'timeline',
    message: `tool:${t.tool_name} • ${t.status || 'unknown'}`,
    tool: t.tool_name,
    duration_ms: t.duration_ms,
    status: t.status,
  }));
  return [...base, ...mapped];
}

function summarizeDelegationTrace(delegations: any[]): TraceEvent[] {
  return (Array.isArray(delegations) ? delegations : []).map((delegation: any) => ({
    type: 'delegation',
    message: `${delegation.role === 'synthesis' ? 'synthesis' : 'delegate'}:${delegation.title || delegation.agent_name || delegation.agent_id} • ${delegation.status || 'unknown'}`,
    agent: delegation.agent_name || `Agent ${delegation.agent_id}`,
    status: delegation.status || 'unknown',
    result: delegation.result || delegation.error || '',
    execution_id: delegation.child_execution_id ? Number(delegation.child_execution_id) : null,
  }));
}

export default function AgentChatPage() {
  const AGENT_CHAT_UI_KEY = 'agent_chat_ui_state_v1';
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [showToolTrace, setShowToolTrace] = useState(true);
  const [supervisorMode, setSupervisorMode] = useState(false);
  const [delegateAgentIds, setDelegateAgentIds] = useState<number[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [stateReady, setStateReady] = useState(false);
  const loadedSessionKeyRef = useRef<string>('');
  const sendingRef = useRef(false);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const delegateCandidates = useMemo(
    () => agents.filter((a) => a.id !== selectedAgentId),
    [agents, selectedAgentId]
  );
  const filteredAgents = useMemo(
    () => agents.filter((a) => `${a.name} ${a.role || ''}`.toLowerCase().includes(agentSearch.trim().toLowerCase())),
    [agents, agentSearch]
  );

  const loadAgents = async () => {
    const res = await fetch('/api/agents');
    const data = await safeJson(res);
    if (Array.isArray(data)) {
      setAgents(data);
      if (!selectedAgentId && data.length) setSelectedAgentId(data[0].id);
    }
  };

  useEffect(() => {
    const persisted = loadPersisted<any>(AGENT_CHAT_UI_KEY, {});
    if (persisted && typeof persisted === 'object') {
      if (typeof persisted.selectedAgentId === 'number') setSelectedAgentId(persisted.selectedAgentId);
      if (typeof persisted.selectedSessionId === 'string') setSelectedSessionId(persisted.selectedSessionId);
      if (typeof persisted.debugMode === 'boolean') setDebugMode(persisted.debugMode);
      if (typeof persisted.showToolTrace === 'boolean') setShowToolTrace(persisted.showToolTrace);
      if (typeof persisted.supervisorMode === 'boolean') setSupervisorMode(persisted.supervisorMode);
      if (Array.isArray(persisted.delegateAgentIds)) {
        setDelegateAgentIds(persisted.delegateAgentIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0));
      }
      if (typeof persisted.draft === 'string') setDraft(persisted.draft);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    savePersisted(AGENT_CHAT_UI_KEY, {
      selectedAgentId,
      selectedSessionId,
      debugMode,
      showToolTrace,
      supervisorMode,
      delegateAgentIds,
      draft,
    });
  }, [stateReady, selectedAgentId, selectedSessionId, debugMode, showToolTrace, supervisorMode, delegateAgentIds, draft]);

  const loadSessions = async (agentId: number, silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/sessions`);
      const data = await safeJson(res);
      setSessions(Array.isArray(data) ? data : []);
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load sessions');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMessages = async (agentId: number, sessionId: string, silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/sessions/${sessionId}/messages`);
      const data = await safeJson(res) as any;
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setSelectedSessionId(sessionId);
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load chat messages');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { loadAgents(); }, []);

  useEffect(() => {
    if (!selectedAgentId) return;
    setSelectedSessionId(null);
    setMessages([]);
    loadedSessionKeyRef.current = '';
    setDelegateAgentIds((prev) => prev.filter((id) => id !== selectedAgentId));
    loadSessions(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId || !sessions.length) return;
    if (sendingRef.current) return;
    if (!selectedSessionId) {
      const latest = sessions[0];
      if (!latest?.id) return;
      const key = `${selectedAgentId}:${latest.id}`;
      if (loadedSessionKeyRef.current === key) return;
      loadedSessionKeyRef.current = key;
      loadMessages(selectedAgentId, latest.id);
      return;
    }
    const key = `${selectedAgentId}:${selectedSessionId}`;
    if (loadedSessionKeyRef.current === key) return;
    loadedSessionKeyRef.current = key;
    loadMessages(selectedAgentId, selectedSessionId);
  }, [selectedAgentId, selectedSessionId, sessions]);

  useEffect(() => {
    if (!selectedAgentId) return;
    const refresh = async () => {
      if (sendingRef.current) return;
      await loadSessions(selectedAgentId, true);
      if (selectedSessionId) {
        await loadMessages(selectedAgentId, selectedSessionId, true);
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [selectedAgentId, selectedSessionId]);

  const startNewChat = () => {
    setSelectedSessionId(null);
    setMessages([]);
    setDraft('');
    setError('');
  };

  const toggleDelegateAgent = (agentId: number) => {
    setDelegateAgentIds((prev) => prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]);
  };

  const sendMessage = async () => {
    const agentId = selectedAgentId;
    const text = draft.trim();
    if (!agentId || !text || sending) return;

    const now = new Date().toISOString();
    setDraft('');
    setSending(true);
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: text, ts: now }]);
    const assistantTs = new Date().toISOString();
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Working on it…', ts: assistantTs, trace: [] }]);

    try {
      if (supervisorMode) {
        if (!delegateAgentIds.length) {
          throw new Error('Select at least one delegate agent for supervisor mode');
        }
        const kickoffRes = await fetch(`/api/agents/${agentId}/delegate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: text,
            delegate_agent_ids: delegateAgentIds,
            synthesize: true,
            wait: false,
          }),
        });
        const kickoffData = await safeJson(kickoffRes) as any;
        if (!kickoffRes.ok) {
          throw new Error(kickoffData?.error || `Supervisor launch failed (HTTP ${kickoffRes.status})`);
        }
        const parentExecutionId = Number(kickoffData?.parent_execution_id || 0);
        if (!Number.isFinite(parentExecutionId) || parentExecutionId <= 0) {
          throw new Error('Supervisor launch did not return a parent execution id');
        }

        let liveTrace: TraceEvent[] = [{
          type: 'status',
          message: `Supervisor run started with ${delegateAgentIds.length} delegate${delegateAgentIds.length === 1 ? '' : 's'}`,
          execution_id: parentExecutionId,
        }];
        const updateAssistantMessage = (updater: (m: ChatMessage) => ChatMessage) => {
          setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant' ? updater(m) : m)));
        };
        updateAssistantMessage((m) => ({ ...m, trace: liveTrace, content: `Supervisor run started. Execution #${parentExecutionId}` }));

        await new Promise<void>((resolve, reject) => {
          const es = new EventSource(`/api/agent-executions/${parentExecutionId}/stream`);
          es.addEventListener('update', (event: MessageEvent) => {
            try {
              const payload = JSON.parse(String(event.data || '{}'));
              const delegationTrace = summarizeDelegationTrace(payload?.delegations || []);
              const toolTrace = appendToolSnapshotTrace([], payload?.tools || []);
              liveTrace = [
                {
                  type: 'status',
                  message: `Supervisor execution #${parentExecutionId} is ${payload?.execution?.status || 'running'}`,
                  execution_id: parentExecutionId,
                  status: payload?.execution?.status || 'running',
                },
                ...delegationTrace,
                ...toolTrace,
              ];
              const latestDelegation = delegationTrace[delegationTrace.length - 1];
              updateAssistantMessage((m) => ({
                ...m,
                trace: liveTrace,
                content: latestDelegation?.message
                  ? `Supervisor progress: ${latestDelegation.message}`
                  : `Supervisor execution #${parentExecutionId} is ${payload?.execution?.status || 'running'}`,
              }));
            } catch {
              // ignore malformed snapshots
            }
          });
          es.addEventListener('done', () => {
            es.close();
            resolve();
          });
          es.addEventListener('error', () => {
            es.close();
            resolve();
          });
        });

        const tRes = await fetch(`/api/agent-executions/${parentExecutionId}/timeline`);
        const tData = await safeJson(tRes) as any;
        const timelineRows: any[] = Array.isArray(tData?.timeline) ? tData.timeline : [];
        const delegationRows: any[] = Array.isArray(tData?.delegations) ? tData.delegations : [];
        const executionStatus = String(tData?.execution?.status || 'unknown');
        const finalReply = String(tData?.execution?.output || `Supervisor execution #${parentExecutionId} finished with status ${executionStatus}.`);
        liveTrace = [
          {
            type: 'status',
            message: `Supervisor execution #${parentExecutionId} finished with status ${executionStatus}`,
            execution_id: parentExecutionId,
            status: executionStatus,
          },
          ...summarizeDelegationTrace(delegationRows),
          ...timelineRows.map((s: any) => ({
            type: 'timeline',
            message: `${s.stage || 'stage'} • ${s.status || 'unknown'}`,
            duration_ms: s.duration_ms,
            status: s.status,
            execution_id: s.child_execution_id ? Number(s.child_execution_id) : parentExecutionId,
          })),
        ];
        const debug: MessageDebug | undefined = (debugMode || showToolTrace)
          ? {
              executionId: parentExecutionId,
              status: executionStatus,
              usage: {
                prompt_tokens: Number(tData?.execution?.prompt_tokens || 0),
                completion_tokens: Number(tData?.execution?.completion_tokens || 0),
                cost: Number(tData?.execution?.total_cost || 0),
              },
              timeline: timelineRows,
            }
          : undefined;
        updateAssistantMessage((m) => ({
          ...m,
          content: finalReply,
          trace: liveTrace,
          debug,
        }));
        return;
      }

      const runLegacyChat = async () => {
        const fallbackRes = await fetch(`/api/agents/${agentId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            session_id: selectedSessionId || undefined,
          }),
        });
        const raw = await fallbackRes.text();
        let data: any = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        if (!fallbackRes.ok) {
          const detail = data?.error || raw || `Chat failed (HTTP ${fallbackRes.status})`;
          throw new Error(detail);
        }
        const reply = String(data?.reply || '');
        const trace: TraceEvent[] = Array.isArray(data?.logs) ? data.logs : [];
        const execId = Number(data?.execution_id || 0);
        let debug: MessageDebug | undefined = undefined;
        if ((debugMode || showToolTrace) && Number.isFinite(execId) && execId > 0) {
          try {
            const tRes = await fetch(`/api/agent-executions/${execId}/timeline`);
            const tData = await safeJson(tRes) as any;
            const timelineRows: any[] = Array.isArray(tData?.timeline) ? tData.timeline : [];
            debug = {
              executionId: execId,
              status: String(tData?.execution?.status || 'unknown'),
              usage: data?.usage || null,
              timeline: timelineRows,
            };
          } catch {
            debug = { executionId: execId, status: 'unknown', usage: data?.usage || null, timeline: [] };
          }
        }
        setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant'
          ? { ...m, content: reply || 'No response.', debug, trace }
          : m)));
        if (data?.session_id) setSelectedSessionId(String(data.session_id));
      };

      const res = await fetch(`/api/agents/${agentId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: selectedSessionId || undefined,
        }),
      });
      if (res.status === 404) {
        await runLegacyChat();
        await loadSessions(agentId);
        return;
      }
      if (!res.ok) {
        const data = await safeJson(res);
        const detail = data?.error || `Chat failed (HTTP ${res.status})`;
        throw new Error(detail);
      }

      if (!res.body) throw new Error('Streaming not supported by this browser');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let liveTrace: TraceEvent[] = [];
      let finalData: any = null;
      let execStream: EventSource | null = null;
      let execStreamStarted = false;

      const updateAssistantMessage = (updater: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant' ? updater(m) : m)));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const evt of parsed.events) {
          if (evt.event === 'session') {
            if (evt.data?.session_id) setSelectedSessionId(String(evt.data.session_id));
            continue;
          }
          if (evt.event === 'status') {
            liveTrace = [...liveTrace, { type: 'status', message: String(evt.data?.message || evt.data?.status || 'running') }];
            updateAssistantMessage((m) => ({ ...m, trace: liveTrace, content: 'Working on it…' }));
            continue;
          }
          if (evt.event === 'log') {
            const execIdFromLog = Number(evt.data?.execution_id || 0);
            if (!execStreamStarted && Number.isFinite(execIdFromLog) && execIdFromLog > 0) {
              execStreamStarted = true;
              execStream = new EventSource(`/api/agent-executions/${execIdFromLog}/stream`);
              execStream.addEventListener('update', (e: MessageEvent) => {
                try {
                  const payload = JSON.parse(String(e.data || '{}'));
                  liveTrace = appendToolSnapshotTrace(liveTrace, payload?.tools || []);
                  updateAssistantMessage((m) => ({ ...m, trace: liveTrace, content: 'Working on it…' }));
                } catch {
                  // ignore malformed snapshots
                }
              });
              execStream.addEventListener('done', () => {
                execStream?.close();
                execStream = null;
              });
              execStream.addEventListener('error', () => {
                execStream?.close();
                execStream = null;
              });
            }
            liveTrace = [...liveTrace, evt.data || {}];
            updateAssistantMessage((m) => ({ ...m, trace: liveTrace, content: 'Working on it…' }));
            continue;
          }
          if (evt.event === 'done') {
            finalData = evt.data || {};
            continue;
          }
          if (evt.event === 'error') {
            throw new Error(evt.data?.error || 'Chat failed');
          }
        }
      }
      if (execStream) {
        execStream.close();
      }

      const reply = String(finalData?.reply || '');
      const execId = Number(finalData?.execution_id || 0);
      let debug: MessageDebug | undefined = undefined;
      if ((debugMode || showToolTrace) && Number.isFinite(execId) && execId > 0) {
        try {
          const tRes = await fetch(`/api/agent-executions/${execId}/timeline`);
          const tData = await safeJson(tRes) as any;
          const timelineRows: any[] = Array.isArray(tData?.timeline) ? tData.timeline : [];
          if (!liveTrace.length && timelineRows.length) {
            liveTrace = timelineRows.map((s: any) => ({
              type: 'timeline',
              message: `${s.stage || 'stage'} • ${s.status || 'unknown'}`,
              tool: typeof s.stage === 'string' && s.stage.startsWith('tool:') ? s.stage.replace(/^tool:/, '') : undefined,
              duration_ms: s.duration_ms,
              status: s.status,
            }));
          }
          debug = {
            executionId: execId,
            status: String(tData?.execution?.status || 'unknown'),
            usage: finalData?.usage || null,
            timeline: timelineRows,
          };
        } catch {
          debug = { executionId: execId, status: 'unknown', usage: finalData?.usage || null, timeline: [] };
        }
      }
      updateAssistantMessage((m) => ({ ...m, content: reply || 'No response.', debug, trace: liveTrace }));
      if (finalData?.session_id) setSelectedSessionId(String(finalData.session_id));
      await loadSessions(agentId);
    } catch (e: any) {
      const msg = e?.message || 'Chat failed';
      setError(msg);
      setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant' ? { ...m, content: `ERROR: ${msg}` } : m)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 h-[calc(100vh-9.5rem)] flex flex-col">
      <div className="swarm-hero p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
            <Sparkles size={12} />
            Conversation Runtime
          </div>
          <h1 className="text-3xl font-black text-white">Agent Chat</h1>
          <p className="text-slate-300 mt-1">Live conversations, delegated runs, and execution traces in one console.</p>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <div className="telemetry-tile px-4 py-3 min-w-[140px]">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Delegates</div>
            <div className="mt-1 text-2xl font-black text-white">{delegateAgentIds.length}</div>
          </div>
          <div className="telemetry-tile px-4 py-3 min-w-[140px]">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Sessions</div>
            <div className="mt-1 text-2xl font-black text-white">{sessions.length}</div>
          </div>
        </div>
      </div>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">
        <section className="col-span-12 lg:col-span-4 xl:col-span-3 panel-chrome bg-white/85 rounded-2xl border border-slate-200 p-4 flex flex-col min-h-0">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</label>
          <div className="relative mt-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm"
            />
          </div>
          <select
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedAgentId ?? ''}
            onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : null)}
          >
            {filteredAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <button
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3 py-2 hover:bg-indigo-700"
            onClick={startNewChat}
          >
            <Plus size={14} /> New Chat
          </button>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={supervisorMode}
                onChange={(e) => setSupervisorMode(e.target.checked)}
              />
              <GitBranch size={14} className="text-violet-600" />
              Supervisor Mode
            </label>
            <p className="mt-2 text-xs text-slate-500">
              When enabled, the selected agent coordinates delegate agents in the background and streams their progress here.
            </p>
            {supervisorMode && (
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-700">
                {delegateAgentIds.length
                  ? `${delegateAgentIds.length} delegates selected for the next supervisor run.`
                  : 'Select delegate agents to activate supervisor mode.'}
              </div>
            )}
            {supervisorMode && (
              <div className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                {!delegateCandidates.length && (
                  <div className="text-xs text-slate-500">Create more agents to use delegation.</div>
                )}
                {delegateCandidates.map((agent) => (
                  <label key={agent.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={delegateAgentIds.includes(agent.id)}
                      onChange={() => toggleDelegateAgent(agent.id)}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">{agent.name}</div>
                      <div className="text-slate-500">{agent.role || 'Delegate agent'}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">History</div>
          <div className="mt-2 space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
            {loading && <div className="text-xs text-slate-500">Loading…</div>}
            {!loading && sessions.length === 0 && <div className="text-xs text-slate-500">No saved chats yet.</div>}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => selectedAgentId && loadMessages(selectedAgentId, s.id)}
                className={`w-full text-left rounded-lg border px-3 py-2 ${
                  selectedSessionId === s.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-semibold text-slate-800 truncate">{s.user_id || s.id.slice(0, 12)}</div>
                <div className="text-xs text-slate-500 truncate mt-1">{s.preview || 'No preview'}</div>
                <div className="text-[11px] text-slate-400 mt-1">{s.message_count || 0} messages</div>
              </button>
            ))}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8 xl:col-span-9 panel-chrome bg-white/85 rounded-2xl border border-slate-200 p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2 min-w-0">
            <MessageSquare size={16} className="text-indigo-600" />
            <div className="text-sm font-semibold text-slate-900">{selectedAgent?.name || 'Select an agent'}</div>
            {selectedSessionId && <div className="text-xs text-slate-500">Session: {selectedSessionId}</div>}
            {supervisorMode && (
              <div className="text-xs px-2 py-1 rounded-full bg-violet-100 text-violet-700">
                Supervisor mode
              </div>
            )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden md:flex items-center gap-1 text-xs text-slate-500">
                <Activity size={12} />
                {messages.length} messages
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={showToolTrace}
                  onChange={(e) => setShowToolTrace(e.target.checked)}
                />
                Tool Trace
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                />
                Debug Inference
              </label>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-3">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                Start a new conversation with {selectedAgent?.name || 'an agent'}.
              </div>
            )}
            {messages.map((m, idx) => (
              <div key={`${m.ts || 'm'}-${idx}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm border ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-white text-slate-800 border-slate-200'
                }`}>
                  <div className="flex items-center gap-2 text-[11px] opacity-80 mb-1">
                    {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                    {m.role === 'user' ? 'You' : 'Agent'}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.role === 'assistant' && m.debug?.executionId ? (
                    <div className="mt-2">
                      <Link
                        to={`/agent-executions/${m.debug.executionId}`}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
                      >
                        <ExternalLink size={12} />
                        Open Execution #{m.debug.executionId}
                      </Link>
                    </div>
                  ) : null}
                  {showToolTrace && m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length > 0 && (
                    <details className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-slate-700" open>
                      <summary className="cursor-pointer text-xs font-semibold text-indigo-700">Agent Activity</summary>
                      <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto pr-1">
                        {m.trace.map((evt: any, tidx: number) => (
                          <div key={`trace-${tidx}`} className="text-[11px] border border-indigo-100 bg-white rounded px-2 py-1.5">
                            {evt.type === 'tool_call' && (
                              <div>
                                <span className="font-semibold text-indigo-700">Tool Call:</span> {evt.tool}
                                <div className="font-mono text-slate-600 mt-0.5 break-all">{JSON.stringify(evt.args || {})}</div>
                              </div>
                            )}
                            {evt.type === 'tool_result' && (
                              <div>
                                <span className="font-semibold text-emerald-700">Tool Result:</span> {evt.tool}
                                <div className="font-mono text-slate-600 mt-0.5 break-all">{String(evt.result || '')}</div>
                                {evt.duration_ms != null && <div className="text-[10px] text-slate-500 mt-1">Duration: {evt.duration_ms}ms</div>}
                              </div>
                            )}
                            {evt.type === 'thinking' && <div><span className="font-semibold text-blue-700">Thinking:</span> {evt.message}</div>}
                            {evt.type === 'thought' && <div><span className="font-semibold text-violet-700">Thought:</span> {evt.message}</div>}
                            {evt.type === 'status' && <div><span className="font-semibold text-cyan-700">Status:</span> {evt.message}</div>}
                            {evt.type === 'warning' && <div><span className="font-semibold text-amber-700">Warning:</span> {evt.message}</div>}
                            {evt.type === 'error' && <div><span className="font-semibold text-red-700">Error:</span> {evt.message}</div>}
                            {evt.type === 'timeline' && (
                              <div>
                                <span className="font-semibold text-slate-700">Stage:</span> {evt.message}
                                {evt.duration_ms != null && <span className="ml-2 text-[10px] text-slate-500">{evt.duration_ms}ms</span>}
                              </div>
                            )}
                            {evt.type === 'delegation' && (
                              <div>
                                <span className="font-semibold text-violet-700">Delegation:</span> {evt.message}
                                {evt.execution_id ? (
                                  <Link to={`/agent-executions/${evt.execution_id}`} className="ml-2 text-[10px] text-indigo-700 hover:text-indigo-900">
                                    open #{evt.execution_id}
                                  </Link>
                                ) : null}
                                {evt.result ? <div className="font-mono text-slate-600 mt-0.5 break-all">{String(evt.result)}</div> : null}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {debugMode && m.role === 'assistant' && m.debug && (
                    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Inference Debug</summary>
                      <div className="mt-2 text-[11px] space-y-1.5">
                        <div>Execution: <span className="font-mono">{m.debug.executionId ?? '-'}</span> • Status: <span className="font-semibold">{m.debug.status}</span></div>
                        <div>
                          Usage: <span className="font-mono">prompt {Number(m.debug?.usage?.prompt_tokens || 0).toLocaleString()}</span>,{' '}
                          <span className="font-mono">completion {Number(m.debug?.usage?.completion_tokens || 0).toLocaleString()}</span>,{' '}
                          <span className="font-mono">cost ${Number(m.debug?.usage?.cost || 0).toFixed(6)}</span>
                        </div>
                        <div className="pt-1">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Timeline</div>
                          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                            {(m.debug.timeline || []).map((step: any, sidx: number) => (
                              <div key={`${step.stage || 'step'}-${sidx}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                                <span className="truncate">{step.stage || 'stage'}</span>
                                <span className="font-mono text-slate-500">{step.duration_ms != null ? `${step.duration_ms}ms` : step.status || '-'}</span>
                              </div>
                            ))}
                            {(!m.debug.timeline || !m.debug.timeline.length) && (
                              <div className="text-slate-500">No timeline details available.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-200">
            {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Type your message... (Shift+Enter for newline)"
                className="flex-1 min-h-[72px] max-h-44 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim() || !selectedAgentId || sending || (supervisorMode && !delegateAgentIds.length)}
                className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-sm disabled:opacity-60 flex items-center gap-2"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
