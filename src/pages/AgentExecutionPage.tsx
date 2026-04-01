import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Radio, Square, GitBranch, Bot, Wrench, Cpu, DollarSign, Sparkles } from 'lucide-react';

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

export default function AgentExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const execId = Number(id);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
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

  if (!Number.isFinite(execId) || execId <= 0) {
    return <div className="text-sm text-red-600">Invalid execution id.</div>;
  }

  return (
    <div className="w-full space-y-6">
      <div className="swarm-hero p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/agents" className="text-indigo-600 hover:text-indigo-800 flex items-center gap-2 mb-4">
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
              {timeline.length ? timeline.map((step, idx) => (
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
              )) : <div className="text-sm text-slate-500">No timeline available.</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <GitBranch size={16} /> Delegation Tree
            </div>
            <div className="p-4 space-y-3">
              {delegations.length ? delegations.map((delegation) => (
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
              )) : <div className="text-sm text-slate-500">No delegations recorded for this execution.</div>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
              <Wrench size={16} /> Tool Activity
            </div>
            <div className="p-4 space-y-2">
              {tools.length ? tools.map((tool: any) => (
                <div key={tool.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                  <div className="text-slate-700">{tool.tool_name}</div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full ${statusPillClass(tool.status)}`}>{tool.status}</span>
                    <span className="font-mono text-slate-500">{tool.duration_ms != null ? `${tool.duration_ms}ms` : '-'}</span>
                  </div>
                </div>
              )) : <div className="text-sm text-slate-500">No tool activity recorded.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
