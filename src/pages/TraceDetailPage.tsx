import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, Clock, DollarSign, MessageSquare, Radio, Square, Search, RotateCcw } from 'lucide-react';
import { getSelectedPlatformProjectId } from '../utils/platformSelection';

type Run = {
  id: string;
  projectId: string;
  name?: string | null;
  kind: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  traceId: string;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: string;
  tags?: any;
};

type RunEvent = {
  id: string;
  ts: string;
  type: string;
  spanId?: string | null;
  parentSpanId?: string | null;
  name?: string | null;
  status?: string | null;
  durationMs?: number | null;
  inputText?: string | null;
  outputText?: string | null;
  error?: any;
  attributes?: any;
};

export default function TraceDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams] = useSearchParams();
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [leftMode, setLeftMode] = useState<'timeline' | 'tree'>('timeline');
  const [eventSearch, setEventSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | string>('all');
  const [expandedSpans, setExpandedSpans] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const load = async () => {
    const res = await fetch(`/api/v1/runs/${runId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load run');
    setRun(data.run);
    setEvents(data.events || []);
    if (!selectedEventId && data.events?.length) setSelectedEventId(data.events[0].id);
  };

  useEffect(() => {
    if (!runId) return;
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    if (!live) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const es = new EventSource(`/api/v1/runs/${runId}/stream`);
    esRef.current = es;

    es.addEventListener('snapshot', (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data);
        setEvents(snap);
        if (!selectedEventId && snap.length) setSelectedEventId(snap[0].id);
      } catch {
        /* ignore */
      }
    });

    es.addEventListener('event', (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent).data);
        setEvents((prev) => [...prev, e]);
      } catch {
        /* ignore */
      }
    });

    es.onerror = () => {
      // leave it to browser retry; user can toggle off/on if needed
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runId]);

  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((event) => String(event.type || '').trim()).filter(Boolean))).sort(),
    [events]
  );
  const filteredEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    return events.filter((event) => {
      const matchesType = eventTypeFilter === 'all' || event.type === eventTypeFilter;
      if (!matchesType) return false;
      if (!query) return true;
      return `${event.name || ''} ${event.type || ''} ${event.inputText || ''} ${event.outputText || ''} ${JSON.stringify(event.attributes || {})}`.toLowerCase().includes(query);
    });
  }, [eventSearch, eventTypeFilter, events]);
  const hasEventFilters = eventSearch.trim().length > 0 || eventTypeFilter !== 'all';
  const selected = useMemo(() => filteredEvents.find(e => e.id === selectedEventId) || null, [filteredEvents, selectedEventId]);

  const spanTree = useMemo(() => {
    const bySpan = new Map<string, RunEvent[]>();
    for (const e of filteredEvents) {
      if (!e.spanId) continue;
      const list = bySpan.get(e.spanId) || [];
      list.push(e);
      bySpan.set(e.spanId, list);
    }
    for (const list of bySpan.values()) list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const nodes = new Map<string, { spanId: string; parentSpanId?: string | null; label: string; events: RunEvent[]; children: string[] }>();
    for (const [spanId, list] of bySpan.entries()) {
      const first = list[0];
      const label = first?.name || first?.type || spanId;
      nodes.set(spanId, { spanId, parentSpanId: first?.parentSpanId ?? null, label, events: list, children: [] });
    }
    for (const n of nodes.values()) {
      if (n.parentSpanId && nodes.has(n.parentSpanId)) nodes.get(n.parentSpanId)!.children.push(n.spanId);
    }
    for (const n of nodes.values()) n.children.sort();
    const roots = Array.from(nodes.values())
      .filter((n) => !n.parentSpanId || !nodes.has(n.parentSpanId))
      .map((n) => n.spanId);
    roots.sort();

    return { nodes, roots, hasSpans: nodes.size > 0 };
  }, [filteredEvents]);

  const tokens = (run?.promptTokens || 0) + (run?.completionTokens || 0);
  useEffect(() => {
    if (!selectedEventId && filteredEvents.length) {
      setSelectedEventId(filteredEvents[0].id);
      return;
    }
    if (selectedEventId && !filteredEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(filteredEvents[0]?.id || null);
    }
  }, [filteredEvents, selectedEventId]);
  const backTo = useMemo(() => {
    const explicitBack = searchParams.get('back');
    if (explicitBack) return explicitBack;
    const pid = run?.projectId || getSelectedPlatformProjectId();
    // The global Traces list is deprecated; fall back to Projects.
    return pid ? `/projects` : '/projects';
  }, [run?.projectId, searchParams]);

  return (
    <div className="w-full">
      <div className="mb-6">
        <Link to={backTo} className="text-indigo-600 hover:text-indigo-800 flex items-center gap-2 mb-4">
          <ArrowLeft size={16} /> Back to Traces
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{run?.name || run?.id}</h1>
            <div className="text-xs text-slate-500 font-mono break-all">Trace ID: {run?.traceId}</div>
          </div>
          <button
            onClick={() => setLive(v => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${live ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-white border-slate-200 text-slate-700'}`}
            title="Live tail via SSE"
          >
            {live ? <Radio size={16} /> : <Square size={16} />} Live
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          <div className="p-4 border-b border-slate-200 bg-slate-50 font-medium text-slate-700 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity size={18} /> {leftMode === 'tree' ? 'Hierarchy' : 'Timeline'}
            </div>
            {run && (
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${run.status === 'failed' ? 'bg-red-100 text-red-700' : run.status === 'running' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {run.status}
              </span>
            )}
          </div>
          <div className="p-3 border-b border-slate-100 flex items-center gap-2">
            <button
              onClick={() => setLeftMode('timeline')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${leftMode === 'timeline' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Timeline
            </button>
            <button
              disabled={!spanTree.hasSpans}
              onClick={() => setLeftMode('tree')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${leftMode === 'tree' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-60`}
              title={!spanTree.hasSpans ? 'No span hierarchy available for this run yet' : ''}
            >
              Hierarchy
            </button>
          </div>
          <div className="p-3 border-b border-slate-100 space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                placeholder="Search events..."
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="all">All Types</option>
                {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <button
                type="button"
                disabled={!hasEventFilters}
                onClick={() => { setEventSearch(''); setEventTypeFilter('all'); }}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-45 inline-flex items-center gap-1"
              >
                <RotateCcw size={11} />
                Reset
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {filteredEvents.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No events yet.</div>
            ) : leftMode === 'timeline' ? (
              filteredEvents.map(e => (
                <div
                  key={e.id}
                  onClick={() => setSelectedEventId(e.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedEventId === e.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-300'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-slate-900 text-sm truncate">{e.name || e.type}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap ml-2">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center justify-between">
                    <span className="font-mono">{e.type}</span>
                    {e.durationMs != null && <span>{e.durationMs}ms</span>}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-1">
                {spanTree.roots.map((rootId) => {
                  const renderNode = (spanId: string, depth: number): React.ReactNode => {
                    const node = spanTree.nodes.get(spanId);
                    if (!node) return null;
                    const isExpanded = expandedSpans[spanId] ?? true;
                    const firstEvent = node.events[0];
                    const time = firstEvent ? new Date(firstEvent.ts).toLocaleTimeString() : '';
                    const hasChildren = node.children.length > 0;
                    return (
                      <div key={spanId}>
                        <div
                          onClick={() => {
                            setSelectedEventId(node.events[0]?.id || null);
                            if (hasChildren) setExpandedSpans((p) => ({ ...p, [spanId]: !isExpanded }));
                          }}
                          className={`px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedEventId === node.events[0]?.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-300'}`}
                          style={{ marginLeft: depth * 12 }}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900 truncate">{node.label}</div>
                              <div className="text-xs text-slate-500 font-mono truncate">{spanId}</div>
                            </div>
                            <div className="text-xs text-slate-500 whitespace-nowrap">{time}</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-600 flex items-center justify-between">
                            <span>{node.events.length} events</span>
                            {hasChildren && <span>{isExpanded ? '−' : '+'}</span>}
                          </div>
                        </div>
                        {hasChildren && isExpanded && (
                          <div className="mt-1 space-y-1">
                            {node.children.map((c) => renderNode(c, depth + 1))}
                          </div>
                        )}
                      </div>
                    );
                  };
                  return renderNode(rootId, 0);
                })}
                {spanTree.roots.length === 0 && (
                  <div className="p-4 text-center text-slate-500 text-sm">No span hierarchy available.</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[800px]">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4 items-center text-sm text-slate-600">
            {run && (
              <>
                <span className="flex items-center gap-1"><Clock size={14} /> {new Date(run.startedAt).toLocaleString()}</span>
                <span className="flex items-center gap-1 text-slate-700"><MessageSquare size={14} /> {tokens.toLocaleString()}</span>
                <span className="flex items-center gap-1 text-emerald-700"><DollarSign size={14} /> {Number(run.totalCostUsd || 0).toFixed(4)}</span>
              </>
            )}
          </div>

          <div className="overflow-y-auto flex-1 p-6 space-y-6">
            {run && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Run Insights</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Origin</div>
                    <div className="text-slate-900">{run.tags?.ingest?.source ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Initiator</div>
                    <div className="text-slate-900">{run.tags?.orchestrator?.initiated_by ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Kind</div>
                    <div className="text-slate-900">{run.kind}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Provider</div>
                    <div className="text-slate-900">{run.tags?.provider ?? run.tags?.llm?.provider ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Model</div>
                    <div className="text-slate-900">{run.tags?.model ?? run.tags?.llm?.model ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Agent</div>
                    <div className="text-slate-900">{run.tags?.agent?.name ?? '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Duration</div>
                    <div className="text-slate-900">{run.durationMs != null ? `${run.durationMs}ms` : '—'}</div>
                  </div>
                </div>

                {run.tags?.metrics?.max && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Max Per Event</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-1">Tokens</div>
                        <div className="text-slate-900">{run.tags.metrics.max.total_tokens ?? '—'}</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-1">Cost</div>
                        <div className="text-emerald-700">${Number(run.tags.metrics.max.cost_usd || 0).toFixed(4)}</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-1">Duration</div>
                        <div className="text-slate-900">{run.tags.metrics.max.duration_ms != null ? `${run.tags.metrics.max.duration_ms}ms` : '—'}</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-1">Output chars</div>
                        <div className="text-slate-900">{run.tags.metrics.max.output_chars ?? '—'}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!selected ? (
              <div className="p-8 text-center text-slate-500">Select an event from the timeline.</div>
            ) : (
              <>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Details</h4>
                  <div className="text-xs text-slate-500 font-mono break-all mb-2">Event ID: {selected.id}</div>
                  <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-800 overflow-x-auto">
{JSON.stringify({
  ts: selected.ts,
  type: selected.type,
  name: selected.name,
  status: selected.status,
  duration_ms: selected.durationMs,
  span_id: selected.spanId,
  parent_span_id: selected.parentSpanId,
}, null, 2)}
                  </pre>
                </div>

                {selected.inputText && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Input</h4>
                    <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-800 overflow-x-auto whitespace-pre-wrap">
{selected.inputText}
                    </pre>
                  </div>
                )}

                {selected.outputText && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Output</h4>
                    <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-800 overflow-x-auto whitespace-pre-wrap">
{selected.outputText}
                    </pre>
                  </div>
                )}

                {selected.attributes && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Attributes</h4>
                    <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-800 overflow-x-auto">
{JSON.stringify(selected.attributes, null, 2)}
                    </pre>
                  </div>
                )}

                {selected.error && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-700 uppercase tracking-wider mb-2">Error</h4>
                    <pre className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-900 overflow-x-auto">
{JSON.stringify(selected.error, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
