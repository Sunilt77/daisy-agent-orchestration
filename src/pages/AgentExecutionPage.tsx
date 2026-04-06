import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Radio, Square, GitBranch, Bot, Wrench, Cpu, DollarSign, RotateCcw, Search } from 'lucide-react';

type Execution = {
  id: number;
  agent_id: number;
  status?: string;
  execution_kind?: string;
  parent_execution_id?: number | null;
  delegation_title?: string | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_cost?: number;
  input?: string | null;
  output?: string | null;
  created_at: string;
};

type Delegation = {
  id: number;
  parent_execution_id: number;
  child_execution_id?: number | null;
  child_job_id?: number | null;
  agent_id: number;
  agent_name?: string;
  role?: string;
  title?: string | null;
  status?: string;
  task?: string | null;
  result?: string | null;
  error?: string | null;
  created_at?: string;
};

type TimelineStep = {
  stage?: string;
  status?: string;
  at?: string;
  duration_ms?: number;
  error?: string | null;
  child_execution_id?: number | null;
  child_job_id?: number | null;
};

type ToolActivityRow = {
  id: number;
  tool_name?: string;
  tool_type?: string | null;
  status?: string;
  duration_ms?: number | null;
  created_at?: string;
  error?: string | null;
  args?: string | null;
  result?: string | null;
};

function statusPillClass(status?: string) {
  return status === 'failed' || status === 'canceled'
    ? 'bg-red-100 text-red-700'
    : status === 'running' || status === 'queued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-emerald-100 text-emerald-700';
}

function executionKindLabel(kind?: string) {
  switch (kind) {
    case 'delegated_parent':
      return 'Supervisor';
    case 'delegated_child':
      return 'Delegate';
    case 'delegated_synthesis':
      return 'Synthesis';
    default:
      return 'Standard';
  }
}

function delegationRoleLabel(role?: string) {
  return role === 'synthesis' ? 'Synthesis' : 'Delegate';
}

async function safeJson(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

function formatTracePayload(raw?: string | null) {
  if (!raw || !String(raw).trim()) return 'No data recorded.';
  const text = String(raw);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function AgentExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const execId = Number(id);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [tools, setTools] = useState<ToolActivityRow[]>([]);
  const [activeToolTrace, setActiveToolTrace] = useState<ToolActivityRow | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [timelineStatusFilter, setTimelineStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [delegationFilter, setDelegationFilter] = useState<'all' | 'delegate' | 'synthesis'>('all');
  const [activityQuery, setActivityQuery] = useState('');
  const esRef = useRef<EventSource | null>(null);

  const load = async () => {
    if (!Number.isFinite(execId) || execId <= 0) return;
    const timelineRes = await fetch(`/api/agent-executions/${execId}/timeline`);

    const timelineData = await safeJson(timelineRes);
    if (!timelineRes.ok) {
      throw new Error(timelineData?.error || 'Failed to load execution');
    }
    setExecution(timelineData?.execution || null);
    setTimeline(Array.isArray(timelineData?.timeline) ? timelineData.timeline : []);
    setDelegations(Array.isArray(timelineData?.delegations) ? timelineData.delegations : []);
    setTools(Array.isArray(timelineData?.tools) ? timelineData.tools : []);
  };

  useEffect(() => {
    load().catch((e: any) => setError(e?.message || 'Failed to load execution'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execId]);

  useEffect(() => {
    if (!live || !Number.isFinite(execId) || execId <= 0) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(`/api/agent-executions/${execId}/stream`);
    esRef.current = es;
    es.addEventListener('update', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        if (data?.execution) setExecution(data.execution);
        setTools(Array.isArray(data?.tools) ? data.tools : []);
        setDelegations(Array.isArray(data?.delegations) ? data.delegations : []);
      } catch {
        // ignore
      }
      load().catch(() => undefined);
    });
    es.addEventListener('done', () => {
      load().catch(() => undefined);
      es.close();
    });
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, execId]);

  const totalTokens = useMemo(
    () => Number(execution?.prompt_tokens || 0) + Number(execution?.completion_tokens || 0),
    [execution?.prompt_tokens, execution?.completion_tokens]
  );
  const delegationStats = useMemo(() => {
    const delegateRows = delegations.filter((row) => row.role !== 'synthesis');
    const synthesisRows = delegations.filter((row) => row.role === 'synthesis');
    const completed = delegateRows.filter((row) => row.status === 'completed').length;
    return {
      delegates: delegateRows,
      synthesisRows,
      completed,
      failed: delegations.filter((row) => row.status === 'failed' || row.status === 'canceled').length,
    };
  }, [delegations]);
  const filteredTimeline = useMemo(() => {
    const q = activityQuery.trim().toLowerCase();
    return timeline.filter((step) => {
      const normalizedStatus = String(step.status || '').toLowerCase();
      const matchesStatus = timelineStatusFilter === 'all'
        || (timelineStatusFilter === 'running' && ['running', 'queued', 'pending'].includes(normalizedStatus))
        || (timelineStatusFilter === 'completed' && normalizedStatus === 'completed')
        || (timelineStatusFilter === 'failed' && ['failed', 'canceled'].includes(normalizedStatus));
      if (!matchesStatus) return false;
      if (!q) return true;
      return `${step.stage || ''} ${step.status || ''}`.toLowerCase().includes(q);
    });
  }, [activityQuery, timeline, timelineStatusFilter]);
  const filteredDelegations = useMemo(() => {
    const q = activityQuery.trim().toLowerCase();
    return delegations.filter((delegation) => {
      const matchesRole = delegationFilter === 'all'
        || (delegationFilter === 'synthesis' && delegation.role === 'synthesis')
        || (delegationFilter === 'delegate' && delegation.role !== 'synthesis');
      if (!matchesRole) return false;
      if (!q) return true;
      return `${delegation.title || ''} ${delegation.agent_name || ''} ${delegation.task || ''} ${delegation.status || ''}`.toLowerCase().includes(q);
    });
  }, [activityQuery, delegationFilter, delegations]);
  const filteredTools = useMemo(() => {
    const q = activityQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => `${tool.tool_name || ''} ${tool.status || ''}`.toLowerCase().includes(q));
  }, [activityQuery, tools]);
  const hasDetailFilters = timelineStatusFilter !== 'all' || delegationFilter !== 'all' || Boolean(activityQuery.trim());

  if (!Number.isFinite(execId) || execId <= 0) {
    return <div className="text-sm text-red-600">Invalid execution id.</div>;
  }

  return (
    <div className="w-full space-y-6">
      <div className="swarm-hero p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/agents" className="text-slate-200 hover:text-white flex items-center gap-2 mb-4">
            <ArrowLeft size={16} /> Back to Agents
          </Link>
          <h1 className="text-3xl font-black text-white">Execution #{execId}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-1 rounded-full ${statusPillClass(execution?.status)}`}>{execution?.status || 'unknown'}</span>
            <span className="px-2 py-1 rounded-full bg-white/10 text-slate-200 uppercase tracking-wider">
              {executionKindLabel(execution?.execution_kind)}
            </span>
            {execution?.parent_execution_id ? (
              <Link to={`/agent-executions/${execution.parent_execution_id}`} className="px-2 py-1 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200">
                Parent #{execution.parent_execution_id}
              </Link>
            ) : null}
          </div>
        </div>
        <button
          onClick={() => setLive((v) => !v)}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${live ? 'bg-emerald-400/15 border-emerald-300/20 text-emerald-100' : 'bg-white/5 border-white/10 text-slate-200'}`}
        >
          {live ? <Radio size={16} /> : <Square size={16} />} Live
        </button>
      </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,0.75fr))_auto]">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={activityQuery}
              onChange={(e) => setActivityQuery(e.target.value)}
              placeholder="Search timeline, delegations, and tool activity..."
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={timelineStatusFilter}
            onChange={(e) => setTimelineStatusFilter(e.target.value as 'all' | 'running' | 'completed' | 'failed')}
            className="ui-select"
          >
            <option value="all">All Timeline</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={delegationFilter}
            onChange={(e) => setDelegationFilter(e.target.value as 'all' | 'delegate' | 'synthesis')}
            className="ui-select"
          >
            <option value="all">All Delegations</option>
            <option value="delegate">Delegates Only</option>
            <option value="synthesis">Synthesis Only</option>
          </select>
          <button
            onClick={() => {
              setTimelineStatusFilter('all');
              setDelegationFilter('all');
              setActivityQuery('');
            }}
            disabled={!hasDetailFilters}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-45"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            {
              label: `Timeline ${filteredTimeline.length}/${timeline.length}`,
              active: timelineStatusFilter === 'all',
              onClick: () => setTimelineStatusFilter('all' as const),
            },
            {
              label: `Timeline Running`,
              active: timelineStatusFilter === 'running',
              onClick: () => setTimelineStatusFilter('running' as const),
            },
            {
              label: `Timeline Failed`,
              active: timelineStatusFilter === 'failed',
              onClick: () => setTimelineStatusFilter('failed' as const),
            },
            {
              label: `Delegates ${filteredDelegations.filter((row) => row.role !== 'synthesis').length}/${delegations.filter((row) => row.role !== 'synthesis').length}`,
              active: delegationFilter === 'delegate',
              onClick: () => setDelegationFilter('delegate' as const),
            },
            {
              label: `Synthesis ${filteredDelegations.filter((row) => row.role === 'synthesis').length}/${delegations.filter((row) => row.role === 'synthesis').length}`,
              active: delegationFilter === 'synthesis',
              onClick: () => setDelegationFilter('synthesis' as const),
            },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onClick}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                chip.active
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <div className="ml-auto text-xs text-slate-500">
            Tools <span className="font-semibold text-slate-700">{filteredTools.length}</span>/<span className="font-semibold text-slate-700">{tools.length}</span>
          </div>
        </div>
        {hasDetailFilters && filteredTimeline.length + filteredDelegations.length + filteredTools.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            No timeline, delegation, or tool activity matches your current filters.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="telemetry-tile p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Prompt Tokens</div>
          <div className="text-xl font-bold text-white mt-1">{Number(execution?.prompt_tokens || 0).toLocaleString()}</div>
        </div>
        <div className="telemetry-tile p-4">
          <div className="text-xs uppercase tracking-wider text-slate-400">Completion Tokens</div>
          <div className="text-xl font-bold text-white mt-1">{Number(execution?.completion_tokens || 0).toLocaleString()}</div>
        </div>
        <div className="telemetry-tile p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-400">Total Tokens</div>
            <Cpu size={16} className="text-brand-200" />
          </div>
          <div className="text-xl font-bold text-white mt-1">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="telemetry-tile p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-400">Cost</div>
            <DollarSign size={16} className="text-emerald-200" />
          </div>
          <div className="text-xl font-bold text-emerald-300 mt-1">${Number(execution?.total_cost || 0).toFixed(6)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <GitBranch size={16} /> Delegation Chain Overview
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Current Role</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{executionKindLabel(execution?.execution_kind)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Parent Execution</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {execution?.parent_execution_id ? (
                      <Link to={`/agent-executions/${execution.parent_execution_id}`} className="text-indigo-600 hover:text-indigo-800">
                        #{execution.parent_execution_id}
                      </Link>
                    ) : 'Root execution'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Delegates</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">
                    {delegationStats.completed}/{delegationStats.delegates.length} complete
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Synthesis Steps</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{delegationStats.synthesisRows.length}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Chain Map</div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {execution?.parent_execution_id ? (
                    <>
                      <Link to={`/agent-executions/${execution.parent_execution_id}`} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 font-semibold text-violet-700">
                        Parent #{execution.parent_execution_id}
                      </Link>
                      <span className="text-slate-400">{'->'}</span>
                    </>
                  ) : null}
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">
                    Current #{execId}
                  </span>
                  {delegations.length > 0 ? (
                    delegations.map((delegation) => (
                      <React.Fragment key={`chain-${delegation.id}`}>
                        <span className="text-slate-400">{'->'}</span>
                        {delegation.child_execution_id ? (
                          <Link to={`/agent-executions/${delegation.child_execution_id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700">
                            {delegationRoleLabel(delegation.role)} #{delegation.child_execution_id}
                          </Link>
                        ) : (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-500">
                            {delegationRoleLabel(delegation.role)} pending
                          </span>
                        )}
                      </React.Fragment>
                    ))
                  ) : (
                    <>
                      <span className="text-slate-400">{'->'}</span>
                      <span className="rounded-full border border-dashed border-slate-200 bg-white px-3 py-1 text-slate-500">
                        No child delegations
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <Bot size={16} /> Input
            </div>
            <div className="p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono max-h-[320px] overflow-y-auto">
              {execution?.input || 'No input recorded.'}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <Activity size={16} /> Output
            </div>
            <div className="p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono max-h-[320px] overflow-y-auto">
              {execution?.output || 'No output recorded.'}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700">Timeline</div>
            <div className="p-4 space-y-2">
              {filteredTimeline.length ? filteredTimeline.map((step, idx) => (
                <div key={`${step.stage}-${idx}`} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                  <div className="text-slate-700">{step.stage}</div>
                  <div className="flex items-center gap-2">
                    {step.child_execution_id ? (
                      <Link to={`/agent-executions/${step.child_execution_id}`} className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100">
                        Child #{step.child_execution_id}
                      </Link>
                    ) : null}
                    <span className={`px-2 py-0.5 rounded-full ${statusPillClass(step.status)}`}>{step.status}</span>
                    <span className="font-mono text-slate-500">{step.duration_ms != null ? `${step.duration_ms}ms` : '-'}</span>
                  </div>
                </div>
              )) : <div className="text-sm text-slate-500">No timeline steps match current filters.</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <GitBranch size={16} /> Delegation Tree
            </div>
            <div className="p-4 space-y-3">
              {filteredDelegations.length ? filteredDelegations.map((delegation) => (
                <div key={delegation.id} className="rounded-lg border border-slate-200 p-3 bg-slate-50/70">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{delegation.title || delegation.agent_name || `Agent ${delegation.agent_id}`}</div>
                      <div className="text-xs text-slate-500">
                        {delegation.role === 'synthesis' ? 'Synthesis step' : `Delegate agent: ${delegation.agent_name || delegation.agent_id}`}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${statusPillClass(delegation.status)}`}>{delegation.status || 'unknown'}</span>
                  </div>
                  {delegation.child_execution_id ? (
                    <Link to={`/agent-executions/${delegation.child_execution_id}`} className="mt-3 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      Open Child #{delegation.child_execution_id}
                    </Link>
                  ) : null}
                  {delegation.task ? (
                    <div className="mt-3 text-xs text-slate-700 whitespace-pre-wrap">
                      <span className="font-semibold text-slate-600">Task:</span> {delegation.task}
                    </div>
                  ) : null}
                  {delegation.result ? (
                    <div className="mt-3 rounded-lg bg-white border border-slate-200 p-3 text-xs text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {delegation.result}
                    </div>
                  ) : null}
                  {!delegation.result && delegation.error ? (
                    <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 whitespace-pre-wrap">
                      {delegation.error}
                    </div>
                  ) : null}
                </div>
              )) : <div className="text-sm text-slate-500">No delegations match current filters.</div>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <Wrench size={16} /> Tool Activity
            </div>
            <div className="p-4 space-y-2">
              {filteredTools.length ? filteredTools.map((tool: any) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setActiveToolTrace(tool)}
                  className="w-full text-left flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
                >
                  <div className="text-slate-700">{tool.tool_name}</div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full ${statusPillClass(tool.status)}`}>{tool.status}</span>
                    <span className="font-mono text-slate-500">{tool.duration_ms != null ? `${tool.duration_ms}ms` : '-'}</span>
                  </div>
                </button>
              )) : <div className="text-sm text-slate-500">No tool activity matches current filters.</div>}
            </div>
          </div>
        </div>
      </div>
      {activeToolTrace && (
        <div className="fixed inset-0 z-[80] bg-black/45 p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">{activeToolTrace.tool_name || 'Tool Trace'}</div>
                <div className="text-xs text-slate-500 mt-1">
                  #{activeToolTrace.id}
                  {activeToolTrace.tool_type ? ` · ${activeToolTrace.tool_type}` : ''}
                  {activeToolTrace.created_at ? ` · ${new Date(activeToolTrace.created_at).toLocaleString()}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveToolTrace(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Exit
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(88vh-72px)] space-y-4">
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full ${statusPillClass(activeToolTrace.status)}`}>{activeToolTrace.status || 'unknown'}</span>
                <span className="font-mono text-slate-500">{activeToolTrace.duration_ms != null ? `${activeToolTrace.duration_ms}ms` : '-'}</span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 border-b border-slate-200 bg-slate-50">
                    Tool Input
                  </div>
                  <pre className="p-3 text-xs text-slate-800 whitespace-pre-wrap font-mono max-h-[45vh] overflow-y-auto">
                    {formatTracePayload(activeToolTrace.args)}
                  </pre>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 border-b border-slate-200 bg-slate-50">
                    Tool Output
                  </div>
                  <pre className="p-3 text-xs text-slate-800 whitespace-pre-wrap font-mono max-h-[45vh] overflow-y-auto">
                    {formatTracePayload(activeToolTrace.result)}
                  </pre>
                </div>
              </div>
              {activeToolTrace.error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Error</div>
                  <pre className="mt-2 text-xs text-red-700 whitespace-pre-wrap font-mono">{activeToolTrace.error}</pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
