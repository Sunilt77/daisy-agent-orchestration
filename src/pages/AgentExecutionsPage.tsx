import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Search, Link2 } from 'lucide-react';
import Pagination from '../components/Pagination';

type AgentExecutionRow = {
  id: number;
  agentId?: number | null;
  agent_id?: number | null;
  agent_name?: string;
  status?: string;
  executionKind?: string;
  execution_kind?: string;
  task?: string | null;
  promptTokens?: number;
  prompt_tokens?: number;
  completionTokens?: number;
  completion_tokens?: number;
  totalCost?: number;
  total_cost?: number;
  createdAt?: string;
  created_at?: string;
};

function statusClass(status?: string) {
  const value = String(status || '').toLowerCase();
  if (value === 'failed' || value === 'canceled') return 'bg-red-100 text-red-700';
  if (value === 'running' || value === 'pending') return 'bg-blue-100 text-blue-700';
  return 'bg-emerald-100 text-emerald-700';
}

export default function AgentExecutionsPage() {
  const [rows, setRows] = useState<AgentExecutionRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [executionKind, setExecutionKind] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const statusParam = useMemo(() => status.trim().toLowerCase(), [status]);
  const queryParam = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        if (statusParam) params.set('status', statusParam);
        if (executionKind) params.set('execution_kind', executionKind);
        if (queryParam) params.set('q', queryParam);

        const res = await fetch(`/api/agent-executions?${params.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load agent executions');
        setRows(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number(data?.total || 0));
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load agent executions');
      } finally {
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [page, pageSize, statusParam, executionKind, queryParam]);

  useEffect(() => setPage(1), [statusParam, executionKind, queryParam, pageSize]);

  const copyExecutionLink = async (id: number) => {
    const url = `${window.location.origin}/agent-executions/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((value) => (value === id ? null : value)), 1500);
    } catch {
      setError('Failed to copy link');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Agent Executions</h1>
          <p className="text-slate-500 mt-1">Browse all executions and open full timelines.</p>
        </div>
        <Link to="/task-control" className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
          Open Task Control
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by agent, task, input, or output..."
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="ui-select"
          >
            <option value="">All Statuses</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
          <select
            value={executionKind}
            onChange={(e) => setExecutionKind(e.target.value)}
            className="ui-select"
          >
            <option value="">All Kinds</option>
            <option value="standard">Standard</option>
            <option value="delegated_parent">Supervisor</option>
            <option value="delegated_child">Delegate</option>
            <option value="delegated_synthesis">Synthesis</option>
          </select>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center gap-2">
          <Activity size={16} /> Execution List
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-medium">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3 text-right">Tokens</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => {
                const prompt = Number(row.prompt_tokens ?? row.promptTokens ?? 0);
                const completion = Number(row.completion_tokens ?? row.completionTokens ?? 0);
                const cost = Number(row.total_cost ?? row.totalCost ?? 0);
                const createdAt = String(row.created_at ?? row.createdAt ?? '');
                const task = String(row.task || '').trim();
                const kind = String(row.execution_kind ?? row.executionKind ?? 'standard');
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-900">#{row.id}</td>
                    <td className="px-4 py-3">{row.agent_name || `Agent ${row.agent_id || row.agentId || '-'}`}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusClass(row.status)}`}>
                        {row.status || 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{kind}</td>
                    <td className="px-4 py-3 max-w-[360px] truncate" title={task || 'No task'}>
                      {task || <span className="text-slate-400">No task</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{(prompt + completion).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700">${cost.toFixed(6)}</td>
                    <td className="px-4 py-3 text-slate-500">{createdAt ? new Date(createdAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyExecutionLink(row.id)}
                          className="text-xs px-3 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1"
                        >
                          <Link2 size={12} />
                          {copiedId === row.id ? 'Copied' : 'Copy Link'}
                        </button>
                        <Link
                          to={`/agent-executions/${row.id}`}
                          className="text-xs px-3 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">No executions found for the current filters.</div>
        )}
        <div className="p-4 border-t border-slate-100">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        </div>
      </section>
    </div>
  );
}
