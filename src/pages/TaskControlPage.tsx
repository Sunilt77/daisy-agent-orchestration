import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Square, RotateCcw, Trash2, Search, Activity, Bot, Clock3, AlertTriangle } from 'lucide-react';
import Pagination from '../components/Pagination';

type AgentRun = { id: number; agent_id: number; task?: string; created_at: string; agent_name: string; agent_role?: string };
type CrewRun = { id: number; crew_id: number; initial_input?: string; created_at: string; crew_name: string; process?: string };
type PendingJob = { id: number; type: string; status: string; created_at: string; payload?: any };
type FailedAgent = { id: number; agent_id: number; task?: string; created_at: string; agent_name: string };
type FailedCrew = { id: number; crew_id: number; initial_input?: string; created_at: string; crew_name: string };
type RuntimeMetrics = {
  lookback_hours: number;
  queue_depth_pending: number;
  jobs_total: number;
  jobs_terminal: number;
  jobs_failed: number;
  throughput_per_minute: number;
  failure_rate_pct: number;
  queue_wait_ms: { p50: number; p95: number; p99: number };
  run_duration_ms: { p50: number; p95: number; p99: number };
  max_attempts: number;
  jobs_by_type: Record<string, number>;
};

export default function TaskControlPage() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [runningAgentExecutions, setRunningAgentExecutions] = useState<AgentRun[]>([]);
  const [runningCrewExecutions, setRunningCrewExecutions] = useState<CrewRun[]>([]);
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);
  const [failedAgentExecutions, setFailedAgentExecutions] = useState<FailedAgent[]>([]);
  const [failedCrewExecutions, setFailedCrewExecutions] = useState<FailedCrew[]>([]);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null);
  const [runningAgentPage, setRunningAgentPage] = useState(1);
  const [runningCrewPage, setRunningCrewPage] = useState(1);
  const [pendingJobsPage, setPendingJobsPage] = useState(1);
  const [failedAgentPage, setFailedAgentPage] = useState(1);
  const [failedCrewPage, setFailedCrewPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [query, setQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState<'all' | 'running' | 'pending' | 'failed'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/task-control');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load task control');
      setRunningAgentExecutions(Array.isArray(data.runningAgentExecutions) ? data.runningAgentExecutions : []);
      setRunningCrewExecutions(Array.isArray(data.runningCrewExecutions) ? data.runningCrewExecutions : []);
      setPendingJobs(Array.isArray(data.pendingJobs) ? data.pendingJobs : []);
      setFailedAgentExecutions(Array.isArray(data.failedAgentExecutions) ? data.failedAgentExecutions : []);
      setFailedCrewExecutions(Array.isArray(data.failedCrewExecutions) ? data.failedCrewExecutions : []);
      setRuntimeMetrics(data.runtimeMetrics || null);
    } catch (e: any) {
      setMsg(e.message || 'Failed to load task control');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => setRunningAgentPage(1), [runningAgentExecutions.length]);
  useEffect(() => setRunningCrewPage(1), [runningCrewExecutions.length]);
  useEffect(() => setPendingJobsPage(1), [pendingJobs.length]);
  useEffect(() => setFailedAgentPage(1), [failedAgentExecutions.length]);
  useEffect(() => setFailedCrewPage(1), [failedCrewExecutions.length]);
  useEffect(() => {
    setRunningAgentPage(1);
    setRunningCrewPage(1);
    setPendingJobsPage(1);
    setFailedAgentPage(1);
    setFailedCrewPage(1);
  }, [query, sectionFilter, pageSize]);

  const postAction = async (url: string, successMessage: string) => {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Action failed');
    setMsg(successMessage);
    await load();
  };

  const sliceByPage = <T,>(rows: T[], page: number) => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  };

  const matchesQuery = (value: unknown) => JSON.stringify(value || {}).toLowerCase().includes(query.trim().toLowerCase());
  const filteredRunningAgentExecutions = useMemo(() => runningAgentExecutions.filter((row) => !query.trim() || matchesQuery(row)), [runningAgentExecutions, query]);
  const filteredRunningCrewExecutions = useMemo(() => runningCrewExecutions.filter((row) => !query.trim() || matchesQuery(row)), [runningCrewExecutions, query]);
  const filteredPendingJobs = useMemo(() => pendingJobs.filter((row) => !query.trim() || matchesQuery(row)), [pendingJobs, query]);
  const filteredFailedAgentExecutions = useMemo(() => failedAgentExecutions.filter((row) => !query.trim() || matchesQuery(row)), [failedAgentExecutions, query]);
  const filteredFailedCrewExecutions = useMemo(() => failedCrewExecutions.filter((row) => !query.trim() || matchesQuery(row)), [failedCrewExecutions, query]);

  const pagedRunningAgents = useMemo(() => sliceByPage(filteredRunningAgentExecutions, runningAgentPage), [filteredRunningAgentExecutions, runningAgentPage, pageSize]);
  const pagedRunningCrews = useMemo(() => sliceByPage(filteredRunningCrewExecutions, runningCrewPage), [filteredRunningCrewExecutions, runningCrewPage, pageSize]);
  const pagedPendingJobs = useMemo(() => sliceByPage(filteredPendingJobs, pendingJobsPage), [filteredPendingJobs, pendingJobsPage, pageSize]);
  const pagedFailedAgents = useMemo(() => sliceByPage(filteredFailedAgentExecutions, failedAgentPage), [filteredFailedAgentExecutions, failedAgentPage, pageSize]);
  const pagedFailedCrews = useMemo(() => sliceByPage(filteredFailedCrewExecutions, failedCrewPage), [filteredFailedCrewExecutions, failedCrewPage, pageSize]);
  const hasTaskFilters = query.trim().length > 0 || sectionFilter !== 'all';
  const filteredRunningTotal = filteredRunningAgentExecutions.length + filteredRunningCrewExecutions.length;
  const filteredFailureTotal = filteredFailedAgentExecutions.length + filteredFailedCrewExecutions.length;
  const filteredTotalRows = filteredRunningTotal + filteredPendingJobs.length + filteredFailureTotal;
  const rawTotalRows = runningAgentExecutions.length + runningCrewExecutions.length + pendingJobs.length + failedAgentExecutions.length + failedCrewExecutions.length;

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">Task Control Center</h1>
            <p className="text-slate-300 mt-1">Monitor active agent and crew workloads, queue health, and failure recovery in one place.</p>
          </div>
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-white text-sm inline-flex items-center gap-2 hover:bg-white/15"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">{msg}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[
          { label: 'Running Agents', value: runningAgentExecutions.length, icon: Bot },
          { label: 'Running Crews', value: runningCrewExecutions.length, icon: Activity },
          { label: 'Pending Jobs', value: pendingJobs.length, icon: Clock3 },
          { label: 'Failures', value: failedAgentExecutions.length + failedCrewExecutions.length, icon: AlertTriangle },
        ].map((item) => (
          <div key={item.label} className="telemetry-tile p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
              <item.icon size={16} className="text-brand-200" />
            </div>
            <div className="mt-2 text-3xl font-black text-white">{item.value}</div>
          </div>
        ))}
      </div>

      {runtimeMetrics && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900">Runtime Health (Last {runtimeMetrics.lookback_hours}h)</h2>
            <span className="text-xs text-slate-500">Ops telemetry</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Queue Wait P95</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.queue_wait_ms.p95}ms</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Run Duration P95</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.run_duration_ms.p95}ms</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Failure Rate</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.failure_rate_pct}%</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Throughput / Min</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.throughput_per_minute}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Terminal Jobs</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.jobs_terminal}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Max Attempts</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{runtimeMetrics.max_attempts}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Job mix: {Object.entries(runtimeMetrics.jobs_by_type || {}).map(([k, v]) => `${k}:${v}`).join(' | ') || 'n/a'}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <button className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm" onClick={() => postAction('/api/task-control/stop-running-agents', 'Stopped all running agent executions')}>
          Stop All Running Agents
        </button>
        <button className="px-3 py-2 rounded-lg bg-red-700 text-white text-sm" onClick={() => postAction('/api/task-control/stop-running-crews', 'Stopped all running crew executions')}>
          Stop All Running Crews
        </button>
        <button className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm" onClick={() => postAction('/api/task-control/cancel-pending-jobs', 'Canceled all pending jobs')}>
          Cancel All Pending Jobs
        </button>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, crews, jobs, or payloads..."
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div className="flex justify-end items-center gap-2">
            <span className="text-xs text-slate-500">Rows per section</span>
            <select className="ui-select !py-1 !text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              <option value={5}>5</option>
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { key: 'all', label: `All (${rawTotalRows})` },
            { key: 'running', label: `Running (${runningAgentExecutions.length + runningCrewExecutions.length})` },
            { key: 'pending', label: `Pending (${pendingJobs.length})` },
            { key: 'failed', label: `Failed (${failedAgentExecutions.length + failedCrewExecutions.length})` },
          ].map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSectionFilter(chip.key as 'all' | 'running' | 'pending' | 'failed')}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                sectionFilter === chip.key
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <div className="text-xs text-slate-500 ml-1">
            <span className="font-semibold text-slate-700">{filteredTotalRows}</span> visible of <span className="font-semibold text-slate-700">{rawTotalRows}</span>
          </div>
          <button
            type="button"
            disabled={!hasTaskFilters}
            onClick={() => { setQuery(''); setSectionFilter('all'); }}
            className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-45"
          >
            Reset Filters
          </button>
        </div>
        {hasTaskFilters && filteredTotalRows === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            No task-control rows match your current search/filter combination.
          </div>
        )}
      </div>

      {(sectionFilter === 'all' || sectionFilter === 'running') && (
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900 mb-3">Running Agent Executions ({runningAgentExecutions.length})</h2>
        <div className="space-y-2">
          {pagedRunningAgents.map((row) => (
            <div key={row.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{row.agent_name}</div>
                <div className="text-xs text-slate-500 truncate">{row.task || 'No task description'}</div>
              </div>
              <button className="text-xs px-3 py-1 rounded border border-red-200 text-red-600" onClick={() => postAction(`/api/agent-executions/${row.id}/cancel`, `Stopped agent execution ${row.id}`)}>
                <Square size={12} className="inline mr-1" /> Stop
              </button>
              <Link className="text-xs px-3 py-1 rounded border border-slate-200 text-slate-700" to={`/agent-executions/${row.id}`}>
                Open
              </Link>
            </div>
          ))}
          {!filteredRunningAgentExecutions.length && <div className="text-sm text-slate-500">No running agent executions.</div>}
        </div>
        <div className="mt-3">
          <Pagination page={runningAgentPage} pageSize={pageSize} total={filteredRunningAgentExecutions.length} onPageChange={setRunningAgentPage} />
        </div>
      </section>
      )}

      {(sectionFilter === 'all' || sectionFilter === 'running') && (
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900 mb-3">Running Crew Executions ({runningCrewExecutions.length})</h2>
        <div className="space-y-2">
          {pagedRunningCrews.map((row) => (
            <div key={row.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{row.crew_name}</div>
                <div className="text-xs text-slate-500 truncate">{row.initial_input || 'No initial input'}</div>
              </div>
              <button className="text-xs px-3 py-1 rounded border border-red-200 text-red-600" onClick={() => postAction(`/api/executions/${row.id}/cancel`, `Stopped crew execution ${row.id}`)}>
                <Square size={12} className="inline mr-1" /> Stop
              </button>
            </div>
          ))}
          {!filteredRunningCrewExecutions.length && <div className="text-sm text-slate-500">No running crew executions.</div>}
        </div>
        <div className="mt-3">
          <Pagination page={runningCrewPage} pageSize={pageSize} total={filteredRunningCrewExecutions.length} onPageChange={setRunningCrewPage} />
        </div>
      </section>
      )}

      {(sectionFilter === 'all' || sectionFilter === 'pending') && (
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900 mb-3">Pending Jobs ({pendingJobs.length})</h2>
        <div className="space-y-2">
          {pagedPendingJobs.map((row) => (
            <div key={row.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">#{row.id} {row.type}</div>
                <div className="text-xs text-slate-500 truncate">{JSON.stringify(row.payload || {})}</div>
              </div>
              <button className="text-xs px-3 py-1 rounded border border-amber-200 text-amber-700" onClick={() => postAction(`/api/task-control/jobs/${row.id}/cancel`, `Canceled pending job ${row.id}`)}>
                <Trash2 size={12} className="inline mr-1" /> Cancel
              </button>
            </div>
          ))}
          {!filteredPendingJobs.length && <div className="text-sm text-slate-500">No pending jobs.</div>}
        </div>
        <div className="mt-3">
          <Pagination page={pendingJobsPage} pageSize={pageSize} total={filteredPendingJobs.length} onPageChange={setPendingJobsPage} />
        </div>
      </section>
      )}

      {(sectionFilter === 'all' || sectionFilter === 'failed') && (
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold text-slate-900 mb-3">Failed Executions</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">Agents</div>
            {pagedFailedAgents.map((row) => (
              <div key={row.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{row.agent_name}</div>
                  <div className="text-xs text-slate-500 truncate">{row.task || 'No task description'}</div>
                </div>
                <button className="text-xs px-3 py-1 rounded border border-indigo-200 text-indigo-700" onClick={() => postAction(`/api/agent-executions/${row.id}/retry`, `Retried agent execution ${row.id}`)}>
                  <RotateCcw size={12} className="inline mr-1" /> Retry
                </button>
                <Link className="text-xs px-3 py-1 rounded border border-slate-200 text-slate-700" to={`/agent-executions/${row.id}`}>
                  Open
                </Link>
              </div>
            ))}
            {!filteredFailedAgentExecutions.length && <div className="text-sm text-slate-500">No failed agent executions.</div>}
            <Pagination page={failedAgentPage} pageSize={pageSize} total={filteredFailedAgentExecutions.length} onPageChange={setFailedAgentPage} />
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">Crews</div>
            {pagedFailedCrews.map((row) => (
              <div key={row.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{row.crew_name}</div>
                  <div className="text-xs text-slate-500 truncate">{row.initial_input || 'No input'}</div>
                </div>
                <button className="text-xs px-3 py-1 rounded border border-indigo-200 text-indigo-700" onClick={() => postAction(`/api/executions/${row.id}/retry`, `Retried crew execution ${row.id}`)}>
                  <RotateCcw size={12} className="inline mr-1" /> Retry
                </button>
              </div>
            ))}
            {!filteredFailedCrewExecutions.length && <div className="text-sm text-slate-500">No failed crew executions.</div>}
            <Pagination page={failedCrewPage} pageSize={pageSize} total={filteredFailedCrewExecutions.length} onPageChange={setFailedCrewPage} />
          </div>
        </div>
      </section>
      )}

      {loading && <div className="text-xs text-slate-500">Refreshing...</div>}
    </div>
  );
}
