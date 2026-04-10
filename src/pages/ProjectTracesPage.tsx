import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Activity, DollarSign, Clock, MessageSquare, Filter, Search, RotateCcw } from 'lucide-react';
import Pagination from '../components/Pagination';

function formatToolTraceName(rawName?: string | null) {
  const raw = String(rawName || '').trim();
  if (!raw) return 'Unknown tool';
  const normalized = raw.replace(/-/g, '_');
  const bundleSplitIndex = normalized.indexOf('_tool_');
  if (bundleSplitIndex >= 0) {
    let bundleName = normalized.slice(0, bundleSplitIndex);
    let toolName = normalized.slice(bundleSplitIndex + 6);
    bundleName = bundleName.replace(/^mcp_bundle_/, '').replace(/^bundle_/, '').replace(/_bundle$/, '');
    toolName = toolName.replace(/^tool_/, '').replace(/^npm_/, '').replace(/_mcp_server_/, '_').replace(/_mcp_/, '_');
    const bundlePrefix = bundleName.replace(/_mcp$/, '');
    if (bundlePrefix && toolName.startsWith(bundlePrefix + '_')) {
      toolName = toolName.slice(bundlePrefix.length + 1);
    }
    return `${bundleName} / ${toolName}`;
  }
  return normalized
    .replace(/^mcp_bundle_/, '')
    .replace(/^bundle_/, '')
    .replace(/^mcp_/, '')
    .replace(/^tool_/, '');
}

interface Trace {
  id: number;
  agent_id: number;
  agent_name: string;
  agent_role: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  input: string;
  output: string;
  created_at: string;
}

interface ToolTrace {
  id: number;
  tool_id?: number | null;
  agent_id: number;
  tool_name: string;
  tool_type?: string | null;
  status: string;
  args?: string | null;
  result?: string | null;
  error?: string | null;
  duration_ms?: number | null;
  created_at: string;
  agent_name: string;
  agent_role: string;
}

type Run = {
  id: string;
  kind: string;
  name?: string | null;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  traceId: string;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: string;
  projectId: string;
  tags?: any;
};

type Insights = {
  summary: {
    runs: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_cost_usd: string;
    avg_duration_ms: number;
    max_duration_ms: number;
    first_started_at: string | null;
    last_started_at: string | null;
  };
  breakdown: {
    kind: Array<{ key: string; count: number }>;
    status: Array<{ key: string; count: number }>;
    provider: Array<{ key: string; count: number }>;
    model: Array<{ key: string; count: number }>;
    agent: Array<{ key: string; count: number }>;
    origin: Array<{ key: string; count: number }>;
    initiator: Array<{ key: string; count: number }>;
  };
  max_event_metrics?: any;
};

export default function ProjectTracesPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [tracesLoadError, setTracesLoadError] = useState<string | null>(null);
  const [toolTracesLoadError, setToolTracesLoadError] = useState<string | null>(null);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const [selectedToolTrace, setSelectedToolTrace] = useState<ToolTrace | null>(null);
  const [tab, setTab] = useState<'platform' | 'local-agent' | 'local-tool'>('platform');
  const [platformProjectId, setPlatformProjectId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(10);
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(10);
  const [localToolPage, setLocalToolPage] = useState(1);
  const [localToolPageSize, setLocalToolPageSize] = useState(10);
  const hasFilters = Boolean(q || status || kind || from || to);

  const loadInitialData = async () => {
    if (!id) return;
    setLoading(true);
    setInitialLoadError(null);
    setProjectLoadError(null);
    setTracesLoadError(null);
    setToolTracesLoadError(null);

    const readJson = async (res: Response) => {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const errors: string[] = [];

    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String((data as any)?.error || 'Failed to load project details');
        setProjectLoadError(msg);
        errors.push(msg);
      } else {
        setProject(data);
      }
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to load project details');
      setProjectLoadError(msg);
      errors.push(msg);
    }

    try {
      const res = await fetch(`/api/projects/${id}/traces`);
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String((data as any)?.error || 'Failed to load local agent traces');
        setTraces([]);
        setTracesLoadError(msg);
        errors.push(msg);
      } else {
        setTraces(Array.isArray(data) ? data : []);
      }
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to load local agent traces');
      setTraces([]);
      setTracesLoadError(msg);
      errors.push(msg);
    }

    try {
      const res = await fetch(`/api/projects/${id}/tool-traces`);
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String((data as any)?.error || 'Failed to load local tool traces');
        setToolTraces([]);
        setToolTracesLoadError(msg);
        errors.push(msg);
      } else {
        setToolTraces(Array.isArray(data) ? data : []);
      }
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to load local tool traces');
      setToolTraces([]);
      setToolTracesLoadError(msg);
      errors.push(msg);
    }

    if (errors.length > 0) {
      setInitialLoadError('Some project trace data failed to load. You can retry now.');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadInitialData().catch(() => {
      setInitialLoadError('Some project trace data failed to load. You can retry now.');
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadPlatformLink = async () => {
    const res = await fetch(`/api/projects/${id}/platform-link`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setPlatformProjectId(null);
    setPlatformProjectId(data.platformProjectId ?? null);
    if (data.platformProjectId) setTab('platform');
    else setTab('local-agent');
  };

  const loadRuns = async () => {
    if (!platformProjectId) return;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const params = new URLSearchParams({ project_id: platformProjectId });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (kind) params.set('kind', kind);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      const res = await fetch(`/api/v1/runs?${params.toString()}`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load runs');
      setRuns(data);
    } catch (e: any) {
      setRunsError(e.message || 'Failed to load runs');
    } finally {
      setRunsLoading(false);
    }
  };

  const loadInsights = async () => {
    if (!platformProjectId) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const params = new URLSearchParams({ project_id: platformProjectId });
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      const res = await fetch(`/api/v1/insights?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load insights');
      setInsights(data);
    } catch (e: any) {
      setInsightsError(e.message || 'Failed to load insights');
    } finally {
      setInsightsLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    loadPlatformLink().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!platformProjectId) return;
    loadRuns();
    loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformProjectId]);

  useEffect(() => {
    setRunsPage(1);
  }, [runs.length, q, status, kind, from, to, platformProjectId]);

  useEffect(() => {
    setLocalPage(1);
  }, [traces.length, id, q]);

  useEffect(() => {
    setLocalToolPage(1);
  }, [toolTraces.length, id, q, status]);

  const localFilteredTraces = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return traces;
    return traces.filter((trace) =>
      [trace.agent_name, trace.agent_role, trace.input, trace.output, trace.created_at]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [traces, q]);

  const localFilteredToolTraces = useMemo(() => {
    const query = q.trim().toLowerCase();
    return toolTraces.filter((trace) => {
      const matchesQuery = !query || [trace.tool_name, trace.tool_type, trace.agent_name, trace.args, trace.result, trace.error]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus = !status || String(trace.status || '').toLowerCase() === String(status || '').toLowerCase();
      return matchesQuery && matchesStatus;
    });
  }, [toolTraces, q, status]);

  const pagedRuns = useMemo(() => {
    const start = (runsPage - 1) * runsPageSize;
    return runs.slice(start, start + runsPageSize);
  }, [runs, runsPage, runsPageSize]);

  const pagedTraces = useMemo(() => {
    const start = (localPage - 1) * localPageSize;
    return localFilteredTraces.slice(start, start + localPageSize);
  }, [localFilteredTraces, localPage, localPageSize]);

  const pagedToolTraces = useMemo(() => {
    const start = (localToolPage - 1) * localToolPageSize;
    return localFilteredToolTraces.slice(start, start + localToolPageSize);
  }, [localFilteredToolTraces, localToolPage, localToolPageSize]);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading traces...</div>;
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <Link to="/projects" className="text-indigo-600 hover:text-indigo-800 flex items-center gap-2 mb-4">
          <ArrowLeft size={16} /> Back to Projects
        </Link>
        <h1 className="text-3xl font-bold text-slate-900">{project?.name} - Traces</h1>
        <p className="text-slate-500 mt-1">Project-wise traces (Platform runs/events + local agent executions).</p>
      </div>

      {initialLoadError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3">
          <span>{initialLoadError}</span>
          <button
            onClick={() => loadInitialData()}
            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
      {projectLoadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Project details unavailable: {projectLoadError}
        </div>
      )}

      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => setTab('platform')}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${tab === 'platform' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Platform Runs
        </button>
        <button
          onClick={() => setTab('local-agent')}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${tab === 'local-agent' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Local Agent Traces
        </button>
        <button
          onClick={() => setTab('local-tool')}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${tab === 'local-tool' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Local Tool Traces
        </button>
        {tab === 'platform' && (
          <div className="text-sm text-slate-500 ml-2">
            {platformProjectId ? <span className="font-mono">Platform project: {platformProjectId}</span> : 'Not linked (link it from the Projects page).'}
          </div>
        )}
      </div>

      {tab === 'platform' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <Activity size={18} /> Platform Runs
            </div>
            {platformProjectId && (
              <button onClick={() => { loadRuns(); loadInsights(); }} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                <Filter size={16} /> Refresh
              </button>
            )}
          </div>

          {!platformProjectId ? (
            <div className="p-8 text-center text-slate-500">Link this project to a Platform project to see Platform traces here.</div>
          ) : (
            <>
              {(runsError || insightsError) && (
                <div className="p-4 border-b border-slate-100 bg-amber-50 text-amber-900 text-sm">
                  <div className="font-medium">Traces couldn’t load</div>
                  <div className="mt-1">{runsError || insightsError}</div>
                  <div className="mt-2 flex items-center gap-3">
                    <Link to="/auth" className="text-amber-900 underline">Sign in</Link>
                    <button onClick={() => { loadRuns(); loadInsights(); }} className="text-amber-900 underline">
                      Retry
                    </button>
                  </div>
                </div>
              )}

              <div className="p-4 border-b border-slate-100 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Runs</div>
                    <div className="text-lg font-semibold text-slate-900">{insightsLoading ? '—' : (insights?.summary?.runs ?? '—')}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Total Tokens</div>
                    <div className="text-lg font-semibold text-slate-900">{insightsLoading ? '—' : (insights?.summary?.total_tokens ?? '—')}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Total Cost</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {insightsLoading ? '—' : `$${Number(insights?.summary?.total_cost_usd || 0).toFixed(4)}`}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Avg Duration</div>
                    <div className="text-lg font-semibold text-slate-900">{insightsLoading ? '—' : `${Math.round(Number(insights?.summary?.avg_duration_ms || 0))}ms`}</div>
                  </div>
                </div>

                {insights && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Status</div>
                      <div className="flex flex-wrap gap-2">
                        {insights.breakdown.status.map((s) => (
                          <span key={s.key} className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            {s.key}: {s.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kind</div>
                      <div className="flex flex-wrap gap-2">
                        {insights.breakdown.kind.map((k) => (
                          <span key={k.key} className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            {k.key}: {k.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Origin</div>
                      <div className="flex flex-wrap gap-2">
                        {insights.breakdown.origin.map((o) => (
                          <span key={o.key} className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            {o.key}: {o.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Initiator</div>
                      <div className="flex flex-wrap gap-2">
                        {insights.breakdown.initiator?.map((i) => (
                          <span key={i.key} className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            {i.key}: {i.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Top Model</div>
                      <div className="text-sm text-slate-700">
                        {insights.breakdown.model?.[0] ? (
                          <>
                            <span className="font-mono">{insights.breakdown.model[0].key}</span> ({insights.breakdown.model[0].count})
                          </>
                        ) : '—'}
                      </div>
                      <div className="text-xs text-slate-500 mt-2">Top Provider: {insights.breakdown.provider?.[0]?.key ?? '—'}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-b border-slate-100 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Search</label>
                  <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white">
                    <Search size={16} className="text-slate-400" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-full outline-none text-sm"
                      placeholder="Run, agent, model, trace id…"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
                  <input
                    type="datetime-local"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
                  <input
                    type="datetime-local"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Any</option>
                    <option value="running">running</option>
                    <option value="completed">completed</option>
                    <option value="failed">failed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Kind</label>
                  <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Any</option>
                    <option value="agent_run">agent_run</option>
                    <option value="crew_run">crew_run</option>
                    <option value="tool_run">tool_run</option>
                    <option value="workflow_run">workflow_run</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setQ('');
                      setStatus('');
                      setKind('');
                      setFrom('');
                      setTo('');
                    }}
                    disabled={!hasFilters}
                    className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-45 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium mr-2"
                  >
                    <RotateCcw size={14} />
                    Reset
                  </button>
                  <button onClick={() => { loadRuns(); loadInsights(); }} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    <Filter size={16} /> Apply
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="px-4 py-3">Run</th>
                      <th className="px-4 py-3">Origin</th>
                      <th className="px-4 py-3">Initiator</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Model</th>
                      <th className="px-4 py-3">Kind</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Invoked</th>
                      <th className="px-4 py-3 text-right">Duration</th>
                      <th className="px-4 py-3 text-right">Tokens</th>
                      <th className="px-4 py-3 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runsLoading ? (
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-6 text-center text-slate-500" colSpan={11}>Loading runs...</td>
                      </tr>
                    ) : runs.length === 0 ? (
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-6 text-center text-slate-500" colSpan={11}>No runs found.</td>
                      </tr>
                    ) : (
                      pagedRuns.map(r => {
                        const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
                        const back = `/projects/${id}/traces`;
                        const tags: any = r.tags && typeof r.tags === 'object' ? r.tags : {};
                        const origin = tags?.ingest?.source ?? '—';
                        const initiator = tags?.orchestrator?.initiated_by ?? '—';
                        const provider = tags?.provider ?? tags?.llm?.provider ?? '—';
                        const model = tags?.model ?? tags?.llm?.model ?? '—';
                        const duration = r.durationMs ?? tags?.metrics?.max?.duration_ms ?? null;
                        return (
                          <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <Link to={`/traces/${r.id}?back=${encodeURIComponent(back)}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
                                {r.name || r.id}
                              </Link>
                              <div className="text-xs text-slate-400 font-mono">{r.traceId}</div>
                            </td>
                            <td className="px-4 py-3">{origin}</td>
                            <td className="px-4 py-3">{initiator}</td>
                            <td className="px-4 py-3">{provider}</td>
                            <td className="px-4 py-3">{model}</td>
                            <td className="px-4 py-3">{r.kind}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${r.status === 'failed' ? 'bg-red-100 text-red-700' : r.status === 'running' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">{new Date(r.startedAt).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{duration == null ? '—' : `${duration}ms`}</td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-flex items-center gap-1 text-slate-700">
                                <MessageSquare size={14} /> {tokens.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <DollarSign size={14} /> {Number(r.totalCostUsd || 0).toFixed(4)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-slate-100">
                <Pagination
                  page={runsPage}
                  pageSize={runsPageSize}
                  total={runs.length}
                  onPageChange={setRunsPage}
                  onPageSizeChange={setRunsPageSize}
                />
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'local-agent' && (
      <div className="space-y-4">
      {tracesLoadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Local agent traces unavailable: {tracesLoadError}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Traces List */}
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          <div className="p-4 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
            <Activity size={18} /> Execution History
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {localFilteredTraces.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No traces found for this project.</div>
            ) : (
              pagedTraces.map(trace => (
                <div 
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedTrace?.id === trace.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-300'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-slate-900 text-sm truncate">{trace.agent_name}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap ml-2">
                      {new Date(trace.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mb-2 truncate">{trace.agent_role}</div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span className="flex items-center gap-1" title="Tokens">
                      <MessageSquare size={12} /> {trace.prompt_tokens + trace.completion_tokens}
                    </span>
                    <span className="flex items-center gap-1 text-emerald-600" title="Cost">
                      <DollarSign size={12} /> {trace.total_cost.toFixed(4)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-slate-100">
            <Pagination
              page={localPage}
              pageSize={localPageSize}
              total={localFilteredTraces.length}
              onPageChange={setLocalPage}
              onPageSizeChange={setLocalPageSize}
            />
          </div>
        </div>

        {/* Trace Details */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          {selectedTrace ? (
            <>
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h3 className="font-medium text-slate-900">Trace Details</h3>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1"><Clock size={14} /> {new Date(selectedTrace.created_at).toLocaleString()}</span>
                  <span className="flex items-center gap-1 text-emerald-600"><DollarSign size={14} /> {selectedTrace.total_cost.toFixed(4)}</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div> Input
                  </h4>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                    {selectedTrace.input || "No input recorded."}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Output
                  </h4>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                    {selectedTrace.output || "No output recorded."}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="text-xs text-slate-500 mb-1">Prompt Tokens</div>
                    <div className="font-medium text-slate-900">{selectedTrace.prompt_tokens}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="text-xs text-slate-500 mb-1">Completion Tokens</div>
                    <div className="font-medium text-slate-900">{selectedTrace.completion_tokens}</div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 p-8 text-center">
              <div>
                <Activity size={48} className="mx-auto mb-4 opacity-20" />
                <p>Select a trace from the list to view its input and output details.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
      )}

      {tab === 'local-tool' && (
      <div className="space-y-4">
      {toolTracesLoadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Local tool traces unavailable: {toolTracesLoadError}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          <div className="p-4 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
            <Activity size={18} /> Tool Execution History
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {localFilteredToolTraces.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No tool traces found for this project.</div>
            ) : (
              pagedToolTraces.map(trace => (
                <div
                  key={trace.id}
                  onClick={() => setSelectedToolTrace(trace)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedToolTrace?.id === trace.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-300'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-slate-900 text-sm truncate">{formatToolTraceName(trace.tool_name)}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap ml-2">
                      {new Date(trace.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mb-2 truncate">{trace.agent_name}</div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trace.status === 'failed' ? 'bg-red-100 text-red-700' : trace.status === 'running' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {trace.status}
                    </span>
                    <span className="flex items-center gap-1 text-slate-600" title="Duration">
                      <Clock size={12} /> {trace.duration_ms == null ? '—' : `${trace.duration_ms}ms`}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-slate-100">
            <Pagination
              page={localToolPage}
              pageSize={localToolPageSize}
              total={localFilteredToolTraces.length}
              onPageChange={setLocalToolPage}
              onPageSizeChange={setLocalToolPageSize}
            />
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          {selectedToolTrace ? (
            <>
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h3 className="font-medium text-slate-900">Tool Trace Details</h3>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1"><Clock size={14} /> {new Date(selectedToolTrace.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div> Args
                  </h4>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                    {selectedToolTrace.args || "No args recorded."}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Result
                  </h4>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                    {selectedToolTrace.result || selectedToolTrace.error || "No result recorded."}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 p-8 text-center">
              <div>
                <Activity size={48} className="mx-auto mb-4 opacity-20" />
                <p>Select a tool trace from the list to view its details.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
