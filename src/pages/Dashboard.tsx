import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, PlayCircle, ArrowRight, Trash2, Activity, DollarSign, Brain, Sparkles, X, LayoutGrid, Bot, Gauge, TrendingUp, Clock3, Cpu, FileText, Calendar, Package, Target, Wand2, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Pagination from '../components/Pagination';
import { LiveAgentCard } from '../components/LiveAgentCard';

interface Crew {
  id: number;
  name: string;
  process: string;
  is_exposed?: boolean;
}

interface AgentExecution {
    id: number;
    agent_id: number;
    agent_name: string;
    status?: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_cost: number;
    input?: string;
    output?: string;
    created_at: string;
}

interface CrewTemplate {
  id: string;
  name: string;
  process: string;
  description: string;
}

const CrewRunModal = ({ crew, onClose }: { crew: Crew; onClose: () => void }) => {
    const [initialInput, setInitialInput] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState('');
    const [output, setOutput] = useState<string | null>(null);

    const runCrew = async () => {
        setIsRunning(true);
        setError('');
        setOutput(null);
        try {
            const res = await fetch(`/api/crews/${crew.id}/kickoff?wait=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initialInput, wait: true })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
            if (!res.ok) throw new Error(data.error || text || 'Failed to run crew');
            const final = data.result ?? data.output ?? text ?? '';
            setOutput(final || 'No output returned.');
        } catch (e: any) {
            setError(e.message || 'Failed to run crew');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900">Run Crew: {crew.name}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Initial Input / Requirements</label>
                        <textarea
                            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28"
                            placeholder="Optional context for the crew."
                            value={initialInput}
                            onChange={(e) => setInitialInput(e.target.value)}
                        />
                    </div>
                    {error && <div className="text-sm text-red-600">{error}</div>}
                    {output != null && (
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Output</div>
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                                {output}
                            </div>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">
                        Close
                    </button>
                    <button
                        onClick={runCrew}
                        disabled={isRunning}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 font-medium"
                    >
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function Dashboard() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [projects, setProjects] = useState<{id: number, name: string}[]>([]);
  const [recentExecutions, setRecentExecutions] = useState<AgentExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<AgentExecution | null>(null);
  const [runCrew, setRunCrew] = useState<Crew | null>(null);
  const [newCrewName, setNewCrewName] = useState('');
  const [newCrewDescription, setNewCrewDescription] = useState('');
  const [newCrewProcess, setNewCrewProcess] = useState('sequential');
  const [newCrewExposed, setNewCrewExposed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [crewsPage, setCrewsPage] = useState(1);
  const [crewsPageSize, setCrewsPageSize] = useState(6);
  const [execPage, setExecPage] = useState(1);
  const [execPageSize, setExecPageSize] = useState(8);
  const [templates, setTemplates] = useState<CrewTemplate[]>([]);
  const [failureAnalytics, setFailureAnalytics] = useState<{ topFailingTools: any[]; timeoutHotspots: any[]; tokenSpikes: any[] }>({
    topFailingTools: [],
    timeoutHotspots: [],
    tokenSpikes: [],
  });
  const [cancelingAgentId, setCancelingAgentId] = useState<number | null>(null);
  const [agentStopMessage, setAgentStopMessage] = useState<string>('');
  const [stoppingAgentIds, setStoppingAgentIds] = useState<number[]>([]);
  const dashboardDarkPanel = 'bg-linear-to-br from-slate-950 via-slate-900 to-slate-900 border-slate-800/80 shadow-[0_24px_70px_rgba(2,6,23,0.35)]';
  const dashboardOperatorPanel = `panel-chrome rounded-[2rem] border p-6 ${dashboardDarkPanel}`;
  const dashboardOperatorCard = 'rounded-2xl border border-white/10 bg-white/[0.06] p-4';
  
  const navigate = useNavigate();

  const fetchData = () => {
    fetch('/api/crews')
      .then(res => res.json())
      .then(setCrews);
    
    fetch('/api/projects')
      .then(res => res.json())
      .then(setProjects);

    fetch('/api/executions/agents')
      .then(res => res.json())
      .then(setRecentExecutions);

    fetch('/api/agents')
      .then(res => res.json())
      .then(setAgents);

    fetch('/api/crew-templates')
      .then(res => res.json())
      .then(setTemplates)
      .catch(() => setTemplates([]));

    fetch('/api/analytics/failures')
      .then(res => res.json())
      .then(setFailureAnalytics)
      .catch(() => setFailureAnalytics({ topFailingTools: [], timeoutHotspots: [], tokenSpikes: [] }));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setCrewsPage(1);
  }, [crews.length]);

  useEffect(() => {
    setExecPage(1);
  }, [recentExecutions.length]);

  const pagedCrews = useMemo(() => {
    const start = (crewsPage - 1) * crewsPageSize;
    return crews.slice(start, start + crewsPageSize);
  }, [crews, crewsPage, crewsPageSize]);

  const pagedExecutions = useMemo(() => {
    const start = (execPage - 1) * execPageSize;
    return recentExecutions.slice(start, start + execPageSize);
  }, [recentExecutions, execPage, execPageSize]);

  const dashboardInsights = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const execution24h = recentExecutions.filter((e) => (now - new Date(e.created_at).getTime()) <= dayMs).length;
    const totalPrompt = recentExecutions.reduce((sum, e) => sum + (e.prompt_tokens || 0), 0);
    const totalCompletion = recentExecutions.reduce((sum, e) => sum + (e.completion_tokens || 0), 0);
    const totalCost = recentExecutions.reduce((sum, e) => sum + (e.total_cost || 0), 0);
    const avgLatency = (Array.isArray(recentExecutions) && recentExecutions.length)
      ? Math.round(recentExecutions.reduce((sum, e) => {
          if (!e.created_at) return sum;
          const delta = now - new Date(e.created_at).getTime();
          return sum + Math.max(0, Math.min(delta / 1000, 3600));
        }, 0) / recentExecutions.length)
      : 0;
    const runningAgents = agents.filter((a) => a.status === 'running' || (a.running_count || 0) > 0).length;
    const activeRunsNow = agents.reduce((sum, a) => {
      const count = Number(a.running_count || 0);
      if (count > 0) return sum + count;
      return sum + (a.status === 'running' ? 1 : 0);
    }, 0);
    const exposedCrews = crews.filter((c) => c.is_exposed).length;

    return {
      execution24h,
      totalPrompt,
      totalCompletion,
      totalCost,
      avgLatency,
      runningAgents,
      activeRunsNow,
      exposedCrews,
      utilization: agents.length ? Math.min(100, Math.round((runningAgents / agents.length) * 100)) : 0,
    };
  }, [recentExecutions, agents, crews]);

  const recentLoadBars = useMemo(() => {
    const bars = recentExecutions.slice(0, 10).reverse();
    const maxTokens = Math.max(1, ...bars.map((e) => (e.prompt_tokens || 0) + (e.completion_tokens || 0)));
    const maxCost = Math.max(0, ...bars.map((e) => e.total_cost || 0));
    return bars.map((e, index) => ({
      id: e.id,
      index: index + 1,
      pct: Math.max(10, Math.round((((e.prompt_tokens || 0) + (e.completion_tokens || 0)) / maxTokens) * 100)),
      costPct: maxCost > 0 ? Math.max(6, Math.round(((e.total_cost || 0) / maxCost) * 100)) : 0,
      cost: e.total_cost || 0,
      tokens: (e.prompt_tokens || 0) + (e.completion_tokens || 0),
      createdAt: e.created_at,
      agentName: e.agent_name,
      status: e.status || 'completed',
    }));
  }, [recentExecutions]);

  const runningAgentsList = useMemo(() => {
    return agents
      .filter((a: any) => a.status === 'running' || (a.running_count || 0) > 0)
      .map((a: any) => ({
        id: Number(a.id),
        name: a.name || `Agent ${a.id}`,
        role: a.role || 'Specialist',
        runningCount: Number(a.running_count || 0) || 1,
      }));
  }, [agents]);

  const opsPulse = useMemo(() => {
    const rows = recentExecutions.slice(0, 30);
    const total = rows.length;
    const completed = rows.filter((r) => (r.status || 'completed') === 'completed').length;
    const failed = rows.filter((r) => (r.status || '') === 'failed').length;
    const canceled = rows.filter((r) => (r.status || '') === 'canceled').length;
    const running = rows.filter((r) => (r.status || '') === 'running').length;
    const totalTokens = rows.reduce((sum, r) => sum + (r.prompt_tokens || 0) + (r.completion_tokens || 0), 0);
    const totalCost = rows.reduce((sum, r) => sum + (r.total_cost || 0), 0);
    const avgTokens = total ? Math.round(totalTokens / total) : 0;
    const avgCost = total ? totalCost / total : 0;
    const successRate = total ? Math.round((completed / total) * 100) : 0;
    const byAgent = rows.reduce<Record<string, number>>((acc, r) => {
      const name = r.agent_name || 'Unknown';
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {});
    const busiestAgent = (Object.entries(byAgent) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0];
    const lastRun = rows[0]?.created_at || null;
    return {
      total,
      completed,
      failed,
      canceled,
      running,
      avgTokens,
      avgCost,
      successRate,
      busiestAgent: busiestAgent ? `${busiestAgent[0]} (${busiestAgent[1]})` : '—',
      lastRun,
    };
  }, [recentExecutions]);

  const quickAccessTiles = [
    { label: 'AI Insights', hint: 'Model behavior and quality trends', to: '/traces', icon: Brain, accent: 'violet', border: 'border-violet-400/20', iconTone: 'text-violet-200 bg-violet-500/15' },
    { label: 'Reports Hub', hint: 'Execution and token analytics', to: '/traces', icon: FileText, accent: 'sky', border: 'border-sky-400/20', iconTone: 'text-sky-200 bg-sky-500/15' },
    { label: 'KPI Reports', hint: 'Performance indicators and SLAs', to: '/pricing', icon: BarChart3, accent: 'emerald', border: 'border-emerald-400/20', iconTone: 'text-emerald-200 bg-emerald-500/15' },
    { label: 'Event Manager', hint: 'Task flow and runs timeline', to: '/task-control', icon: Calendar, accent: 'amber', border: 'border-amber-400/20', iconTone: 'text-amber-200 bg-amber-500/15' },
    { label: 'Inventory', hint: 'Tool and MCP availability', to: '/tools', icon: Package, accent: 'cyan', border: 'border-cyan-400/20', iconTone: 'text-cyan-200 bg-cyan-500/15' },
    { label: 'Media Planner', hint: 'Provider and prompt spend planning', to: '/providers', icon: Wand2, accent: 'pink', border: 'border-pink-400/20', iconTone: 'text-pink-200 bg-pink-500/15' },
    { label: 'Agent Training', hint: 'Refine instructions and parameters', to: '/agents', icon: Target, accent: 'indigo', border: 'border-indigo-400/20', iconTone: 'text-indigo-200 bg-indigo-500/15' },
    { label: 'Store Performance', hint: 'Project and crew efficiency', to: '/projects', icon: TrendingUp, accent: 'orange', border: 'border-orange-400/20', iconTone: 'text-orange-200 bg-orange-500/15' },
  ];

  const evolutionSeries = useMemo(() => {
    const days = 7;
    const now = new Date();
    const buckets = Array.from({ length: days }).map((_, idx) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (days - 1 - idx));
      const dateKey = d.toISOString().slice(0, 10);
      return { dateKey, label: d.toLocaleDateString([], { weekday: 'short' }), runs: 0, tokens: 0, cost: 0 };
    });
    const bucketIndex = new Map(buckets.map((b, idx) => [b.dateKey, idx]));
    if (!Array.isArray(recentExecutions)) return buckets;
    recentExecutions.forEach((run) => {
      if (!run.created_at) return;
      try {
        const d = new Date(run.created_at);
        if (isNaN(d.getTime())) return;
        const key = d.toISOString().slice(0, 10);
        const idx = bucketIndex.get(key);
        if (idx === undefined) return;
        buckets[idx].runs += 1;
        buckets[idx].tokens += (run.prompt_tokens || 0) + (run.completion_tokens || 0);
        buckets[idx].cost += run.total_cost || 0;
      } catch (e) {
        // Skip invalid dates
      }
    });

    const maxRuns = Math.max(1, ...buckets.map((b) => b.runs));
    const maxTokens = Math.max(1, ...buckets.map((b) => b.tokens));
    const maxCost = Math.max(1e-9, ...buckets.map((b) => b.cost));

    return buckets.map((b, idx) => {
      const x = (idx / Math.max(1, days - 1)) * 100;
      return {
        ...b,
        x,
        runsY: 100 - Math.round((b.runs / maxRuns) * 100),
        tokensY: 100 - Math.round((b.tokens / maxTokens) * 100),
        costY: 100 - Math.round((b.cost / maxCost) * 100),
      };
    });
  }, [recentExecutions]);

  const coordinationSeries = useMemo(() => {
    const counts: Record<string, { completed: number; failed: number; running: number; total: number }> = {};
    recentExecutions.slice(0, 80).forEach((r) => {
      const name = r.agent_name || 'Unknown Agent';
      if (!counts[name]) counts[name] = { completed: 0, failed: 0, running: 0, total: 0 };
      const status = (r.status || 'completed').toLowerCase();
      counts[name].total += 1;
      if (status === 'failed') counts[name].failed += 1;
      else if (status === 'running') counts[name].running += 1;
      else counts[name].completed += 1;
    });
    return Object.entries(counts)
      .map(([name, row]) => ({
        name,
        completedPct: row.total ? Math.round((row.completed / row.total) * 100) : 0,
        runningPct: row.total ? Math.round((row.running / row.total) * 100) : 0,
        failedPct: row.total ? Math.round((row.failed / row.total) * 100) : 0,
      }))
      .sort((a, b) => (b.completedPct + b.runningPct) - (a.completedPct + a.runningPct))
      .slice(0, 6);
  }, [recentExecutions]);

  const cancelRunningAgentExecution = async (agentId: number) => {
    setCancelingAgentId(agentId);
    try {
      setAgentStopMessage('');
      setStoppingAgentIds(prev => (prev.includes(agentId) ? prev : [...prev, agentId]));
      const res = await fetch(`/api/agents/${agentId}/stop-all`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to stop agent');
      setAgentStopMessage(`Stopped agent jobs: ${data?.canceled_running_executions ?? 0} running, ${data?.canceled_pending_jobs ?? 0} pending`);
      fetchData();
    } catch (e: any) {
      setAgentStopMessage(e.message || 'Failed to stop agent');
    } finally {
      setCancelingAgentId(null);
    }
  };

  useEffect(() => {
    if (!stoppingAgentIds.length) return;
    const runningIds = new Set(runningAgentsList.map(a => a.id));
    setStoppingAgentIds(prev => prev.filter(id => runningIds.has(id)));
  }, [runningAgentsList, stoppingAgentIds.length]);

  const evolutionPaths = useMemo(() => {
    const toPath = (key: 'runsY' | 'tokensY' | 'costY') => {
      return evolutionSeries
        .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point[key]}`)
        .join(' ');
    };
    return {
      runs: toPath('runsY'),
      tokens: toPath('tokensY'),
      cost: toPath('costY'),
    };
  }, [evolutionSeries]);

  const orchestrationLanes = useMemo(() => ([
    {
      label: 'Signal Integrity',
      value: `${opsPulse.successRate}%`,
      hint: `${opsPulse.completed}/${Math.max(1, opsPulse.total)} successful completions in the latest sample.`,
      width: opsPulse.successRate,
      tone: 'from-emerald-300 via-emerald-400 to-cyan-300',
    },
    {
      label: 'Swarm Utilization',
      value: `${dashboardInsights.utilization}%`,
      hint: `${dashboardInsights.runningAgents} of ${Math.max(1, agents.length)} agents currently energized.`,
      width: dashboardInsights.utilization,
      tone: 'from-brand-300 via-brand-400 to-violet-300',
    },
    {
      label: 'Exposure Coverage',
      value: `${crews.length ? Math.round((dashboardInsights.exposedCrews / crews.length) * 100) : 0}%`,
      hint: `${dashboardInsights.exposedCrews} crews are currently surfaced via API or MCP.`,
      width: crews.length ? Math.round((dashboardInsights.exposedCrews / crews.length) * 100) : 0,
      tone: 'from-amber-300 via-orange-300 to-pink-300',
    },
  ]), [opsPulse, dashboardInsights, agents.length, crews.length]);

  const createCrew = async () => {
    if (!newCrewName) return;
    const res = await fetch('/api/crews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name: newCrewName, 
        description: newCrewDescription,
        process: newCrewProcess,
        project_id: selectedProjectId || null,
        is_exposed: newCrewExposed
      })
    });
    const data = await res.json();
    // Refresh crews to get the full object including project info if needed
    fetch('/api/crews').then(res => res.json()).then(setCrews);
    
    setNewCrewName('');
    setNewCrewDescription('');
    setNewCrewProcess('sequential');
    setNewCrewExposed(false);
    setSelectedProjectId('');
    setIsCreating(false);
  };

  const createCrewFromTemplate = async (templateId: string) => {
    const res = await fetch('/api/crews/from-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, project_id: selectedProjectId || null })
    });
    const data = await res.json();
    if (res.ok && data?.id) navigate(`/crew/${data.id}`);
  };

  const deleteCrew = async (id: number) => {
    try {
        const res = await fetch(`/api/crews/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete crew');
        }
        // Refresh crews from server to ensure sync
        fetch('/api/crews').then(res => res.json()).then(setCrews);
    } catch (e: any) {
        alert(e.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-12">
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          className="max-w-3xl"
        >
          <h1 className="text-5xl lg:text-6xl font-black tracking-tight text-slate-900 mb-4">
            Swarm <span className="bg-linear-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent">Command</span>
          </h1>
          <p className="text-lg text-slate-600 font-semibold leading-relaxed">
            Monitor, steer, and amplify an emergent agent network with live orchestration telemetry. Optimized for hyper-scale operations.
          </p>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex gap-3"
        >
            <button 
              onClick={() => navigate('/crews')}
              className="panel-chrome flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-brand-700 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-brand-100/50"
            >
              <Users size={18} />
              Manage Syndicates
            </button>
            <button 
              onClick={() => setIsCreating(true)}
              className="premium-gradient text-white px-6 py-3 rounded-2xl flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-brand-200 font-bold"
            >
              <Plus size={20} />
              Quick Deploy
            </button>
        </motion.div>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="swarm-hero mb-12 p-10 lg:p-14 relative overflow-hidden ring-1 ring-white/10 shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-500/10 blur-[120px] rounded-full -mr-48 -mt-48 transition-all duration-1000 group-hover:bg-brand-500/20" />
        
        <div className="flex flex-col gap-10 xl:flex-row xl:items-start xl:justify-between mb-12 relative z-10">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-[12px] font-black uppercase tracking-[0.35em] text-cyan-300 shadow-xl shadow-cyan-500/20">
              <Sparkles size={14} className="animate-pulse text-cyan-400" />
              Intelligence Orchestration Layer
            </div>
            <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-7xl leading-[1.05] drop-shadow-2xl">
              Real-time monitoring for <span className="bg-linear-to-r from-cyan-400 to-brand-400 bg-clip-text text-transparent">delegated crews</span>.
            </h2>
            <p className="mt-8 max-w-2xl text-lg lg:text-xl leading-relaxed text-slate-300 font-semibold antialiased">
              Turning complex runtimes into a living map: orchestration pulse, execution waves, workforce state, and high-frequency control lanes.
            </p>
          </div>

          <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
            {orchestrationLanes.map((lane) => (
              <div key={lane.label} className="telemetry-tile p-6 group hover:bg-white/[0.12] transition-all duration-300 border-white/10 hover:border-white/20 hover:shadow-2xl hover:shadow-brand-500/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase font-black tracking-[0.25em] text-slate-400 group-hover:text-slate-300 transition-colors">{lane.label}</div>
                    <div className="mt-3 text-4xl font-black text-white group-hover:text-brand-300 transition-all tracking-tighter">{lane.value}</div>
                  </div>
                  <div className="network-grid w-20 p-1.5 rounded-xl bg-white/5 border border-white/5">
                    {Array.from({ length: 9 }).map((_, index) => (
                      <span key={index} className={`h-3 rounded-full transition-all duration-700 ${index < Math.max(1, Math.round(lane.width / 12)) ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]' : 'bg-white/10'}`} />
                    ))}
                  </div>
                </div>
                <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/10 border border-white/10 p-[1px]">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(6, lane.width)}%` }}
                    className={`h-full rounded-full bg-linear-to-r ${lane.tone} shadow-[0_0_20px_rgba(255,255,255,0.3)]`} 
                  />
                </div>
                <div className="mt-4 text-[12px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                  {lane.hint}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4 relative z-10">
          {quickAccessTiles.map((tile) => (
            <Link
              key={tile.label}
              to={tile.to}
              className={`group rounded-[2.5rem] border ${tile.border} bg-white/[0.08] p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:bg-white/[0.15] hover:shadow-[0_32px_80px_rgba(0,0,0,0.5)] border-white/10 hover:border-white/30`}
            >
              <div className="mb-5 flex items-center justify-between">
                <div className={`rounded-2xl border border-white/10 p-4 ${tile.iconTone} shadow-xl group-hover:shadow-2xl group-hover:scale-110 transition-all duration-300`}>
                  <tile.icon size={24} />
                </div>
                <div className="rounded-full bg-white/10 p-2.5 transition-colors group-hover:bg-brand-500/30">
                  <ArrowRight size={16} className="text-slate-400 transition-transform group-hover:translate-x-1.5 group-hover:text-brand-300" />
                </div>
              </div>
              <div className="text-xl font-black text-white tracking-tight group-hover:text-brand-100 transition-colors">{tile.label}</div>
              <div className="mt-3 text-[13px] leading-relaxed font-bold text-slate-400 group-hover:text-slate-200 transition-colors">{tile.hint}</div>
            </Link>
          ))}
        </div>
      </motion.section>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-12"
        >
          <motion.div whileHover={{ y: -5, scale: 1.02 }} className={`telemetry-tile p-6 relative overflow-hidden group border-brand-500/30 ${dashboardDarkPanel}`}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-brand-500/10 blur-3xl group-hover:bg-brand-500/20 transition-all duration-500" />
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-brand-300 mb-3">Agents Online</div>
              <div className="flex items-end justify-between">
                <div className="text-5xl font-black text-white tracking-tighter">{agents.length}</div>
                <div className="p-3 rounded-2xl bg-brand-500/20 text-brand-300 border border-brand-500/30 group-hover:rotate-12 transition-all">
                  <Bot size={24} />
                </div>
              </div>
              <div className="text-[12px] font-bold text-slate-300 mt-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
                {dashboardInsights.runningAgents} currently active
              </div>
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -5, scale: 1.02 }} className={`telemetry-tile p-6 relative overflow-hidden group border-amber-400/30 ${dashboardDarkPanel}`}>
            <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-accent-500/10 blur-3xl group-hover:bg-accent-500/20 transition-all duration-500" />
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-300 mb-3">Crew Matrix</div>
              <div className="flex items-end justify-between">
                <div className="text-5xl font-black text-white tracking-tighter">{crews.length}</div>
                <div className="p-3 rounded-2xl bg-accent-500/20 text-accent-300 border border-accent-500/30 group-hover:rotate-12 transition-all">
                  <Users size={24} />
                </div>
              </div>
              <div className="text-[12px] font-bold text-slate-200 mt-4 flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-accent-500/30" />
                {dashboardInsights.exposedCrews} exposed via API/MCP
              </div>
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -5, scale: 1.02 }} className={`telemetry-tile p-6 relative overflow-hidden group border-emerald-500/30 ${dashboardDarkPanel}`}>
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-300 mb-3">24H Throughput</div>
              <div className="flex items-end justify-between">
                <div className="text-5xl font-black text-white tracking-tighter">{dashboardInsights.execution24h}</div>
                <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 group-hover:rotate-12 transition-all">
                  <TrendingUp size={24} />
                </div>
              </div>
              <div className="text-[12px] font-bold text-slate-200 mt-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Recent executions today
              </div>
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -5, scale: 1.02 }} className={`telemetry-tile p-6 relative overflow-hidden group border-indigo-500/30 ${dashboardDarkPanel}`}>
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-indigo-300 mb-3">Token Flow</div>
              <div className="flex items-end justify-between">
                <div className="text-4xl font-black text-white tracking-tighter leading-none">{(dashboardInsights.totalPrompt + dashboardInsights.totalCompletion).toLocaleString()}</div>
                <div className="p-3 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 group-hover:rotate-12 transition-all">
                  <Cpu size={24} />
                </div>
              </div>
              <div className="text-[11px] font-bold text-slate-200 mt-4 truncate flex items-center gap-2">
                <span className="text-indigo-300">P</span> {dashboardInsights.totalPrompt.toLocaleString()}
                <span className="mx-1 text-slate-600">|</span>
                <span className="text-violet-300">C</span> {dashboardInsights.totalCompletion.toLocaleString()}
              </div>
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -5, scale: 1.02 }} className={`telemetry-tile p-6 relative overflow-hidden group border-emerald-500/30 ${dashboardDarkPanel}`}>
            <div className="relative">
              <div className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-300 mb-3">Cost Envelope</div>
              <div className="flex items-end justify-between">
                <div className="text-4xl font-black text-emerald-400 tracking-tighter">${dashboardInsights.totalCost.toFixed(4)}</div>
                <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 group-hover:rotate-12 transition-all">
                  <DollarSign size={24} />
                </div>
              </div>
              <div className="text-[12px] font-bold text-slate-200 mt-4">Avg latency {dashboardInsights.avgLatency}s</div>
            </div>
          </motion.div>
        </motion.div>

      <div className="panel-chrome rounded-[2.5rem] p-8 mb-10 overflow-hidden relative border border-slate-200/90 bg-white/92">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500/5 blur-[120px] rounded-full -mr-64 -mt-64" />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10 relative z-10">
          <div className="telemetry-tile p-6 relative overflow-hidden group border-white/10">
            <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 blur-3xl -mr-16 -mt-16 group-hover:bg-violet-500/20 transition-colors" />
            <div className="text-[10px] text-violet-300 font-black uppercase tracking-[0.25em] mb-1">Success Rate</div>
            <div className="text-4xl font-black text-white">{opsPulse.successRate.toFixed(1)}%</div>
            <div className="mt-5 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${opsPulse.successRate}%` }}
                className="h-full bg-linear-to-r from-violet-600 to-indigo-500 rounded-full shadow-[0_0_15px_rgba(139,92,246,0.6)]" 
              />
            </div>
          </div>
          <div className="telemetry-tile p-6 relative overflow-hidden group border-white/10">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-3xl -mr-16 -mt-16 group-hover:bg-emerald-500/20 transition-colors" />
            <div className="text-[10px] text-emerald-300 font-black uppercase tracking-[0.25em] mb-1">Active Capacity</div>
            <div className="text-4xl font-black text-white">{dashboardInsights.utilization}%</div>
            <div className="mt-5 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${dashboardInsights.utilization}%` }}
                className="h-full bg-linear-to-r from-emerald-600 to-teal-500 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.6)]" 
              />
            </div>
          </div>
          <div className="telemetry-tile p-6 relative overflow-hidden group border-white/10">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl -mr-16 -mt-16 group-hover:bg-cyan-500/20 transition-colors" />
            <div className="text-[10px] text-cyan-300 font-black uppercase tracking-[0.25em] mb-1">Active Runs</div>
            <div className="text-4xl font-black text-white">{dashboardInsights.activeRunsNow}</div>
            <div className="mt-5 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, Math.max(8, dashboardInsights.activeRunsNow * 12))}%` }}
                className="h-full bg-linear-to-r from-cyan-600 to-blue-500 rounded-full shadow-[0_0_15px_rgba(6,182,212,0.6)]" 
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 relative z-10">
          <div className={`rounded-[2.4rem] border p-8 backdrop-blur-2xl relative overflow-hidden group ${dashboardDarkPanel}`}>
            <div className="absolute inset-0 bg-linear-to-b from-indigo-500/5 to-transparent pointer-events-none" />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-2xl bg-brand-500/15 text-brand-300">
                  <Activity size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">Collective Evolution</h3>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-0.5">Analytics Core</div>
                </div>
              </div>
              <div className="px-4 py-1.5 rounded-full bg-white/10 border border-white/10 text-[10px] font-black text-slate-300 uppercase tracking-widest hidden sm:block">
                Last 7 Days
              </div>
            </div>
            
            <div className="h-72 rounded-[1.8rem] border border-white/10 bg-slate-950/50 p-6 relative overflow-hidden network-grid">
              <div className="absolute inset-0 opacity-15 pointer-events-none">
                <div className="w-full h-full" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
              </div>
              
              {recentExecutions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <div className="p-4 rounded-full bg-white/5 border border-white/5 animate-pulse">
                    <BarChart3 size={32} className="opacity-40" />
                  </div>
                  <div className="text-[11px] font-black uppercase tracking-[0.25em] opacity-50">Syncing telemetry data...</div>
                </div>
              ) : (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full relative z-10 drop-shadow-2xl">
                  <defs>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <linearGradient id="runsGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#a78bfa" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                  {[20, 40, 60, 80].map((y) => (
                    <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(148,163,184,0.15)" strokeWidth="0.5" />
                  ))}
                  <motion.path 
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1.8, ease: 'easeInOut' }}
                    d={evolutionPaths.runs} 
                    fill="none" 
                    stroke="url(#runsGrad)" 
                    strokeWidth="2.5" 
                    filter="url(#glow)"
                  />
                  <motion.path 
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.5 }}
                    transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.3 }}
                    d={evolutionPaths.tokens} 
                    fill="none" 
                    stroke="#22d3ee" 
                    strokeWidth="2.5" 
                  />
                  <motion.path 
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.5 }}
                    transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.6 }}
                    d={evolutionPaths.cost} 
                    fill="none" 
                    stroke="#34d399" 
                    strokeWidth="2.5" 
                  />
                </svg>
              )}
            </div>
            
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4 flex items-center justify-between group/legend">
                <div>
                  <div className="text-[10px] font-black text-violet-300 uppercase tracking-widest mb-1">Runs</div>
                  <div className="text-sm font-black text-white">{dashboardInsights.execution24h}</div>
                </div>
                <div className="w-3 h-3 rounded-full bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.8)] group-hover:scale-125 transition-transform" />
              </div>
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 flex items-center justify-between group/legend">
                <div>
                  <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-1">Tokens</div>
                  <div className="text-sm font-black text-white">{Math.round((dashboardInsights.totalPrompt + dashboardInsights.totalCompletion)/1000)}k</div>
                </div>
                <div className="w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.8)] group-hover:scale-125 transition-transform" />
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex items-center justify-between group/legend">
                <div>
                  <div className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mb-1">Cost</div>
                  <div className="text-sm font-black text-white">${dashboardInsights.totalCost.toFixed(2)}</div>
                </div>
                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)] group-hover:scale-125 transition-transform" />
              </div>
            </div>
          </div>

          <div className={`rounded-[2.4rem] border p-8 backdrop-blur-2xl relative overflow-hidden group ${dashboardDarkPanel}`}>
            <div className="absolute inset-0 bg-linear-to-b from-brand-500/5 to-transparent pointer-events-none" />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-2xl bg-brand-500/15 text-brand-300">
                  <Target size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">Swarm Coordination</h3>
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-0.5">Real-Time Node Mesh</div>
                </div>
              </div>
              <div className="px-4 py-1.5 rounded-full bg-white/10 border border-white/10 text-[10px] font-black text-slate-300 uppercase tracking-widest hidden sm:block">
                Top Active Nodes
              </div>
            </div>
            
            <div className="space-y-5 max-h-[340px] overflow-y-auto pr-3 custom-scrollbar">
              {coordinationSeries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 border-2 border-dashed border-white/5 rounded-[2rem] bg-white/[0.02]">
                   <Users size={40} className="opacity-10 mb-4" />
                   <p className="text-[12px] font-black uppercase tracking-[0.25em] opacity-40">Awaiting node activity...</p>
                </div>
              ) : (
                coordinationSeries.map((row) => (
                  <div key={row.name} className="group/row bg-white/[0.06] p-4 rounded-2xl border border-white/10 hover:bg-white/[0.09] transition-all">
                    <div className="flex items-center justify-between text-[11px] mb-3">
                      <span className="truncate max-w-[65%] text-slate-200 font-black tracking-tight group-hover/row:text-brand-100 transition-colors uppercase">{row.name}</span>
                      <div className="flex gap-3 font-black text-[9px] text-slate-400 uppercase tracking-wider">
                         <span className="text-violet-300">Done:{row.completedPct}%</span>
                         <span className="text-sky-300">Live:{row.runningPct}%</span>
                         <span className="text-orange-300">Fail:{row.failedPct}%</span>
                      </div>
                    </div>
                    <div className="h-4 w-full rounded-full bg-slate-900/50 overflow-hidden flex border border-white/5 shadow-inner">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${row.completedPct}%` }}
                        className="h-full bg-linear-to-r from-violet-600 to-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.5)]" 
                      />
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${row.runningPct}%` }}
                        className="h-full bg-linear-to-r from-sky-600 to-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.5)]" 
                      />
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${row.failedPct}%` }}
                        className="h-full bg-linear-to-r from-orange-600 to-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.5)]" 
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {coordinationSeries.length > 0 && (
              <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center gap-2 bg-violet-600/10 rounded-2xl py-3 border border-violet-500/20">
                  <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.8)]" />
                  <span className="text-[10px] font-black text-violet-200 uppercase tracking-widest">Completed</span>
                </div>
                <div className="flex flex-col items-center gap-2 bg-sky-600/10 rounded-2xl py-3 border border-sky-500/20">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.8)]" />
                  <span className="text-[10px] font-black text-sky-200 uppercase tracking-widest">Running</span>
                </div>
                <div className="flex flex-col items-center gap-2 bg-orange-600/10 rounded-2xl py-3 border border-orange-500/20">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(251,146,60,0.8)]" />
                  <span className="text-[10px] font-black text-orange-200 uppercase tracking-widest">Failed</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className={dashboardOperatorPanel}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles size={18} className="text-cyan-300" />
                Command Blueprints
              </h2>
              <p className="text-sm text-slate-400 mt-1">Launch proven crew patterns without leaving the operator surface.</p>
            </div>
            <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">
              Quick Start
            </div>
          </div>
          <div className="space-y-3">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div>
                  <div className="font-semibold text-white">{tpl.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{tpl.description}</div>
                </div>
                <button
                  onClick={() => createCrewFromTemplate(tpl.id)}
                  className="px-3 py-2 text-xs font-semibold rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                >
                  Use Template
                </button>
              </div>
            ))}
            {templates.length === 0 && <div className="text-sm text-slate-500">No templates available.</div>}
          </div>
        </div>

        <div className={dashboardOperatorPanel}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Activity size={18} className="text-orange-300" />
                Failure Analytics
              </h2>
              <p className="text-sm text-slate-400 mt-1">Watch the highest-friction tools and timeout hotspots before they spread.</p>
            </div>
            <div className="rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-orange-200">
              Risk Watch
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Top Failing Tools</div>
              <div className="space-y-2">
                {failureAnalytics.topFailingTools.slice(0, 5).map((row: any) => (
                  <div key={row.tool_name} className="flex items-center justify-between text-sm rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                    <span className="text-slate-200">{row.tool_name}</span>
                    <span className="font-mono text-red-300">{row.failures}</span>
                  </div>
                ))}
                {failureAnalytics.topFailingTools.length === 0 && <div className="text-xs text-slate-500">No failures detected.</div>}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Timeout Hotspots</div>
              <div className="space-y-2">
                {failureAnalytics.timeoutHotspots.slice(0, 5).map((row: any) => (
                  <div key={row.agent_name} className="flex items-center justify-between text-sm rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                    <span className="text-slate-200">{row.agent_name}</span>
                    <span className="font-mono text-amber-300">{row.timeout_failures}</span>
                  </div>
                ))}
                {failureAnalytics.timeoutHotspots.length === 0 && <div className="text-xs text-slate-500">No timeout hotspots yet.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
        className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-12"
      >
        <div className={`${dashboardOperatorPanel} xl:col-span-2`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Gauge size={18} className="text-cyan-300" />
              Ops Pulse
            </h2>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Real-Time</span>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Agent Utilization</span>
                <span>{dashboardInsights.utilization}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-linear-to-r from-brand-500 to-brand-700" style={{ width: `${dashboardInsights.utilization}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Crew Exposure Coverage</span>
                <span>{crews.length ? Math.round((dashboardInsights.exposedCrews / crews.length) * 100) : 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-linear-to-r from-accent-500 to-accent-700" style={{ width: `${crews.length ? Math.round((dashboardInsights.exposedCrews / crews.length) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className={dashboardOperatorCard}>
                <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Clock3 size={12} /> Approx Run Age</div>
                <div className="text-lg font-bold text-white">{dashboardInsights.avgLatency}s</div>
              </div>
              <div className={dashboardOperatorCard}>
                <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Activity size={12} /> Active Runs</div>
                <div className="text-lg font-bold text-white">{dashboardInsights.activeRunsNow}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              <div className={dashboardOperatorCard}>
                <div className="text-[11px] text-slate-400">Success Rate</div>
                <div className="text-base font-bold text-emerald-700">{opsPulse.successRate}%</div>
              </div>
              <div className={dashboardOperatorCard}>
                <div className="text-[11px] text-slate-400">Avg Tokens/Run</div>
                <div className="text-base font-bold text-white">{opsPulse.avgTokens.toLocaleString()}</div>
              </div>
              <div className={dashboardOperatorCard}>
                <div className="text-[11px] text-slate-400">Avg Cost/Run</div>
                <div className="text-base font-bold text-white">${opsPulse.avgCost.toFixed(4)}</div>
              </div>
              <div className={dashboardOperatorCard}>
                <div className="text-[11px] text-slate-400">Busiest Agent</div>
                <div className="text-sm font-bold text-white truncate" title={opsPulse.busiestAgent}>{opsPulse.busiestAgent}</div>
              </div>
            </div>
            <div className={dashboardOperatorCard}>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Recent Status Mix (last {opsPulse.total})</span>
                <span>{opsPulse.lastRun ? new Date(opsPulse.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5 text-emerald-700">Completed: {opsPulse.completed}</div>
                <div className="rounded-lg bg-red-50 border border-red-100 px-2 py-1.5 text-red-700">Failed: {opsPulse.failed}</div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5 text-amber-700">Canceled: {opsPulse.canceled}</div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 px-2 py-1.5 text-blue-700">Running: {opsPulse.running}</div>
              </div>
            </div>
            <div className="pt-2">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Running Agents</div>
              {agentStopMessage && <div className="text-[11px] text-slate-300 mb-2">{agentStopMessage}</div>}
              <div className="space-y-2 max-h-[130px] overflow-y-auto pr-1 custom-scrollbar">
                {runningAgentsList.length === 0 && (
                  <div className="text-xs text-slate-400 border border-white/10 rounded-lg px-3 py-2 bg-white/[0.05]">
                    No agents running right now.
                  </div>
                )}
                {runningAgentsList.map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between border border-white/10 rounded-lg px-3 py-2 bg-white/[0.05]">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{agent.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {agent.role} • {agent.runningCount} active
                        {stoppingAgentIds.includes(agent.id) ? ' • stopping...' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => cancelRunningAgentExecution(agent.id)}
                      disabled={cancelingAgentId === agent.id || stoppingAgentIds.includes(agent.id)}
                      className="text-[11px] px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {(cancelingAgentId === agent.id || stoppingAgentIds.includes(agent.id)) ? 'Stopping...' : 'Stop'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={dashboardOperatorPanel}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Execution Wave</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Last 10</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-3">
            <span>Main bar = tokens</span>
            <span>Mini bar = cost</span>
          </div>
          <div className="max-h-[260px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
            {recentLoadBars.length === 0 && (
              <div className="text-sm text-slate-500">No runs yet.</div>
            )}
            {recentLoadBars.map((bar) => (
              <div key={bar.id} className="border border-white/10 rounded-xl p-2 bg-white/[0.05]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-4.5 h-4.5 rounded-full bg-white/10 border border-white/10 text-[10px] text-slate-300 flex items-center justify-center">
                      {bar.index}
                    </div>
                    <div className="text-xs text-slate-200 truncate max-w-[120px]" title={bar.agentName}>{bar.agentName || `Agent ${bar.id}`}</div>
                  </div>
                  <div className="text-[10px] text-slate-400">{new Date(bar.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${bar.pct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      className="h-full rounded-full bg-linear-to-r from-indigo-500 via-brand-500 to-emerald-500"
                    />
                  </div>
                  <div className="w-14 text-right text-[10px] font-mono text-slate-200">{bar.tokens.toLocaleString()}t</div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${bar.costPct}%` }}
                      transition={{ duration: 0.45, ease: 'easeOut' }}
                      className="h-full rounded-full bg-linear-to-r from-emerald-400 to-emerald-600"
                    />
                  </div>
                  <div className="w-14 text-right text-[10px] font-mono text-emerald-700">${bar.cost.toFixed(4)}</div>
                </div>
              </div>
            ))}
          </div>
          {recentLoadBars.length > 0 && recentLoadBars.every((bar) => bar.cost === 0) && (
            <div className="mt-3 text-[11px] text-slate-400 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-2">
              Cost tracking is enabled, but recent runs returned $0.0000. Token and time view is shown above.
            </div>
          )}
        </div>
      </motion.div>

      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="text-brand-500" size={20} />
            Active Workforce
          </h2>
          <Link to="/agents" className="text-sm font-bold text-brand-300 hover:text-brand-200 transition-colors flex items-center gap-1">
            View All Agents <ArrowRight size={14} />
          </Link>
        </div>
        
        <motion.div 
          layout
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <AnimatePresence mode='popLayout'>
            {agents.slice(0, 3).map(agent => (
              <LiveAgentCard 
                key={agent.id} 
                agent={agent} 
                variant="dashboard"
                onClick={() => navigate('/agents')} 
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>

      {isCreating && (
        <div className={`mb-8 animate-in fade-in slide-in-from-top-4 ${dashboardOperatorPanel}`}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Create New Crew</h3>
              <p className="text-sm text-slate-400 mt-1">Spin up a new syndicate without leaving the command surface.</p>
            </div>
            <div className="rounded-full border border-brand-400/20 bg-brand-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-brand-200">
              Quick Deploy
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1">Crew Name</label>
                <input
                type="text"
                placeholder="e.g. Marketing Team"
                className="w-full px-4 py-2 border border-white/10 bg-white/[0.06] text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                value={newCrewName}
                onChange={(e) => setNewCrewName(e.target.value)}
                />
            </div>

            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                <input
                type="text"
                placeholder="Brief description for MCP/API users"
                className="w-full px-4 py-2 border border-white/10 bg-white/[0.06] text-white rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                value={newCrewDescription}
                onChange={(e) => setNewCrewDescription(e.target.value)}
                />
            </div>
            
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Process</label>
                <select
                    className="w-full px-4 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white/[0.06] text-white"
                    value={newCrewProcess}
                    onChange={(e) => setNewCrewProcess(e.target.value)}
                >
                    <option value="sequential">Sequential</option>
                    <option value="hierarchical">Hierarchical</option>
                </select>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Project</label>
                <select
                    className="w-full px-4 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white/[0.06] text-white"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                    <option value="">No Project</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
            </div>

            <div className="md:col-span-4 flex items-center gap-2">
                <input
                    type="checkbox"
                    id="crewExposed"
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    checked={newCrewExposed}
                    onChange={(e) => setNewCrewExposed(e.target.checked)}
                />
                <label htmlFor="crewExposed" className="text-sm text-slate-300">
                    Expose Crew via API/MCP (Publicly accessible if key is shared)
                </label>
            </div>
          </div>
          
          <div className="flex justify-end gap-3 mt-4">
            <button 
              onClick={() => setIsCreating(false)}
              className="text-slate-400 px-4 py-2 hover:text-slate-200"
            >
              Cancel
            </button>
            <button 
              onClick={createCrew}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
            >
              Create Crew
            </button>
          </div>
        </div>
      )}

      <div className="mt-14">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <LayoutGrid className="text-accent-500" size={20} />
            Syndicates & Operations
          </h2>
          <Link to="/crews" className="text-sm font-bold text-brand-300 hover:text-brand-200 transition-colors flex items-center gap-1">
            Browse All Crews <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pagedCrews.map(crew => (
            <Link 
              key={crew.id} 
              to={`/crew/${crew.id}`}
              className="group relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/88 p-6 shadow-[0_18px_65px_rgba(15,23,42,0.42)] backdrop-blur-xl transition-all duration-300 hover:border-brand-300/40 hover:bg-slate-950/94"
            >
              <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_right,rgba(96,165,250,0.2),transparent_60%)] opacity-90" />
              <div className="absolute -right-10 top-4 h-28 w-28 rounded-full border border-white/10 bg-white/5 blur-xl" />
              
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-6">
                  <div className="rounded-2xl border border-brand-300/20 bg-brand-500/12 p-3 text-brand-100 transition-colors group-hover:bg-brand-500/20">
                    <Users size={24} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-200">
                      {crew.process}
                    </span>
                    {crew.is_exposed && (
                      <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-100">
                        MCP
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setRunCrew(crew);
                      }}
                      className="rounded-lg p-1 text-slate-400 transition-colors hover:text-brand-200"
                      title="Run Crew"
                    >
                      <PlayCircle size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteCrew(crew.id);
                      }}
                      className="rounded-lg p-1 text-slate-400 transition-colors hover:text-rose-300"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">{crew.name}</h3>
                <p className="mb-4 text-sm text-slate-400">Click to manage agents, execution flow, and delegated operations for this crew.</p>
                <div className="flex items-center text-sm font-medium text-brand-300">
                  Manage Crew <ArrowRight size={16} className="ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
          
          {crews.length === 0 && !isCreating && (
            <div className="col-span-full rounded-[1.75rem] border border-dashed border-white/10 bg-slate-950/72 py-12 text-center">
              <p className="text-slate-400">No crews created yet. Start by creating one!</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-6">
        <Pagination
          page={crewsPage}
          pageSize={crewsPageSize}
          total={crews.length}
          onPageChange={setCrewsPage}
          onPageSizeChange={setCrewsPageSize}
        />
      </div>

      {runCrew && (
        <CrewRunModal crew={runCrew} onClose={() => setRunCrew(null)} />
      )}

      <div className="mt-16">
        <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <div className="p-2 bg-accent-50 rounded-lg text-accent-600">
              <Activity size={20} />
            </div>
            Operation Streams
        </h2>
        <div className={`${dashboardOperatorPanel} overflow-hidden p-0`}>
            {recentExecutions.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                    No recent activity found.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="bg-white/[0.06] text-slate-200 font-medium border-b border-white/10">
                            <tr>
                                <th className="px-6 py-4">Agent</th>
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4 text-right">Prompt Tokens</th>
                                <th className="px-6 py-4 text-right">Completion Tokens</th>
                                <th className="px-6 py-4 text-right">Cost</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {pagedExecutions.map(exec => (
                                <tr 
                                    key={exec.id} 
                                    className="hover:bg-white/[0.05] transition-colors cursor-pointer"
                                    onClick={() => setSelectedExecution(exec)}
                                >
                                    <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-200 flex items-center justify-center text-xs">
                                            <Brain size={14} />
                                        </div>
                                        {exec.agent_name}
                                    </td>
                                    <td className="px-6 py-4 text-slate-400">
                                        {exec.created_at ? new Date(exec.created_at).toLocaleString() : '—'}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-300">
                                        {(exec.prompt_tokens || 0).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-300">
                                        {(exec.completion_tokens || 0).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-medium text-emerald-600">
                                        ${(exec.total_cost || 0).toFixed(6)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="p-4 border-t border-slate-100">
                <Pagination
                    page={execPage}
                    pageSize={execPageSize}
                    total={recentExecutions.length}
                    onPageChange={setExecPage}
                    onPageSizeChange={setExecPageSize}
                />
            </div>
        </div>
      </div>

      {/* Execution Details Modal */}
      {selectedExecution && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Activity size={24} className="text-indigo-600" />
                        Execution Details: {selectedExecution.agent_name}
                    </h3>
                    <button onClick={() => setSelectedExecution(null)} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="flex items-center gap-4 mb-4">
                        <span className="text-slate-600 text-sm font-medium">
                            {selectedExecution.created_at ? new Date(selectedExecution.created_at).toLocaleString() : '—'}
                        </span>
                    </div>

                    <div>
                        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div> Input
                        </h4>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                            {selectedExecution.input || "No input recorded."}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Output
                        </h4>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                            {selectedExecution.output || "No output recorded."}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-1">Prompt Tokens</div>
                            <div className="font-medium text-slate-900">{(selectedExecution.prompt_tokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-1">Completion Tokens</div>
                            <div className="font-medium text-slate-900">{(selectedExecution.completion_tokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div className="text-xs text-slate-500 mb-1">Total Cost</div>
                            <div className="font-medium text-emerald-600">${(selectedExecution.total_cost || 0).toFixed(6)}</div>
                        </div>
                    </div>
                </div>
                
                <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
                    <button 
                        onClick={() => setSelectedExecution(null)}
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
