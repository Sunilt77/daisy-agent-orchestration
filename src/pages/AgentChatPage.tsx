import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare, Plus, Send, Bot, User, Loader2, GitBranch, ExternalLink,
  Search, Sparkles, Activity, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Zap, Network, ArrowRight, Paperclip, X, ThumbsUp, ThumbsDown,
  PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2,
} from 'lucide-react';
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
type DelegationStatus = {
  agentId: number;
  agentName: string;
  role: 'delegate' | 'synthesis';
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | string;
  result?: string;
  error?: string;
  executionId?: number | null;
};
type LiveDelegation = {
  parentExecutionId: number;
  supervisorStatus: string;
  delegates: DelegationStatus[];
  startedAt: number;
};
type ChatAttachment = {
  id: string;
  kind: 'image' | 'audio' | 'pdf' | 'file';
  name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  url: string;
};
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  ts?: string;
  debug?: MessageDebug;
  trace?: TraceEvent[];
  delegation?: LiveDelegation;
  attachments?: ChatAttachment[];
};
type DebugUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
type DebugStep = { stage?: string; status?: string; duration_ms?: number; error?: string | null; at?: string };
type MessageDebug = {
  executionId: number | null;
  status: string;
  usage: DebugUsage;
  timeline: DebugStep[];
};
type FeedbackState = {
  status: 'saving' | 'saved' | 'error';
  rating?: 'up' | 'down';
  error?: string;
};

const SESSION_PAGE_SIZE = 12;

function formatSessionBucket(input?: string) {
  if (!input) return 'Earlier';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Last 7 Days';
  return 'Earlier';
}

function formatSessionTimestamp(input?: string) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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

function parseDelegationsToLive(delegations: any[], parentExecutionId: number, supervisorStatus: string): LiveDelegation {
  return {
    parentExecutionId,
    supervisorStatus,
    startedAt: Date.now(),
    delegates: (Array.isArray(delegations) ? delegations : []).map((d: any) => ({
      agentId: Number(d.agent_id || 0),
      agentName: d.agent_name || `Agent ${d.agent_id}`,
      role: d.role === 'synthesis' ? 'synthesis' : 'delegate',
      title: d.title || d.agent_name || `Agent ${d.agent_id}`,
      status: d.status || 'queued',
      result: d.result || undefined,
      error: d.error || undefined,
      executionId: d.child_execution_id ? Number(d.child_execution_id) : null,
    })),
  };
}

function compactDelegationText(value?: string, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function buildDelegationStatusCopy(delegation: LiveDelegation) {
  const delegateRows = delegation.delegates.filter((d) => d.role === 'delegate');
  const completed = delegateRows.filter((d) => d.status === 'completed');
  const running = delegateRows.filter((d) => d.status === 'running');
  const failed = delegateRows.filter((d) => d.status === 'failed');

  if (delegation.supervisorStatus === 'running') {
    if (running.length > 0) {
      return `Specialists are working: ${running.map((d) => d.agentName).join(', ')}.`;
    }
    if (delegateRows.length > 0) {
      return `Supervisor is coordinating ${delegateRows.length} specialist${delegateRows.length === 1 ? '' : 's'}.`;
    }
    return 'Supervisor is preparing the handoff.';
  }

  if (completed.length > 0 && failed.length === 0) {
    return `Specialist handoff complete. ${completed.length} delegate result${completed.length === 1 ? '' : 's'} returned to the supervisor.`;
  }

  if (completed.length > 0 && failed.length > 0) {
    return `Partial handoff complete. ${completed.length} delegate result${completed.length === 1 ? '' : 's'} succeeded and ${failed.length} failed.`;
  }

  if (failed.length > 0) {
    return `Delegation ended with ${failed.length} failed specialist step${failed.length === 1 ? '' : 's'}.`;
  }

  return `Delegation ${delegation.supervisorStatus}.`;
}

function DelegationHandoffFeed({ delegation }: { delegation: LiveDelegation }) {
  const items = delegation.delegates.filter((d) => d.role === 'delegate' || d.role === 'synthesis');
  if (!items.length) return null;

  return (
    <div className="mt-3 rounded-2xl border border-indigo-200/70 bg-indigo-50/70 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100 bg-white/60">
        <GitBranch size={13} className="text-indigo-500" />
        <span className="text-[11px] font-black text-indigo-700 uppercase tracking-[0.2em]">Handoff Feed</span>
      </div>
      <div className="divide-y divide-indigo-100/80">
        {items.map((item, idx) => {
          const preview = compactDelegationText(item.result || item.error || '');
          const statusTone =
            item.status === 'completed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
            item.status === 'failed' ? 'text-red-700 bg-red-50 border-red-200' :
            item.status === 'canceled' ? 'text-amber-700 bg-amber-50 border-amber-200' :
            item.status === 'running' ? 'text-indigo-700 bg-indigo-50 border-indigo-200' :
            'text-slate-600 bg-slate-50 border-slate-200';
          return (
            <div key={`${item.agentId}-${idx}-${item.title}`} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <DelegationStatusIcon status={item.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-bold text-slate-900">{item.agentName}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${statusTone}`}>
                      {item.role === 'synthesis' ? 'synthesis' : item.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{item.title}</div>
                  {preview && (
                    <div className={`mt-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${
                      item.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-700'
                    }`}>
                      {preview}
                    </div>
                  )}
                  {!preview && item.status === 'running' && (
                    <div className="mt-2 text-[11px] text-slate-500">Working on the delegated task…</div>
                  )}
                </div>
                {item.executionId ? (
                  <Link
                    to={`/agent-executions/${item.executionId}`}
                    className="shrink-0 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    View
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Delegation Tree Visualizer ───────────────────────────────────────────────
function DelegationStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-500 shrink-0" />;
  if (status === 'canceled') return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  if (status === 'running') return <Loader2 size={14} className="text-brand-400 animate-spin shrink-0" />;
  return <Clock size={14} className="text-slate-400 shrink-0" />;
}

function DelegateCard({ d, idx }: { d: DelegationStatus; idx: number; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  const isSynth = d.role === 'synthesis';
  const statusColor =
    d.status === 'completed' ? 'border-emerald-500/40 bg-emerald-500/5' :
    d.status === 'failed' ? 'border-red-500/40 bg-red-500/5' :
    d.status === 'canceled' ? 'border-amber-500/30 bg-amber-500/5' :
    d.status === 'running' ? 'border-brand-500/50 bg-brand-500/5 shadow-[0_0_16px_rgba(99,102,241,0.12)]' :
    'border-slate-600/30 bg-slate-800/20';

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 transition-all duration-300 ${statusColor}`}
      style={{ animationDelay: `${idx * 80}ms` }}
    >
      <div className="flex items-center gap-2">
        <DelegationStatusIcon status={d.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {isSynth && <Sparkles size={11} className="text-violet-400 shrink-0" />}
            <span className="text-[12px] font-bold text-white truncate">{d.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest shrink-0 ${
              isSynth ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-700/50 text-slate-400'
            }`}>
              {isSynth ? 'synthesis' : 'delegate'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-semibold truncate">{d.agentName}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {d.executionId && (
            <Link
              to={`/agent-executions/${d.executionId}`}
              className="text-[10px] text-brand-400 hover:text-brand-300 font-mono flex items-center gap-1"
            >
              <ExternalLink size={10} /> #{d.executionId}
            </Link>
          )}
          {(d.result || d.error) && (
            <button onClick={() => setOpen((v) => !v)} className="text-slate-500 hover:text-slate-300 transition-colors">
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
        </div>
      </div>
      {open && (d.result || d.error) && (
        <div className={`mt-2 rounded-lg p-2 text-[11px] font-mono break-all leading-relaxed max-h-28 overflow-y-auto ${
          d.error ? 'bg-red-950/40 text-red-300 border border-red-900/30' : 'bg-slate-950/40 text-slate-300 border border-slate-700/30'
        }`}>
          {d.error || d.result}
        </div>
      )}
    </div>
  );
}

function DelegationTree({ delegation, agents }: { delegation: LiveDelegation; agents: Agent[] }) {
  const done = delegation.delegates.filter((d) => d.status === 'completed' || d.status === 'failed' || d.status === 'canceled').length;
  const total = delegation.delegates.filter((d) => d.role === 'delegate').length;
  const synthDone = delegation.delegates.filter((d) => d.role === 'synthesis' && d.status === 'completed').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const supervisorStatus = delegation.supervisorStatus;

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-brand-400" />
          <span className="text-[12px] font-black text-white uppercase tracking-widest">Delegation Tree</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <DelegationStatusIcon status={supervisorStatus} />
          <span className="text-[11px] font-bold text-slate-300 capitalize">{supervisorStatus}</span>
          <span className="text-[10px] text-slate-500 ml-2 font-mono">exec #{delegation.parentExecutionId}</span>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="px-4 py-2 border-b border-white/5 bg-black/20">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Delegates {done}/{total}
              {synthDone > 0 && ' · Synthesis ✓'}
            </span>
            <span className="text-[11px] font-black text-brand-300">{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-linear-to-r from-brand-500 to-cyan-400 transition-all duration-700 shadow-[0_0_12px_rgba(99,102,241,0.5)]"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Agents */}
      <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
        {/* Supervisor row */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-500/10 border border-brand-500/20">
          <Zap size={13} className="text-brand-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-black text-brand-200">Supervisor Agent</div>
            <div className="text-[11px] text-slate-400">Coordinates and synthesizes results</div>
          </div>
          <DelegationStatusIcon status={supervisorStatus} />
        </div>

        {/* Arrow */}
        {delegation.delegates.length > 0 && (
          <div className="flex justify-center py-1">
            <ArrowRight size={12} className="text-slate-600 rotate-90" />
          </div>
        )}

        {/* Delegate + synthesis cards */}
        {delegation.delegates.map((d, idx) => {
          const delegateKey = `${d.agentId}-${idx}`;
          return <DelegateCard key={delegateKey} d={d} idx={idx} />;
        })}

        {delegation.delegates.length === 0 && (
          <div className="text-center py-4 text-[12px] text-slate-500">Waiting for delegates to be assigned…</div>
        )}
      </div>
    </div>
  );
}

// ─── Trace Event Row ────────────────────────────────────────────────────────
function TraceRow({ evt }: { evt: any; key?: React.Key }) {
  if (evt.type === 'tool_call') return (
    <div className="flex gap-2 text-[11px] border border-indigo-900/40 bg-indigo-950/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-indigo-400 shrink-0">TOOL↗</span>
      <span className="font-mono text-indigo-200 truncate">{evt.tool}</span>
      {evt.args && <span className="text-slate-500 truncate">{JSON.stringify(evt.args)}</span>}
    </div>
  );
  if (evt.type === 'tool_result') return (
    <div className="flex gap-2 text-[11px] border border-emerald-900/40 bg-emerald-950/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-emerald-400 shrink-0">TOOL✓</span>
      <span className="font-mono text-emerald-200 truncate">{evt.tool}</span>
      {evt.duration_ms != null && <span className="text-slate-500 ml-auto shrink-0">{evt.duration_ms}ms</span>}
    </div>
  );
  if (evt.type === 'thinking' || evt.type === 'thought') return (
    <div className="flex gap-2 text-[11px] border border-violet-900/40 bg-violet-950/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-violet-400 shrink-0">THINK</span>
      <span className="text-slate-300 line-clamp-2">{evt.message}</span>
    </div>
  );
  if (evt.type === 'status') return (
    <div className="flex gap-2 text-[11px] border border-cyan-900/30 bg-cyan-950/20 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-cyan-500 shrink-0">INFO</span>
      <span className="text-slate-300">{evt.message}</span>
    </div>
  );
  if (evt.type === 'timeline') return (
    <div className="flex gap-2 text-[11px] border border-slate-700/40 bg-slate-800/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-slate-400 shrink-0">STAGE</span>
      <span className="text-slate-300 flex-1 truncate">{evt.message}</span>
      {evt.duration_ms != null && <span className="text-slate-500 shrink-0">{evt.duration_ms}ms</span>}
    </div>
  );
  if (evt.type === 'warning') return (
    <div className="flex gap-2 text-[11px] border border-amber-900/40 bg-amber-950/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-amber-400 shrink-0">WARN</span>
      <span className="text-slate-300">{evt.message}</span>
    </div>
  );
  if (evt.type === 'error') return (
    <div className="flex gap-2 text-[11px] border border-red-900/40 bg-red-950/30 rounded-lg px-2.5 py-1.5">
      <span className="font-black text-red-400 shrink-0">ERR</span>
      <span className="text-red-300">{evt.message}</span>
    </div>
  );
  return null;
}

// ─── Main Component ────────────────────────────────────────────────────────
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
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [feedbackByExecution, setFeedbackByExecution] = useState<Record<number, FeedbackState>>({});
  const [sessionPage, setSessionPage] = useState(1);
  const [historyHidden, setHistoryHidden] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const loadedSessionKeyRef = useRef<string>('');
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const traceEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  // Auto-scroll messages to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-scroll trace panel to bottom during active streaming
  useEffect(() => {
    if (sending) {
      traceEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages, sending]);

  const deferredAgentSearch = useDeferredValue(agentSearch);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const delegateCandidates = useMemo(
    () => agents.filter((a) => a.id !== selectedAgentId),
    [agents, selectedAgentId]
  );
  const filteredAgents = useMemo(
    () => agents.filter((a) => `${a.name} ${a.role || ''}`.toLowerCase().includes(deferredAgentSearch.trim().toLowerCase())),
    [agents, deferredAgentSearch]
  );
  const visibleSessions = useMemo(
    () => sessions.slice(0, sessionPage * SESSION_PAGE_SIZE),
    [sessions, sessionPage]
  );
  const hasMoreSessions = visibleSessions.length < sessions.length;
  const groupedVisibleSessions = useMemo(() => {
    const groups: Array<{ label: string; items: SessionSummary[] }> = [];
    for (const session of visibleSessions) {
      const label = formatSessionBucket(session.last_seen_at || session.created_at);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.label !== label) {
        groups.push({ label, items: [session] });
      } else {
        lastGroup.items.push(session);
      }
    }
    return groups;
  }, [visibleSessions]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );
  const chatModeLabel = selectedSessionId ? 'Continuing selected chat' : 'Fresh chat ready';
  const chatColumnClass = historyHidden || focusMode ? 'col-span-12' : 'col-span-12 lg:col-span-9 xl:col-span-9';

  const loadAgents = async () => {
    const res = await fetch('/api/agents');
    const data = await safeJson(res);
    if (Array.isArray(data)) {
      setAgents(data);
      setSelectedAgentId((current) => {
        if (current && data.some((agent) => agent.id === current)) return current;
        return data.length ? data[0].id : null;
      });
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
      if (Array.isArray(persisted.draftAttachments)) setDraftAttachments(persisted.draftAttachments);
      if (typeof persisted.historyHidden === 'boolean') setHistoryHidden(persisted.historyHidden);
      if (typeof persisted.focusMode === 'boolean') setFocusMode(persisted.focusMode);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    savePersisted(AGENT_CHAT_UI_KEY, {
      selectedAgentId, selectedSessionId, debugMode, showToolTrace, supervisorMode, delegateAgentIds, draft, draftAttachments, historyHidden, focusMode,
    });
  }, [stateReady, selectedAgentId, selectedSessionId, debugMode, showToolTrace, supervisorMode, delegateAgentIds, draft, draftAttachments, historyHidden, focusMode]);

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
    setDraftAttachments([]);
    setSessionPage(1);
    loadedSessionKeyRef.current = '';
    setDelegateAgentIds((prev) => prev.filter((id) => id !== selectedAgentId));
    loadSessions(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (sendingRef.current) return;
    if (!selectedSessionId) {
      return;
    }
    if (!sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(null);
      setMessages([]);
      loadedSessionKeyRef.current = '';
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
      if (selectedSessionId) await loadMessages(selectedAgentId, selectedSessionId, true);
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
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
    setDraftAttachments([]);
    setError('');
    loadedSessionKeyRef.current = '';
  };

  const toggleDelegateAgent = (agentId: number) => {
    setDelegateAgentIds((prev) => prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]);
  };

  const uploadDraftAttachments = async (files: FileList | null) => {
    if (!selectedAgentId || !files?.length) return;
    setError('');
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      const res = await fetch(`/api/agents/${selectedAgentId}/attachments`, {
        method: 'POST',
        body: form,
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || 'Failed to upload attachments');
      const uploaded = Array.isArray(data?.attachments) ? data.attachments : [];
      setDraftAttachments((prev) => [...prev, ...uploaded]);
    } catch (e: any) {
      setError(e?.message || 'Failed to upload attachments');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const sendMessage = async () => {
    const agentId = selectedAgentId;
    const text = draft.trim();
    if (!agentId || (!text && !draftAttachments.length) || sending) return;
    const outgoingText = text || 'Please use the attached file(s) as part of this request.';
    const now = new Date().toISOString();
    const outgoingAttachments = [...draftAttachments];
    setDraft('');
    setDraftAttachments([]);
    setSending(true);
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: outgoingText, ts: now, attachments: outgoingAttachments }]);
    const assistantTs = new Date().toISOString();
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Working on it…', ts: assistantTs, trace: [] }]);

    try {
      if (supervisorMode) {
        if (!delegateAgentIds.length) throw new Error('Select at least one delegate agent for supervisor mode');
        const kickoffRes = await fetch(`/api/agents/${agentId}/delegate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: outgoingText, delegate_agent_ids: delegateAgentIds, synthesize: true, wait: false, attachments: outgoingAttachments }),
        });
        const kickoffData = await safeJson(kickoffRes) as any;
        if (!kickoffRes.ok) throw new Error(kickoffData?.error || `Supervisor launch failed (HTTP ${kickoffRes.status})`);
        const parentExecutionId = Number(kickoffData?.parent_execution_id || 0);
        if (!Number.isFinite(parentExecutionId) || parentExecutionId <= 0) throw new Error('Supervisor launch did not return a parent execution id');

        let liveDelegation: LiveDelegation = {
          parentExecutionId,
          supervisorStatus: 'running',
          delegates: delegateAgentIds.map((id) => {
            const a = agents.find((ag) => ag.id === id);
            return { agentId: id, agentName: a?.name || `Agent ${id}`, role: 'delegate', title: a?.name || `Agent ${id}`, status: 'queued' };
          }),
          startedAt: Date.now(),
        };

        const updateAssistantMessage = (updater: (m: ChatMessage) => ChatMessage) => {
          setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant' ? updater(m) : m)));
        };
        updateAssistantMessage((m) => ({
          ...m,
          delegation: liveDelegation,
          content: `Supervisor run started. ${buildDelegationStatusCopy(liveDelegation)} Execution #${parentExecutionId}.`,
        }));

        await new Promise<void>((resolve) => {
          const es = new EventSource(`/api/agent-executions/${parentExecutionId}/stream`);
          const timeout = setTimeout(() => {
            es.close();
            resolve();
          }, 180000); // 3 minute timeout for supervisor delegation
          
          const cleanup = () => {
            clearTimeout(timeout);
            try { es.close(); } catch { /* ignore */ }
          };
          
          es.addEventListener('update', (event: MessageEvent) => {
            try {
              const payload = JSON.parse(String(event.data || '{}'));
              liveDelegation = parseDelegationsToLive(
                payload?.delegations || [],
                parentExecutionId,
                payload?.execution?.status || 'running',
              );
              updateAssistantMessage((m) => ({
                ...m,
                delegation: { ...liveDelegation },
                content: `${buildDelegationStatusCopy(liveDelegation)} Execution #${parentExecutionId}.`,
              }));
            } catch { /* ignore */ }
          });
          es.addEventListener('done', () => { cleanup(); resolve(); });
          es.addEventListener('error', () => { cleanup(); resolve(); });
        });

        const tRes = await fetch(`/api/agent-executions/${parentExecutionId}/timeline`);
        const tData = await safeJson(tRes) as any;
        const delegationRows: any[] = Array.isArray(tData?.delegations) ? tData.delegations : [];
        const executionStatus = String(tData?.execution?.status || 'unknown');
        const finalReply = String(tData?.execution?.output || `Supervisor execution #${parentExecutionId} finished with status ${executionStatus}.`);
        const finalDelegation = parseDelegationsToLive(delegationRows, parentExecutionId, executionStatus);
        const debug: MessageDebug | undefined = (debugMode || showToolTrace) ? {
          executionId: parentExecutionId,
          status: executionStatus,
          usage: { prompt_tokens: Number(tData?.execution?.prompt_tokens || 0), completion_tokens: Number(tData?.execution?.completion_tokens || 0), cost: Number(tData?.execution?.total_cost || 0) },
          timeline: Array.isArray(tData?.timeline) ? tData.timeline : [],
        } : undefined;
        const decoratedReply = finalReply.trim()
          ? `${buildDelegationStatusCopy(finalDelegation)}\n\n${finalReply}`
          : buildDelegationStatusCopy(finalDelegation);
        updateAssistantMessage((m) => ({ ...m, content: decoratedReply, delegation: finalDelegation, debug }));
        return;
      }

      const runLegacyChat = async () => {
        const fallbackRes = await fetch(`/api/agents/${agentId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: outgoingText, session_id: selectedSessionId || undefined, attachments: outgoingAttachments }),
        });
        const raw = await fallbackRes.text();
        let data: any = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        if (!fallbackRes.ok) throw new Error(data?.error || raw || `Chat failed (HTTP ${fallbackRes.status})`);
        const reply = String(data?.reply || '');
        const trace: TraceEvent[] = Array.isArray(data?.logs) ? data.logs : [];
        const execId = Number(data?.execution_id || 0);
        let debug: MessageDebug | undefined = undefined;
        if ((debugMode || showToolTrace) && Number.isFinite(execId) && execId > 0) {
          try {
            const tRes = await fetch(`/api/agent-executions/${execId}/timeline`);
            const tData = await safeJson(tRes) as any;
            debug = { executionId: execId, status: String(tData?.execution?.status || 'unknown'), usage: data?.usage || null, timeline: Array.isArray(tData?.timeline) ? tData.timeline : [] };
          } catch { debug = { executionId: execId, status: 'unknown', usage: data?.usage || null, timeline: [] }; }
        }
        setMessages((prev) => prev.map((m) => (m.ts === assistantTs && m.role === 'assistant' ? { ...m, content: reply || 'No response.', debug, trace } : m)));
        if (data?.session_id) setSelectedSessionId(String(data.session_id));
      };

      const res = await fetch(`/api/agents/${agentId}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: outgoingText, session_id: selectedSessionId || undefined, attachments: outgoingAttachments }),
      });
      if (res.status === 404) { await runLegacyChat(); await loadSessions(agentId); return; }
      if (!res.ok) { const data = await safeJson(res); throw new Error(data?.error || `Chat failed (HTTP ${res.status})`); }
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

      const closeExecStream = () => {
        if (execStream) {
          try { execStream.close(); } catch { /* ignore */ }
          execStream = null;
        }
      };

      try {
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
                  } catch { /* ignore */ }
                });
                execStream.addEventListener('done', () => { closeExecStream(); });
                execStream.addEventListener('error', () => { closeExecStream(); });
              }
              liveTrace = [...liveTrace, evt.data || {}];
              updateAssistantMessage((m) => ({ ...m, trace: liveTrace, content: 'Working on it…' }));
              continue;
            }
            if (evt.event === 'done') { finalData = evt.data || {}; continue; }
            if (evt.event === 'error') throw new Error(evt.data?.error || 'Chat failed');
          }
        }
      } finally {
        closeExecStream();
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
          debug = { executionId: execId, status: String(tData?.execution?.status || 'unknown'), usage: finalData?.usage || null, timeline: timelineRows };
        } catch { debug = { executionId: execId, status: 'unknown', usage: finalData?.usage || null, timeline: [] }; }
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

  const submitExecutionFeedback = async (executionId: number, rating: 'up' | 'down') => {
    setFeedbackByExecution((prev) => ({
      ...prev,
      [executionId]: { status: 'saving', rating },
    }));
    try {
      const feedback = rating === 'down'
        ? window.prompt('What should the agent do differently next time?', '')?.trim() || ''
        : '';
      const res = await fetch(`/api/agent-executions/${executionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          solved: rating === 'up',
          feedback: feedback || undefined,
        }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data?.error || 'Failed to save feedback');
      setFeedbackByExecution((prev) => ({
        ...prev,
        [executionId]: { status: 'saved', rating },
      }));
    } catch (e: any) {
      setFeedbackByExecution((prev) => ({
        ...prev,
        [executionId]: { status: 'error', rating, error: e?.message || 'Failed to save feedback' },
      }));
    }
  };

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col">
      {/* Hero header */}
      <div className="swarm-hero p-6 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">Agent Chat</h1>
            <p className="text-slate-300 mt-1 text-sm">Live conversations, delegated runs, and real-time delegation trees.</p>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="telemetry-tile px-4 py-3 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Delegates</div>
              <div className="mt-1 text-2xl font-black text-white">{delegateAgentIds.length}</div>
            </div>
            <div className="telemetry-tile px-4 py-3 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Sessions</div>
              <div className="mt-1 text-2xl font-black text-white">{sessions.length}</div>
            </div>
            <div className="telemetry-tile px-4 py-3 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Messages</div>
              <div className="mt-1 text-2xl font-black text-white">{messages.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        {!historyHidden && !focusMode && (
        <section className="col-span-12 lg:col-span-3 xl:col-span-3 panel-chrome bg-white/85 rounded-2xl border border-slate-200 p-4 flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent Workspace</label>
            <div className="relative mt-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Search agents..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-8 text-sm"
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

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Current Mode</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{chatModeLabel}</div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedSession
                  ? `${selectedSession.message_count || 0} messages in this thread • last active ${formatSessionTimestamp(selectedSession.last_seen_at || selectedSession.created_at)}`
                  : 'Send a message to start a brand new conversation for this agent.'}
              </div>
            </div>

            <button
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3 py-2 hover:bg-indigo-700 transition-colors"
              onClick={startNewChat}
            >
              <Plus size={14} /> New Chat
            </button>
          </div>

          {/* Supervisor mode */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 shrink-0">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={supervisorMode}
                onChange={(e) => setSupervisorMode(e.target.checked)}
              />
              <GitBranch size={14} className="text-violet-600" />
              Supervisor Mode
            </label>
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
              Master agent delegates to specialists. Live tree shown in chat.
            </p>
            {supervisorMode && (
              <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 font-semibold">
                {delegateAgentIds.length ? `${delegateAgentIds.length} delegate${delegateAgentIds.length > 1 ? 's' : ''} selected` : 'Select delegate agents below'}
              </div>
            )}
            {supervisorMode && (
              <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {!delegateCandidates.length && <div className="text-xs text-slate-500">Create more agents to use delegation.</div>}
                {delegateCandidates.map((agent) => (
                  <label key={agent.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={delegateAgentIds.includes(agent.id)}
                      onChange={() => toggleDelegateAgent(agent.id)}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{agent.name}</div>
                      <div className="text-slate-500 truncate">{agent.role || 'Specialist'}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Session history */}
          <div className="mt-4 flex items-center justify-between gap-2 shrink-0">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Chats</div>
            <div className="text-[11px] text-slate-400">{sessions.length} total</div>
          </div>
          <div className="mt-2 space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-0.5">
            {loading && <div className="text-xs text-slate-500 text-center py-4">Loading…</div>}
            {!loading && sessions.length === 0 && <div className="text-xs text-slate-500 text-center py-4">No saved chats yet.</div>}
            {groupedVisibleSessions.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <div className="sticky top-0 z-10 bg-white/85 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                  {group.label}
                </div>
                {group.items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectedAgentId && loadMessages(selectedAgentId, s.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                      selectedSessionId === s.id ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold truncate">{s.user_id || s.id.slice(0, 12)}</div>
                      {selectedSessionId === s.id ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">Open</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">{s.preview || 'No preview'}</div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>{s.message_count || 0} messages</span>
                      <span>{formatSessionTimestamp(s.last_seen_at || s.created_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {!loading && hasMoreSessions && (
              <button
                type="button"
                onClick={() => setSessionPage((prev) => prev + 1)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Show More Chats
              </button>
            )}
          </div>
        </section>
        )}

        {/* Chat panel */}
        <section className={`${chatColumnClass} panel-chrome bg-white/90 rounded-2xl border border-slate-200 flex flex-col min-h-0 overflow-hidden`}>
          {/* Chat header */}
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-indigo-100">
                <MessageSquare size={15} className="text-indigo-600" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{selectedAgent?.name || 'Select an agent'}</div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {selectedSessionId ? `session: ${selectedSessionId.slice(0, 20)}…` : 'new chat'}
                </div>
              </div>
              {supervisorMode && (
                <div className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center gap-1 shrink-0">
                  <Network size={11} /> Supervisor
                </div>
              )}
              {sending && (
                <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold shrink-0">
                  <Loader2 size={12} className="animate-spin" /> Running…
                </div>
              )}
            </div>
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
              <span className={`h-2 w-2 rounded-full ${selectedSessionId ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
              {selectedSessionId ? 'Loaded from history' : 'Fresh conversation'}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setHistoryHidden((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                title={historyHidden ? 'Show history sidebar' : 'Hide history sidebar'}
              >
                {historyHidden ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
                <span className="hidden md:inline">{historyHidden ? 'Show History' : 'Hide History'}</span>
              </button>
              <button
                type="button"
                onClick={() => setFocusMode((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                title={focusMode ? 'Exit focus mode' : 'Maximize chat workspace'}
              >
                {focusMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                <span className="hidden md:inline">{focusMode ? 'Exit Focus' : 'Focus Mode'}</span>
              </button>
              <div className="hidden md:flex items-center gap-1 text-xs text-slate-500">
                <Activity size={12} />
                {messages.length} msgs
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" checked={showToolTrace} onChange={(e) => setShowToolTrace(e.target.checked)} />
                Tool Trace
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
                Debug
              </label>
            </div>
          </div>

          {/* Messages area */}
          <div ref={messagesContainerRef} className={`flex-1 min-h-0 overflow-y-auto py-5 space-y-4 scroll-smooth ${focusMode ? 'px-8 xl:px-16' : 'px-5'}`}>
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                <Bot size={36} className="opacity-30" />
                <div className="text-sm font-semibold">Start a conversation with {selectedAgent?.name || 'an agent'}</div>
                {supervisorMode && <div className="text-xs text-violet-500 font-medium">Supervisor mode ON · {delegateAgentIds.length} delegate{delegateAgentIds.length !== 1 ? 's' : ''} selected</div>}
              </div>
            )}
            {messages.map((m, idx) => (
              <div key={`${m.ts || 'm'}-${idx}`} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {(() => {
                  const executionId = Number(m.debug?.executionId || 0);
                  const feedbackState = executionId > 0 ? feedbackByExecution[executionId] : undefined;
                  return (
                    <>
                {/* Avatar */}
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg ${m.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                  {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </div>

                {/* Bubble */}
                <div className={`flex-1 ${m.role === 'user' ? 'max-w-[78%] items-end flex flex-col' : (m.trace?.length || m.debug || m.delegation) ? 'max-w-[92%]' : 'max-w-[78%]'}`}>
                  {/* Sender label */}
                  <div className={`text-[10px] font-semibold mb-1.5 ${m.role === 'user' ? 'text-indigo-500 text-right' : 'text-slate-500'}`}>
                    {m.ts && <span className="font-normal tracking-normal">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>

                  <div className={`rounded-[1.35rem] px-4 py-3 text-sm leading-7 shadow-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-sm'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-tl-sm'
                  }`}>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                      <div className={`mt-3 flex flex-wrap gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
                        {m.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                              m.role === 'user'
                                ? 'border-white/30 bg-white/10 text-white'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Paperclip size={11} />
                            <span className="max-w-[16rem] truncate">{attachment.name}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Execution link */}
                    {m.role === 'assistant' && m.debug?.executionId && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/agent-executions/${m.debug.executionId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
                            <ExternalLink size={11} /> Execution #{m.debug.executionId}
                          </Link>
                          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-1">
                            <button
                              type="button"
                              onClick={() => m.debug?.executionId && submitExecutionFeedback(m.debug.executionId, 'up')}
                              disabled={!m.debug?.executionId || feedbackState?.status === 'saving'}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                feedbackState?.rating === 'up' && feedbackState?.status === 'saved'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
                              }`}
                              title="This solved the task"
                            >
                              <ThumbsUp size={11} /> Helpful
                            </button>
                            <button
                              type="button"
                              onClick={() => m.debug?.executionId && submitExecutionFeedback(m.debug.executionId, 'down')}
                              disabled={!m.debug?.executionId || feedbackState?.status === 'saving'}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                feedbackState?.rating === 'down' && feedbackState?.status === 'saved'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'text-slate-500 hover:bg-amber-50 hover:text-amber-700'
                              }`}
                              title="This should improve next time"
                            >
                              <ThumbsDown size={11} /> Improve
                            </button>
                          </div>
                          {feedbackState?.status === 'saving' && (
                            <span className="text-[11px] font-semibold text-slate-400">Saving feedback…</span>
                          )}
                          {feedbackState?.status === 'saved' && (
                            <span className="text-[11px] font-semibold text-emerald-600">Feedback saved</span>
                          )}
                          {feedbackState?.status === 'error' && (
                            <span className="text-[11px] font-semibold text-red-600">{feedbackState.error || 'Failed to save feedback'}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Delegation tree */}
                  {m.role === 'assistant' && m.delegation && (
                    <>
                      <DelegationHandoffFeed delegation={m.delegation} />
                      <DelegationTree delegation={m.delegation} agents={agents} />
                    </>
                  )}

                  {/* Tool trace panel */}
                  {showToolTrace && m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length > 0 && (
                    <details className="mt-2 rounded-xl border border-indigo-100 bg-slate-950/90 overflow-hidden" open>
                      <summary className="cursor-pointer text-[11px] font-black text-indigo-400 uppercase tracking-widest px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors">
                        <Activity size={11} />
                        Agent Activity · {m.trace.length} events
                      </summary>
                      <div className="px-3 pb-3 pt-1 space-y-1.5 max-h-[42.5rem] overflow-y-auto scroll-smooth">
                        {m.trace.map((evt: any, tidx: number) => {
                          const traceKey = `trace-${tidx}`;
                          return <TraceRow key={traceKey} evt={evt} />;
                        })}
                        {/* Scroll sentinel — auto-scrolled to during streaming */}
                        <div ref={traceEndRef} />
                      </div>
                    </details>
                  )}

                  {/* Debug panel */}
                  {debugMode && m.role === 'assistant' && m.debug && (
                    <details className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <summary className="cursor-pointer text-[11px] font-semibold text-slate-600 px-3 py-2 flex items-center gap-2">
                        Inference Debug
                      </summary>
                      <div className="px-3 pb-3 text-[11px] space-y-1.5 max-h-[42.5rem] overflow-y-auto scroll-smooth">
                        <div>Execution: <span className="font-mono">{m.debug.executionId ?? '-'}</span> · Status: <span className="font-bold">{m.debug.status}</span></div>
                        <div>
                          Tokens: <span className="font-mono">↑{Number(m.debug?.usage?.prompt_tokens || 0).toLocaleString()} ↓{Number(m.debug?.usage?.completion_tokens || 0).toLocaleString()}</span>
                          {' · '}Cost: <span className="font-mono text-emerald-700">${Number(m.debug?.usage?.cost || 0).toFixed(6)}</span>
                        </div>
                        {(m.debug.timeline || []).map((step: any, sidx: number) => (
                          <div key={`${step.stage || 'step'}-${sidx}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                            <span className="truncate text-slate-700">{step.stage || 'stage'}</span>
                            <span className="font-mono text-slate-500 shrink-0">{step.duration_ms != null ? `${step.duration_ms}ms` : step.status || '-'}</span>
                          </div>
                        ))}
                        {(!m.debug.timeline || !m.debug.timeline.length) && <div className="text-slate-500">No timeline details.</div>}
                        {/* Scroll sentinel for debug — shares the same ref if both open during streaming */}
                        <div ref={traceEndRef} />
                      </div>
                    </details>
                  )}
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
            {/* Auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className={`border-t border-slate-200 bg-white/70 backdrop-blur-sm shrink-0 ${focusMode ? 'px-8 xl:px-16 py-4' : 'px-5 py-4'}`}>
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <XCircle size={13} className="shrink-0" />
                {error}
              </div>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`rounded-full px-2.5 py-1 font-semibold ${selectedSessionId ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {selectedSessionId ? 'Replying in selected chat' : 'Starting a new chat'}
              </span>
              {supervisorMode ? (
                <span className="rounded-full bg-violet-100 px-2.5 py-1 font-semibold text-violet-700">
                  Supervisor mode · {delegateAgentIds.length} delegates
                </span>
              ) : null}
              {draftAttachments.length ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">
                  {draftAttachments.length} attachment{draftAttachments.length === 1 ? '' : 's'} queued
                </span>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { void uploadDraftAttachments(e.target.files); }}
            />
            {draftAttachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {draftAttachments.map((attachment) => (
                  <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700">
                    <Paperclip size={11} />
                    <span className="max-w-[16rem] truncate">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() => setDraftAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                      className="text-indigo-500 hover:text-indigo-700"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={supervisorMode
                    ? `Assign a task to ${selectedAgent?.name || 'the supervisor'} with ${delegateAgentIds.length} delegate${delegateAgentIds.length !== 1 ? 's' : ''}...`
                    : `Message ${selectedAgent?.name || 'the agent'}...`}
                  disabled={sending}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 resize-none disabled:opacity-60 min-h-[72px] max-h-48 leading-relaxed transition-all"
                  style={{ scrollbarWidth: 'thin' }}
                />
                {draft.length > 0 && (
                  <div className="absolute bottom-2 right-3 text-[10px] text-slate-400">{draft.length}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!selectedAgentId || sending}
                className="h-12 w-12 shrink-0 rounded-2xl border border-slate-300 bg-white text-slate-600 disabled:opacity-50 flex items-center justify-center hover:border-indigo-300 hover:text-indigo-600 transition-all"
                title="Attach image or file"
              >
                <Paperclip size={16} />
              </button>
              <button
                onClick={sendMessage}
                disabled={(!draft.trim() && !draftAttachments.length) || !selectedAgentId || sending || (supervisorMode && !delegateAgentIds.length)}
                className="h-12 px-4 rounded-2xl bg-indigo-600 text-white text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-200 font-bold"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                <span className="text-[10px] font-black uppercase tracking-widest">{sending ? 'Wait' : 'Send'}</span>
              </button>
            </div>
            <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-400">
              <span>Enter sends • Shift+Enter adds a line break</span>
              {supervisorMode && delegateAgentIds.length > 0 && (
                <span className="text-violet-500 font-semibold">
                  ◆ Supervisor mode · {delegateAgentIds.length} delegate{delegateAgentIds.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
