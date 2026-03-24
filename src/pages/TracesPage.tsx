import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BarChart3, Bot, Clock3, DollarSign, Filter, MessageSquare, Search, TrendingUp, Wrench, X } from 'lucide-react';
import Pagination from '../components/Pagination';
import { loadPersisted, savePersisted } from '../utils/persistence';

type LocalProject = { id: number; name: string; description?: string; created_at?: string };
type LocalTrace = {
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
};

type LocalToolTrace = {
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
};

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
  summary: { runs: number; total_tokens: number; total_cost_usd: string; avg_duration_ms: number };
};

type RunEvent = {
  id: string;
  ts: string;
  type: string;
  name?: string | null;
  inputText?: string | null;
  outputText?: string | null;
  attributes?: any;
};

type RunDetail = {
  run: Run;
  events: RunEvent[];
};

function formatCompactNumber(value: number) {
  return Number(value || 0).toLocaleString();
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function statusBadgeTone(status: string) {
  if (status === 'failed') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'running') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-emerald-100 text-emerald-800 border-emerald-200';
}

function buildBars(values: number[], minBars = 10) {
  const normalized = values.length ? values : new Array(minBars).fill(0);
  const max = Math.max(...normalized, 1);
  return normalized.map((value, index) => ({
    id: index,
    value,
    height: Math.max(10, Math.round((value / max) * 100)),
  }));
}

function SparkBars({ values, tone = 'from-cyan-400 to-blue-500' }: { values: number[]; tone?: string }) {
  const bars = buildBars(values);
  return (
    <div className="flex h-28 items-end gap-2">
      {bars.map((bar) => (
        <div key={bar.id} className="flex-1 rounded-t-2xl bg-slate-100/80">
          <div
            className={`w-full rounded-t-2xl bg-gradient-to-t ${tone} shadow-[0_10px_30px_rgba(14,165,233,0.18)]`}
            style={{ height: `${bar.height}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function HorizontalMeter({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const width = total > 0 ? Math.max(6, Math.round((value / total) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{formatCompactNumber(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function TracesPage() {
  const TRACES_UI_KEY = 'traces_ui_state_v1';
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [localProjectId, setLocalProjectId] = useState<number | null>(null);
  const [platformProjectId, setPlatformProjectId] = useState<string | null>(null);

  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [localTraces, setLocalTraces] = useState<LocalTrace[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedLocalTrace, setSelectedLocalTrace] = useState<LocalTrace | null>(null);
  const [localToolTraces, setLocalToolTraces] = useState<LocalToolTrace[]>([]);
  const [localToolLoading, setLocalToolLoading] = useState(false);
  const [localToolError, setLocalToolError] = useState<string | null>(null);
  const [selectedToolTrace, setSelectedToolTrace] = useState<LocalToolTrace | null>(null);

  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'platform' | 'local-agent' | 'local-tool'>('platform');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<RunDetail | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetailError, setRunDetailError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(10);
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(10);
  const [localToolPage, setLocalToolPage] = useState(1);
  const [localToolPageSize, setLocalToolPageSize] = useState(10);
  const [stateReady, setStateReady] = useState(false);

  useEffect(() => {
    const persisted = loadPersisted<any>(TRACES_UI_KEY, {});
    if (persisted && typeof persisted === 'object') {
      if (typeof persisted.localProjectId === 'number') setLocalProjectId(persisted.localProjectId);
      if (persisted.viewMode === 'platform' || persisted.viewMode === 'local-agent' || persisted.viewMode === 'local-tool') setViewMode(persisted.viewMode);
      if (typeof persisted.q === 'string') setQ(persisted.q);
      if (typeof persisted.status === 'string') setStatus(persisted.status);
      if (typeof persisted.kind === 'string') setKind(persisted.kind);
      if (typeof persisted.from === 'string') setFrom(persisted.from);
      if (typeof persisted.to === 'string') setTo(persisted.to);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    savePersisted(TRACES_UI_KEY, {
      localProjectId,
      viewMode,
      q,
      status,
      kind,
      from,
      to,
    });
  }, [stateReady, localProjectId, viewMode, q, status, kind, from, to]);

  const loadProjects = async () => {
    const res = await fetch('/api/projects', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json().catch(() => []);
    setProjects(Array.isArray(data) ? data : []);
    if (localProjectId == null && Array.isArray(data) && data.length) setLocalProjectId(data[0].id);
  };

  const loadPlatformLink = async (pid: number) => {
    const res = await fetch(`/api/projects/${pid}/platform-link`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setPlatformProjectId(null);
    setPlatformProjectId(data.platformProjectId ?? null);
  };

  const loadLocalTraces = async () => {
    if (localProjectId == null) {
      setLocalTraces([]);
      return;
    }
    setLocalLoading(true);
    setLocalError(null);
    try {
      const res = await fetch(`/api/projects/${localProjectId}/traces`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load local traces');
      setLocalTraces(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setLocalError(e.message || 'Failed to load local traces');
    } finally {
      setLocalLoading(false);
    }
  };

  const loadLocalToolTraces = async () => {
    if (localProjectId == null) {
      setLocalToolTraces([]);
      return;
    }
    setLocalToolLoading(true);
    setLocalToolError(null);
    try {
      const res = await fetch(`/api/projects/${localProjectId}/tool-traces`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Failed to load local tool traces');
      setLocalToolTraces(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setLocalToolError(e.message || 'Failed to load local tool traces');
    } finally {
      setLocalToolLoading(false);
    }
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
      setRuns(Array.isArray(data) ? data : []);
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

  const loadRunDetail = async (runId: string) => {
    setRunDetailLoading(true);
    setRunDetailError(null);
    try {
      const res = await fetch(`/api/v1/runs/${runId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load run details');
      setSelectedRunDetail(data as RunDetail);
    } catch (e: any) {
      setRunDetailError(e.message || 'Failed to load run details');
      setSelectedRunDetail(null);
    } finally {
      setRunDetailLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (localProjectId == null) return;
    loadPlatformLink(localProjectId);
  }, [localProjectId]);

  useEffect(() => {
    if (localProjectId == null) return;
    loadLocalTraces();
    loadLocalToolTraces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localProjectId]);

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
  }, [localTraces.length, localProjectId]);

  useEffect(() => {
    setLocalToolPage(1);
  }, [localToolTraces.length, localProjectId]);

  const pagedRuns = useMemo(() => {
    const start = (runsPage - 1) * runsPageSize;
    return runs.slice(start, start + runsPageSize);
  }, [runs, runsPage, runsPageSize]);

  const pagedLocalTraces = useMemo(() => {
    const start = (localPage - 1) * localPageSize;
    return localTraces.slice(start, start + localPageSize);
  }, [localTraces, localPage, localPageSize]);

  const pagedLocalToolTraces = useMemo(() => {
    const start = (localToolPage - 1) * localToolPageSize;
    return localToolTraces.slice(start, start + localToolPageSize);
  }, [localToolTraces, localToolPage, localToolPageSize]);

  useEffect(() => {
    if (!platformProjectId) {
      setViewMode('local-agent');
    } else if (viewMode !== 'platform') {
      setViewMode('platform');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformProjectId]);

  const selectedProject = useMemo(() => projects.find((p) => p.id === localProjectId) || null, [projects, localProjectId]);
  const runStatusCounts = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    }, {});
  }, [runs]);
  const localToolStatusCounts = useMemo(() => {
    return localToolTraces.reduce<Record<string, number>>((acc, trace) => {
      acc[trace.status] = (acc[trace.status] || 0) + 1;
      return acc;
    }, {});
  }, [localToolTraces]);
  const platformActivityBars = useMemo(() => {
    return buildBars(
      runs
        .slice(0, 14)
        .reverse()
        .map((run) => (run.promptTokens || 0) + (run.completionTokens || 0))
    );
  }, [runs]);
  const localAgentActivityBars = useMemo(() => {
    return buildBars(
      localTraces
        .slice(0, 14)
        .reverse()
        .map((trace) => (trace.prompt_tokens || 0) + (trace.completion_tokens || 0))
    );
  }, [localTraces]);
  const localToolActivityBars = useMemo(() => {
    return buildBars(
      localToolTraces
        .slice(0, 14)
        .reverse()
        .map((trace) => Number(trace.duration_ms || 0))
    );
  }, [localToolTraces]);
  const topProviders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      const tags: any = run.tags && typeof run.tags === 'object' ? run.tags : {};
      const provider = String(tags?.provider ?? tags?.llm?.provider ?? 'unknown');
      counts.set(provider, (counts.get(provider) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [runs]);
  const topToolTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trace of localToolTraces) {
      const type = String(trace.tool_type || 'custom');
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [localToolTraces]);
  const activeSummary = useMemo(() => {
    if (viewMode === 'platform') {
      const totalTokens = runs.reduce((sum, run) => sum + Number(run.promptTokens || 0) + Number(run.completionTokens || 0), 0);
      const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCostUsd || 0), 0);
      const avgDuration = runs.length
        ? Math.round(runs.reduce((sum, run) => sum + Number(run.durationMs || 0), 0) / runs.length)
        : 0;
      return {
        title: 'Platform Signal Grid',
        subtitle: 'Live model economics, run quality, and execution pressure across the linked project.',
        cards: [
          { label: 'Runs', value: formatCompactNumber(runs.length), icon: Activity },
          { label: 'Tokens', value: formatCompactNumber(totalTokens), icon: BarChart3 },
          { label: 'Cost', value: formatUsd(totalCost), icon: DollarSign },
          { label: 'Avg Duration', value: avgDuration ? `${avgDuration}ms` : '—', icon: Clock3 },
        ],
        bars: platformActivityBars.map((x) => x.value),
      };
    }
    if (viewMode === 'local-tool') {
      const avgDuration = localToolTraces.length
        ? Math.round(localToolTraces.reduce((sum, trace) => sum + Number(trace.duration_ms || 0), 0) / localToolTraces.length)
        : 0;
      return {
        title: 'Tool Execution Matrix',
        subtitle: 'Operational view of local tool calls, runtimes, and failure pressure.',
        cards: [
          { label: 'Tool Calls', value: formatCompactNumber(localToolTraces.length), icon: Wrench },
          { label: 'Failures', value: formatCompactNumber(localToolStatusCounts.failed || 0), icon: TrendingUp },
          { label: 'Running', value: formatCompactNumber(localToolStatusCounts.running || 0), icon: Activity },
          { label: 'Avg Duration', value: avgDuration ? `${avgDuration}ms` : '—', icon: Clock3 },
        ],
        bars: localToolActivityBars.map((x) => x.value),
      };
    }
    const totalTokens = localTraces.reduce((sum, trace) => sum + Number(trace.prompt_tokens || 0) + Number(trace.completion_tokens || 0), 0);
    const totalCost = localTraces.reduce((sum, trace) => sum + Number(trace.total_cost || 0), 0);
    return {
      title: 'Agent Runtime Lens',
      subtitle: 'Local execution telemetry across agent runs, output cost, and prompt load.',
      cards: [
        { label: 'Agent Runs', value: formatCompactNumber(localTraces.length), icon: Bot },
        { label: 'Tokens', value: formatCompactNumber(totalTokens), icon: BarChart3 },
        { label: 'Cost', value: formatUsd(totalCost), icon: DollarSign },
        { label: 'Projects', value: formatCompactNumber(projects.length), icon: Activity },
      ],
      bars: localAgentActivityBars.map((x) => x.value),
    };
  }, [viewMode, runs, localToolTraces, localToolStatusCounts, localAgentActivityBars, localToolActivityBars, platformActivityBars, localTraces, projects.length]);

  return (
    <div className="w-full">
      <div className="swarm-hero p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
              <Activity size={12} />
              Observability Fabric
            </div>
            <h1 className="text-3xl font-black text-white">Traces</h1>
            <p className="text-slate-300 mt-1 max-w-3xl">{activeSummary.title}. {activeSummary.subtitle}</p>
          </div>
          <div className="hidden lg:flex min-w-[260px] flex-col rounded-3xl border border-white/10 bg-slate-950/30 p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Pulse Stream</div>
            <div className="mt-3">
              <SparkBars values={activeSummary.bars} />
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {activeSummary.cards.map((card) => (
            <div key={card.label} className="telemetry-tile p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{card.label}</div>
                <card.icon size={16} className="text-brand-200" />
              </div>
              <div className="mt-2 text-3xl font-black text-white">{card.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setViewMode('platform')}
          disabled={!platformProjectId}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${viewMode === 'platform' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'} ${!platformProjectId ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          Platform Runs
        </button>
        <button
          onClick={() => setViewMode('local-agent')}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${viewMode === 'local-agent' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Local Agent Traces
        </button>
        <button
          onClick={() => setViewMode('local-tool')}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${viewMode === 'local-tool' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          Local Tool Traces
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Project</label>
            <select
              value={localProjectId ?? ''}
              onChange={(e) => setLocalProjectId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Choose…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Search</label>
            <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white">
              <Search size={16} className="text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} className="w-full outline-none text-sm" placeholder="Run, agent, model, trace id…" />
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm" />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm" />
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

          <div className="md:col-span-12 flex justify-between items-center">
            <div className="text-xs text-slate-500">
              {selectedProject ? (
                platformProjectId ? (
                  <span>Linked platform project: <span className="font-mono">{platformProjectId}</span></span>
                ) : (
                  <span>Project not linked to platform traces. Link it from <Link className="underline" to="/projects">Projects</Link>.</span>
                )
              ) : 'Select a project.'}
            </div>
            <button
              onClick={() => {
                if (!selectedProject) return;
                if (viewMode === 'local-agent') {
                  loadLocalTraces();
                  return;
                }
                if (viewMode === 'local-tool') {
                  loadLocalToolTraces();
                  return;
                }
                if (!platformProjectId) {
                  setRunsError('Project not linked to platform traces. Link it from Projects.');
                  return;
                }
                loadRuns();
                loadInsights();
              }}
              disabled={!selectedProject}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              <Filter size={16} /> Apply
            </button>
          </div>
        </div>
      </div>

      {(runsError || insightsError || localError || localToolError) && (
        <div className="mb-6 p-4 border border-amber-200 bg-amber-50 text-amber-900 rounded-xl text-sm">
          <div className="font-medium">Traces couldn’t load</div>
          <div className="mt-1">{runsError || insightsError || localError || localToolError}</div>
          <div className="mt-2 flex items-center gap-3">
            <Link to="/auth" className="underline">Sign in</Link>
            <button onClick={() => { loadRuns(); loadInsights(); loadLocalTraces(); loadLocalToolTraces(); }} className="underline">Retry</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 mb-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Execution Topology</div>
              <div className="text-xs text-slate-500 mt-1">
                {viewMode === 'platform' ? 'Run status distribution and provider mix.' : viewMode === 'local-tool' ? 'Tool status distribution and runtime mix.' : 'Agent execution density and prompt-load profile.'}
              </div>
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
              {selectedProject?.name || 'No project'}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Status Pressure</div>
              {viewMode === 'platform' ? (
                <div className="space-y-4">
                  <HorizontalMeter label="Completed" value={runStatusCounts.completed || 0} total={runs.length} tone="bg-emerald-500" />
                  <HorizontalMeter label="Running" value={runStatusCounts.running || 0} total={runs.length} tone="bg-amber-500" />
                  <HorizontalMeter label="Failed" value={runStatusCounts.failed || 0} total={runs.length} tone="bg-red-500" />
                </div>
              ) : viewMode === 'local-tool' ? (
                <div className="space-y-4">
                  <HorizontalMeter label="Completed" value={localToolStatusCounts.completed || 0} total={localToolTraces.length} tone="bg-emerald-500" />
                  <HorizontalMeter label="Running" value={localToolStatusCounts.running || 0} total={localToolTraces.length} tone="bg-amber-500" />
                  <HorizontalMeter label="Failed" value={localToolStatusCounts.failed || 0} total={localToolTraces.length} tone="bg-red-500" />
                </div>
              ) : (
                <div className="space-y-4">
                  <HorizontalMeter label="Prompt Tokens" value={localTraces.reduce((sum, trace) => sum + Number(trace.prompt_tokens || 0), 0)} total={Math.max(1, localTraces.reduce((sum, trace) => sum + Number(trace.prompt_tokens || 0) + Number(trace.completion_tokens || 0), 0))} tone="bg-sky-500" />
                  <HorizontalMeter label="Completion Tokens" value={localTraces.reduce((sum, trace) => sum + Number(trace.completion_tokens || 0), 0)} total={Math.max(1, localTraces.reduce((sum, trace) => sum + Number(trace.prompt_tokens || 0) + Number(trace.completion_tokens || 0), 0))} tone="bg-indigo-500" />
                  <HorizontalMeter label="Total Cost (cents x100)" value={Math.round(localTraces.reduce((sum, trace) => sum + Number(trace.total_cost || 0), 0) * 10000)} total={Math.max(1, Math.round(localTraces.reduce((sum, trace) => sum + Number(trace.total_cost || 0), 0) * 10000))} tone="bg-emerald-500" />
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">
                {viewMode === 'platform' ? 'Provider Mix' : viewMode === 'local-tool' ? 'Tool Type Mix' : 'Recent Throughput'}
              </div>
              {viewMode === 'platform' ? (
                <div className="space-y-4">
                  {topProviders.length ? topProviders.map(([provider, count]) => (
                    <div key={provider}>
                      <HorizontalMeter label={provider} value={count} total={runs.length} tone="bg-cyan-500" />
                    </div>
                  )) : <div className="text-sm text-slate-500">No provider data yet.</div>}
                </div>
              ) : viewMode === 'local-tool' ? (
                <div className="space-y-4">
                  {topToolTypes.length ? topToolTypes.map(([type, count]) => (
                    <div key={type}>
                      <HorizontalMeter label={type} value={count} total={localToolTraces.length} tone="bg-violet-500" />
                    </div>
                  )) : <div className="text-sm text-slate-500">No tool calls yet.</div>}
                </div>
              ) : (
                <SparkBars values={localAgentActivityBars.map((x) => x.value)} tone="from-sky-400 to-indigo-500" />
              )}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Query Radar</div>
          <div className="text-xs text-slate-500 mt-1">Fast summary of the currently selected trace lane.</div>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Current Scope</div>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {viewMode === 'platform' ? 'Platform Runs' : viewMode === 'local-tool' ? 'Local Tool Traces' : 'Local Agent Traces'}
              </div>
              <div className="mt-1 text-sm text-slate-500">{selectedProject?.name || 'Choose a project to inspect telemetry.'}</div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Filters</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[status, kind, q ? `q:${q}` : '', from ? 'from' : '', to ? 'to' : ''].filter(Boolean).length ? (
                  [status, kind, q ? `q:${q}` : '', from ? 'from' : '', to ? 'to' : '']
                    .filter(Boolean)
                    .map((item) => (
                      <span key={item} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                        {item}
                      </span>
                    ))
                ) : (
                  <span className="text-sm text-slate-500">No query filters active.</span>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">What To Watch</div>
              <div className="mt-2 text-sm text-slate-600">
                {viewMode === 'platform'
                  ? 'Look for rising failed runs, sudden prompt-token spikes, and provider concentration.'
                  : viewMode === 'local-tool'
                    ? 'Watch long-tail tool duration and repeated failed calls from the same agent.'
                    : 'Watch prompt/completion imbalance and high-cost local executions.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <Activity size={18} /> Trace Stream
          </div>
          <div className="text-sm text-slate-500">
            {insightsLoading ? 'Loading insights…' : insights ? `Total tokens: ${insights.summary.total_tokens} · Cost: $${Number(insights.summary.total_cost_usd || 0).toFixed(4)}` : ''}
          </div>
        </div>

        <div className="overflow-x-auto">
          {viewMode === 'platform' && platformProjectId ? (
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
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={11}>Loading runs...</td></tr>
                ) : runs.length === 0 ? (
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={11}>No runs found.</td></tr>
                ) : (
                  pagedRuns.map((r) => {
                    const tags: any = r.tags && typeof r.tags === 'object' ? r.tags : {};
                    const origin = tags?.ingest?.source ?? '—';
                    const initiator = tags?.orchestrator?.initiated_by ?? '—';
                    const provider = tags?.provider ?? tags?.llm?.provider ?? '—';
                    const model = tags?.model ?? tags?.llm?.model ?? '—';
                    const duration = r.durationMs ?? tags?.metrics?.max?.duration_ms ?? null;
                    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => {
                          setSelectedRunId(r.id);
                          loadRunDetail(r.id);
                        }}
                        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <Link to={`/traces/${r.id}?back=${encodeURIComponent('/traces')}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
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
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${statusBadgeTone(r.status)}`}>
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
          ) : viewMode === 'local-tool' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="px-4 py-3">Tool</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Invoked</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {localToolLoading ? (
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={5}>Loading local tool traces...</td></tr>
                ) : localToolTraces.length === 0 ? (
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={5}>No local tool traces found for this project.</td></tr>
                ) : (
                  pagedLocalToolTraces.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedToolTrace(t)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{t.tool_name}</div>
                        <div className="text-xs text-slate-400 uppercase">{t.tool_type || 'custom'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-800">{t.agent_name}</div>
                        <div className="text-xs text-slate-400">{t.agent_role}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${statusBadgeTone(t.status)}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{t.duration_ms == null ? '—' : `${t.duration_ms}ms`}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Invoked</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {localLoading ? (
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={5}>Loading local traces...</td></tr>
                ) : localTraces.length === 0 ? (
                  <tr className="border-t border-slate-100"><td className="px-4 py-6 text-center text-slate-500" colSpan={5}>No local traces found for this project.</td></tr>
                ) : (
                  pagedLocalTraces.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedLocalTrace(t)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">{t.agent_name}</td>
                      <td className="px-4 py-3">{t.agent_role}</td>
                      <td className="px-4 py-3">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <MessageSquare size={14} /> {(t.prompt_tokens + t.completion_tokens).toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <DollarSign size={14} /> {Number(t.total_cost || 0).toFixed(4)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-slate-100">
          {viewMode === 'platform' ? (
            <Pagination
              page={runsPage}
              pageSize={runsPageSize}
              total={runs.length}
              onPageChange={setRunsPage}
              onPageSizeChange={setRunsPageSize}
            />
          ) : viewMode === 'local-tool' ? (
            <Pagination
              page={localToolPage}
              pageSize={localToolPageSize}
              total={localToolTraces.length}
              onPageChange={setLocalToolPage}
              onPageSizeChange={setLocalToolPageSize}
            />
          ) : (
            <Pagination
              page={localPage}
              pageSize={localPageSize}
              total={localTraces.length}
              onPageChange={setLocalPage}
              onPageSizeChange={setLocalPageSize}
            />
          )}
        </div>
      </div>

      {selectedLocalTrace && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
          onClick={() => setSelectedLocalTrace(null)}
        >
          <div
            className="bg-white w-[min(96vw,1500px)] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="text-lg font-bold text-slate-900">Local Trace Details</div>
              <button
                onClick={() => setSelectedLocalTrace(null)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="flex items-center gap-3 text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="font-semibold text-slate-700">{selectedLocalTrace.agent_name}</span>
                <span className="text-slate-300">|</span>
                <span>{new Date(selectedLocalTrace.created_at).toLocaleString()}</span>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                  Input Prompt
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-sm text-indigo-100 whitespace-pre-wrap font-mono leading-relaxed shadow-inner overflow-x-auto">
                  {selectedLocalTrace.input || 'No input recorded.'}
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  Agent Response
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-sm text-emerald-50 whitespace-pre-wrap font-mono leading-relaxed shadow-inner overflow-x-auto">
                  {selectedLocalTrace.output || 'No output recorded.'}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-50 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => setSelectedLocalTrace(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedToolTrace && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
          onClick={() => setSelectedToolTrace(null)}
        >
          <div
            className="bg-white w-[min(96vw,1500px)] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="text-lg font-bold text-slate-900">Tool Trace Details</div>
              <button
                onClick={() => setSelectedToolTrace(null)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="font-semibold text-slate-800">{selectedToolTrace.tool_name}</span>
                <span className="text-slate-300">|</span>
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-bold uppercase">{selectedToolTrace.tool_type || 'custom'}</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-600 font-medium">{selectedToolTrace.agent_name}</span>
                <span className="text-slate-300">|</span>
                <span>{new Date(selectedToolTrace.created_at).toLocaleString()}</span>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                  Arguments (JSON)
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-sm text-blue-100 whitespace-pre-wrap font-mono leading-relaxed shadow-inner overflow-x-auto">
                  {selectedToolTrace.args || 'No args recorded.'}
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                  Tool Execution Result
                </div>
                <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 text-sm whitespace-pre-wrap font-mono leading-relaxed shadow-inner overflow-x-auto ${selectedToolTrace.error ? 'text-red-300' : 'text-amber-50'}`}>
                  {selectedToolTrace.result || selectedToolTrace.error || 'No result recorded.'}
                </div>
              </div>
              
              {selectedToolTrace.duration_ms && (
                <div className="text-xs text-slate-400 font-medium">
                  Execution Time: <span className="text-slate-600">{selectedToolTrace.duration_ms}ms</span>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-50 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => setSelectedToolTrace(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRunId && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
          onClick={() => {
            setSelectedRunId(null);
            setSelectedRunDetail(null);
            setRunDetailError(null);
          }}
        >
          <div 
            className="bg-white w-full max-w-5xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="text-lg font-bold text-slate-900">Platform Run Spectrum</div>
              <button
                onClick={() => {
                  setSelectedRunId(null);
                  setSelectedRunDetail(null);
                  setRunDetailError(null);
                }}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {runDetailLoading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-sm font-medium text-slate-500 italic">Synchronizing run events...</div>
                </div>
              ) : runDetailError ? (
                <div className="p-6 bg-red-50 border border-red-100 rounded-xl text-red-800 flex items-start gap-3">
                  <div className="text-lg font-bold">⚠️</div>
                  <div className="text-sm">{runDetailError}</div>
                </div>
              ) : selectedRunDetail ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <span className="font-bold text-slate-900 px-3 py-1 bg-white rounded-lg shadow-sm border border-slate-200">
                      {selectedRunDetail.run.name || selectedRunDetail.run.id}
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="flex items-center gap-2">
                       <span className={`w-2 h-2 rounded-full ${selectedRunDetail.run.status === 'completed' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'}`}></span>
                       <span className="font-medium text-slate-700 capitalize">{selectedRunDetail.run.status}</span>
                    </span>
                    <span className="text-slate-300">|</span>
                    <span className="font-mono text-xs">{new Date(selectedRunDetail.run.startedAt).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Prompt Tokens</div>
                      <div className="mt-2 text-2xl font-black text-slate-900">{formatCompactNumber(selectedRunDetail.run.promptTokens || 0)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Completion Tokens</div>
                      <div className="mt-2 text-2xl font-black text-slate-900">{formatCompactNumber(selectedRunDetail.run.completionTokens || 0)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Cost</div>
                      <div className="mt-2 text-2xl font-black text-emerald-700">{formatUsd(Number(selectedRunDetail.run.totalCostUsd || 0))}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Events</div>
                      <div className="mt-2 text-2xl font-black text-slate-900">{formatCompactNumber(selectedRunDetail.events?.length || 0)}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">Event Flow Chronology</div>
                    {selectedRunDetail.events?.length ? (
                      selectedRunDetail.events
                        .filter((e) => e.inputText || e.outputText)
                        .slice(0, 50)
                        .map((e) => (
                          <div key={e.id} className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                            <div className="p-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                              <div className="text-xs font-bold text-slate-600 flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-sm ${e.type.includes('tool') ? 'bg-purple-500' : 'bg-blue-500'}`}></span>
                                {e.name || e.type}
                              </div>
                              <div className="text-[10px] font-medium text-slate-400 font-mono">
                                {new Date(e.ts).toLocaleTimeString()}
                              </div>
                            </div>
                            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white">
                              {e.inputText && (
                                <div className="space-y-2">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2">Stimulus Ingest</div>
                                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {e.inputText}
                                  </div>
                                </div>
                              )}
                              {e.outputText && (
                                <div className="space-y-2">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2">Response Output</div>
                                  <div className="bg-emerald-50/30 border border-emerald-100/50 rounded-xl p-4 text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {e.outputText}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-400 italic text-sm">
                        No significant runtime events captured during this cycle.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-500 italic">No diagnostic run details are available for this specific trace.</div>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button 
                onClick={() => {
                   setSelectedRunId(null);
                   setSelectedRunDetail(null);
                   setRunDetailError(null);
                }}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-md active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
