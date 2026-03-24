import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
  NodeProps,
  Edge,
  Node,
  Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, Boxes, CheckCircle2, GitBranch, Play, Plus, Save, Wrench, Zap, Clock3, RotateCcw, Users, Radio, Repeat, Webhook } from 'lucide-react';

type WorkflowRecord = {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  trigger_type?: string;
  graph: string;
  version?: number;
  project_id?: number | null;
  project_name?: string | null;
  runs_count?: number;
  last_run_status?: string | null;
  last_run_at?: string | null;
};

type WorkflowRun = {
  id: number;
  workflow_id: number;
  status: string;
  trigger_type?: string;
  input?: any;
  output?: any;
  logs?: Array<{ ts: string; type: string; payload: any }>;
  created_at: string;
  updated_at?: string;
};

type Project = { id: number; name: string };
type Agent = { id: number; name: string; role: string };
type Crew = { id: number; name: string; process?: string };
type Tool = { id: number; name: string; type: string; description?: string };

type WorkflowNodeData = {
  label: string;
  kind: 'trigger' | 'agent' | 'crew' | 'tool' | 'loop' | 'condition' | 'output';
  subtitle?: string;
  agentId?: number;
  crewId?: number;
  toolId?: number;
  prompt?: string;
  argsTemplate?: string;
  itemsTemplate?: string;
  itemTemplate?: string;
  joinWith?: string;
  left?: string;
  right?: string;
  operator?: string;
  template?: string;
};

const DEFAULT_GRAPH = {
  nodes: [
    {
      id: 'trigger_1',
      type: 'workflowNode',
      position: { x: 80, y: 120 },
      data: { label: 'Manual Trigger', kind: 'trigger', subtitle: 'Entry point' } satisfies WorkflowNodeData,
    },
    {
      id: 'output_1',
      type: 'workflowNode',
      position: { x: 620, y: 120 },
      data: { label: 'Output', kind: 'output', subtitle: 'Final response', template: '{{last.text}}' } satisfies WorkflowNodeData,
    },
  ],
  edges: [
    { id: 'trigger_1-output_1', source: 'trigger_1', target: 'output_1' },
  ],
};

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function statusTone(status?: string | null) {
  if (status === 'failed') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'running' || status === 'pending') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
}

function kindIcon(kind: WorkflowNodeData['kind']) {
  if (kind === 'agent') return Bot;
  if (kind === 'crew') return Users;
  if (kind === 'tool') return Wrench;
  if (kind === 'loop') return Repeat;
  if (kind === 'condition') return GitBranch;
  if (kind === 'output') return CheckCircle2;
  return Zap;
}

const WorkflowNodeCard = ({ data, selected }: NodeProps<Node<WorkflowNodeData>>) => {
  const Icon = kindIcon(data.kind);
  return (
    <div className={`min-w-[220px] max-w-[260px] rounded-2xl border bg-white shadow-sm ${selected ? 'border-indigo-400 shadow-indigo-100' : 'border-slate-200'}`}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-indigo-500" />
      <div className="border-b border-slate-100 px-4 py-3 bg-slate-50/80 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-indigo-100 p-2 text-indigo-700">
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{data.label}</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{data.kind}</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="text-xs text-slate-500">{data.subtitle || 'No details configured yet.'}</div>
        {data.kind === 'agent' && data.prompt && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 line-clamp-3">
            {data.prompt}
          </div>
        )}
        {data.kind === 'crew' && data.prompt && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 line-clamp-3">
            {data.prompt}
          </div>
        )}
        {data.kind === 'tool' && data.argsTemplate && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 line-clamp-3">
            {data.argsTemplate}
          </div>
        )}
        {data.kind === 'loop' && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600">
            {data.itemsTemplate || '{{input.items}}'} {'->'} {data.itemTemplate || '{{item}}'}
          </div>
        )}
        {data.kind === 'condition' && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600">
            {data.left || '{{last.text}}'} {data.operator || 'contains'} {data.right || 'value'}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-indigo-500" />
    </div>
  );
};

const nodeTypes = { workflowNode: WorkflowNodeCard };

export default function WorkflowsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | 'new'>('new');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('draft');
  const [workflowTriggerType, setWorkflowTriggerType] = useState('manual');
  const [workflowProjectId, setWorkflowProjectId] = useState<string>('');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [saveNotice, setSaveNotice] = useState<string>('');
  const [executionInput, setExecutionInput] = useState('{"message":"Run this workflow"}');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [runningWorkflowRunId, setRunningWorkflowRunId] = useState<number | null>(null);

  const loadAll = async () => {
    const [projectRes, agentRes, crewRes, toolRes, workflowRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/agents'),
      fetch('/api/crews'),
      fetch('/api/tools'),
      fetch('/api/workflows'),
    ]);
    const projectsData = await projectRes.json().catch(() => []);
    const agentsData = await agentRes.json().catch(() => []);
    const crewsData = await crewRes.json().catch(() => []);
    const toolsData = await toolRes.json().catch(() => []);
    const workflowData = await workflowRes.json().catch(() => []);
    setProjects(Array.isArray(projectsData) ? projectsData : []);
    setAgents(Array.isArray(agentsData) ? agentsData : []);
    setCrews(Array.isArray(crewsData) ? crewsData : []);
    setTools(Array.isArray(toolsData) ? toolsData : []);
    setWorkflows(Array.isArray(workflowData) ? workflowData : []);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const loadWorkflow = useCallback(async (id: number) => {
    const res = await fetch(`/api/workflows/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setWorkflowName(String(data.name || 'Untitled Workflow'));
    setWorkflowDescription(String(data.description || ''));
    setWorkflowStatus(String(data.status || 'draft'));
    setWorkflowTriggerType(String(data.trigger_type || 'manual'));
    setWorkflowProjectId(data.project_id != null ? String(data.project_id) : '');
    const graph = safeJson(data.graph || '{}', DEFAULT_GRAPH);
    setNodes(Array.isArray(graph.nodes) && graph.nodes.length ? graph.nodes : DEFAULT_GRAPH.nodes as any);
    setEdges(Array.isArray(graph.edges) ? graph.edges : DEFAULT_GRAPH.edges as any);
    setRuns(Array.isArray(data.runs) ? data.runs.map((run: any) => ({
      ...run,
      input: safeJson(run.input || '{}', {}),
      output: safeJson(run.output || 'null', null),
      logs: safeJson(run.logs || '[]', []),
    })) : []);
  }, [setEdges, setNodes]);

  useEffect(() => {
    if (selectedWorkflowId === 'new') {
      setWorkflowName('Untitled Workflow');
      setWorkflowDescription('');
      setWorkflowStatus('draft');
      setWorkflowTriggerType('manual');
      setWorkflowProjectId('');
      setNodes(DEFAULT_GRAPH.nodes as any);
      setEdges(DEFAULT_GRAPH.edges as any);
      setRuns([]);
      setSelectedRun(null);
      return;
    }
    void loadWorkflow(selectedWorkflowId);
  }, [loadWorkflow, selectedWorkflowId, setEdges, setNodes]);

  const onConnect = useCallback((params: Edge | Connection) => {
    setEdges((eds) => addEdge({ ...(params as any), animated: true, style: { stroke: '#6366f1', strokeWidth: 2 } } as any, eds));
  }, [setEdges]);

  const displayEdges = useMemo(() => {
    const grouped = new Map<string, Edge[]>();
    for (const edge of edges) {
      if (!grouped.has(edge.source)) grouped.set(edge.source, []);
      grouped.get(edge.source)!.push(edge);
    }
    return edges.map((edge) => {
      const sourceNode = nodes.find((node) => node.id === edge.source);
      if (sourceNode?.data.kind === 'condition') {
        const siblings = grouped.get(edge.source) || [];
        const idx = siblings.findIndex((item) => item.id === edge.id);
        return {
          ...edge,
          label: idx === 0 ? 'true' : idx === 1 ? 'false' : `path ${idx + 1}`,
          labelStyle: { fill: '#475569', fontWeight: 600 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 8,
        };
      }
      return edge;
    });
  }, [edges, nodes]);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  const updateSelectedNode = (patch: Partial<WorkflowNodeData>) => {
    if (!selectedNodeId) return;
    setNodes((prev) => prev.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const addNode = (kind: WorkflowNodeData['kind']) => {
    const count = nodes.length + 1;
    const newNode: Node<WorkflowNodeData> = {
      id: `${kind}_${Date.now()}`,
      type: 'workflowNode',
      position: { x: 200 + (count % 3) * 260, y: 120 + Math.floor(count / 3) * 180 },
      data: {
        label: kind === 'trigger' ? 'Manual Trigger' : kind === 'agent' ? 'Agent Task' : kind === 'crew' ? 'Crew Run' : kind === 'tool' ? 'Tool Call' : kind === 'loop' ? 'Loop' : kind === 'condition' ? 'Condition' : 'Output',
        kind,
        subtitle: kind === 'trigger' ? 'Entry point' : kind === 'agent' ? 'Runs an agent' : kind === 'crew' ? 'Runs a crew' : kind === 'tool' ? 'Runs a tool' : kind === 'loop' ? 'Maps over a list' : kind === 'condition' ? 'Branch gate' : 'Final response',
        prompt: kind === 'agent' || kind === 'crew' ? '{{input.message}}' : undefined,
        argsTemplate: kind === 'tool' ? '{"query":"{{input.message}}"}' : undefined,
        itemsTemplate: kind === 'loop' ? '{{input.items}}' : undefined,
        itemTemplate: kind === 'loop' ? '{{item}}' : undefined,
        joinWith: kind === 'loop' ? '\n' : undefined,
        left: kind === 'condition' ? '{{last.text}}' : undefined,
        right: kind === 'condition' ? 'success' : undefined,
        operator: kind === 'condition' ? 'contains' : undefined,
        template: kind === 'output' ? '{{last.text}}' : undefined,
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  };

  const saveWorkflow = async () => {
    const payload = {
      name: workflowName,
      description: workflowDescription,
      status: workflowStatus,
      trigger_type: workflowTriggerType,
      project_id: workflowProjectId ? Number(workflowProjectId) : null,
      graph: { nodes, edges },
    };
    const res = await fetch(selectedWorkflowId === 'new' ? '/api/workflows' : `/api/workflows/${selectedWorkflowId}`, {
      method: selectedWorkflowId === 'new' ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveNotice(data?.error || 'Failed to save workflow');
      return;
    }
    const workflowId = selectedWorkflowId === 'new' ? Number(data.id) : Number(selectedWorkflowId);
    setSelectedWorkflowId(workflowId);
    setSaveNotice(selectedWorkflowId === 'new' ? 'Workflow created.' : 'Workflow updated.');
    await loadAll();
    await loadWorkflow(workflowId);
    setTimeout(() => setSaveNotice(''), 1800);
  };

  const executeWorkflow = async (wait = true) => {
    const workflowId = selectedWorkflowId === 'new' ? null : Number(selectedWorkflowId);
    if (!workflowId) {
      setSaveNotice('Save the workflow before executing it.');
      return;
    }
    let parsedInput: any = {};
    try {
      parsedInput = executionInput.trim() ? JSON.parse(executionInput) : {};
    } catch {
      setSaveNotice('Execution input must be valid JSON.');
      return;
    }
    const res = await fetch(`/api/workflows/${workflowId}/execute?wait=${wait ? 'true' : 'false'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: parsedInput, wait }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveNotice(data?.error || 'Workflow execution failed.');
      return;
    }
    if (!wait) {
      const runId = Number(data?.run_id || 0);
      if (runId > 0) {
        setRunningWorkflowRunId(runId);
        setSaveNotice(`Workflow run #${runId} started.`);
      }
      return;
    }
    await loadWorkflow(workflowId);
    setSaveNotice('Workflow executed.');
    setTimeout(() => setSaveNotice(''), 1800);
  };

  useEffect(() => {
    if (!runningWorkflowRunId) return;
    const es = new EventSource(`/api/workflow-runs/${runningWorkflowRunId}/stream`);
    es.addEventListener('update', (event) => {
      try {
        const payload = JSON.parse(String((event as MessageEvent).data || '{}'));
        const run = payload?.run;
        if (!run) return;
        const normalized: WorkflowRun = {
          ...run,
          input: run.input ?? {},
          output: run.output ?? null,
          logs: Array.isArray(run.logs) ? run.logs : [],
        };
        setRuns((prev) => {
          const rest = prev.filter((item) => item.id !== normalized.id);
          return [normalized, ...rest];
        });
        setSelectedRun((prev) => (prev?.id === normalized.id || !prev ? normalized : prev));
      } catch {
        // ignore malformed updates
      }
    });
    es.addEventListener('done', () => {
      es.close();
      if (selectedWorkflowId !== 'new') {
        void loadWorkflow(Number(selectedWorkflowId));
      }
      setRunningWorkflowRunId(null);
    });
    es.addEventListener('error', () => {
      es.close();
      setRunningWorkflowRunId(null);
    });
    return () => es.close();
  }, [loadWorkflow, runningWorkflowRunId, selectedWorkflowId]);

  const openVersions = async () => {
    if (selectedWorkflowId === 'new') return;
    const res = await fetch(`/api/workflows/${selectedWorkflowId}/versions`);
    const data = await res.json().catch(() => ({}));
    setVersions(Array.isArray(data?.versions) ? data.versions : []);
    setShowVersions(true);
  };

  const restoreVersion = async (versionId: number) => {
    if (selectedWorkflowId === 'new') return;
    await fetch(`/api/workflows/${selectedWorkflowId}/restore/${versionId}`, { method: 'POST' });
    await loadAll();
    await loadWorkflow(Number(selectedWorkflowId));
    setShowVersions(false);
  };

  const webhookEndpoint = selectedWorkflowId === 'new'
    ? ''
    : `${window.location.origin}/api/workflows/${selectedWorkflowId}/webhook`;

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
              <Boxes size={12} />
              Workflow Runtime
            </div>
            <h1 className="text-3xl font-black text-white">Workflows</h1>
            <p className="text-slate-300 mt-1">Build drag-and-connect orchestration graphs for agents, crews, loops, tools, webhook triggers, and live workflow runs.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={openVersions} disabled={selectedWorkflowId === 'new'} className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Versions
            </button>
            <button onClick={saveWorkflow} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
              <Save size={14} /> Save
            </button>
            <button onClick={() => void executeWorkflow(false)} className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white inline-flex items-center gap-2">
              <Radio size={14} /> Run Live
            </button>
            <button onClick={() => void executeWorkflow(true)} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white inline-flex items-center gap-2">
              <Play size={14} /> Run
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 xl:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-900">Workflow Library</div>
              <button onClick={() => setSelectedWorkflowId('new')} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 inline-flex items-center gap-1">
                <Plus size={12} /> New
              </button>
            </div>
            <div className="space-y-2 max-h-[340px] overflow-auto pr-1">
              {workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedWorkflowId === workflow.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900 truncate">{workflow.name}</div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTone(workflow.last_run_status || workflow.status)}`}>
                      {workflow.last_run_status || workflow.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 line-clamp-2">{workflow.description || 'No description yet.'}</div>
                  <div className="mt-2 text-[11px] text-slate-400">v{workflow.version || 1} • {workflow.runs_count || 0} runs</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Node Palette</div>
            <div className="grid grid-cols-2 gap-2">
              {(['trigger', 'agent', 'crew', 'tool', 'loop', 'condition', 'output'] as WorkflowNodeData['kind'][]).map((kind) => (
                <button
                  key={kind}
                  onClick={() => addNode(kind)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{kind}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Workflow Meta</div>
            <input value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Workflow name" />
            <textarea value={workflowDescription} onChange={(e) => setWorkflowDescription(e.target.value)} className="min-h-[84px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Describe this workflow" />
            <select value={workflowStatus} onChange={(e) => setWorkflowStatus(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
            <select value={workflowTriggerType} onChange={(e) => setWorkflowTriggerType(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="manual">Manual trigger</option>
              <option value="webhook">Webhook trigger</option>
            </select>
            <select value={workflowProjectId} onChange={(e) => setWorkflowProjectId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            {workflowTriggerType === 'webhook' && (
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">
                  <Webhook size={12} />
                  Webhook Endpoint
                </div>
                <div className="mt-2 rounded-xl border border-cyan-100 bg-white px-3 py-2 text-[11px] text-slate-700 break-all">
                  {webhookEndpoint || 'Save the workflow to generate the webhook URL.'}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">POST JSON to this endpoint with `?wait=true` for sync replies or omit it for queued runs.</div>
              </div>
            )}
            {saveNotice && <div className="text-xs text-indigo-600">{saveNotice}</div>}
          </div>
        </aside>

        <section className="col-span-12 xl:col-span-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Workflow Canvas</div>
                <div className="text-xs text-slate-500 mt-1">Drag nodes, connect edges, and shape orchestration paths.</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">{nodes.length} nodes • {edges.length} edges{runningWorkflowRunId ? ` • live run #${runningWorkflowRunId}` : ''}</div>
                <div className="mt-1 text-[11px] text-slate-500">Condition routing uses edge order: first path = true, second path = false.</div>
              </div>
            </div>
            <div className="h-[720px] rounded-2xl border border-slate-200 overflow-hidden">
              <ReactFlow
                nodes={nodes}
                edges={displayEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                nodeTypes={nodeTypes}
                fitView
              >
                <MiniMap maskColor="rgba(248,250,252,0.82)" />
                <Controls />
                <Background color="#dbe4f0" gap={16} />
              </ReactFlow>
            </div>
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Node Inspector</div>
            {selectedNode ? (
              <>
                <input value={selectedNode.data.label} onChange={(e) => updateSelectedNode({ label: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <input value={selectedNode.data.subtitle || ''} onChange={(e) => updateSelectedNode({ subtitle: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Subtitle" />
                {selectedNode.data.kind === 'agent' && (
                  <>
                    <select value={selectedNode.data.agentId || ''} onChange={(e) => updateSelectedNode({ agentId: Number(e.target.value), subtitle: agents.find((agent) => agent.id === Number(e.target.value))?.name || 'Runs an agent' })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      <option value="">Choose agent</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                    <textarea value={selectedNode.data.prompt || ''} onChange={(e) => updateSelectedNode({ prompt: e.target.value })} className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Prompt template, e.g. {{input.message}}" />
                  </>
                )}
                {selectedNode.data.kind === 'crew' && (
                  <>
                    <select value={selectedNode.data.crewId || ''} onChange={(e) => updateSelectedNode({ crewId: Number(e.target.value), subtitle: crews.find((crew) => crew.id === Number(e.target.value))?.name || 'Runs a crew' })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      <option value="">Choose crew</option>
                      {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
                    </select>
                    <textarea value={selectedNode.data.prompt || ''} onChange={(e) => updateSelectedNode({ prompt: e.target.value })} className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Crew input template, e.g. {{input.message}}" />
                  </>
                )}
                {selectedNode.data.kind === 'tool' && (
                  <>
                    <select value={selectedNode.data.toolId || ''} onChange={(e) => updateSelectedNode({ toolId: Number(e.target.value), subtitle: tools.find((tool) => tool.id === Number(e.target.value))?.name || 'Runs a tool' })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      <option value="">Choose tool</option>
                      {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
                    </select>
                    <textarea value={selectedNode.data.argsTemplate || ''} onChange={(e) => updateSelectedNode({ argsTemplate: e.target.value })} className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" placeholder='{"query":"{{input.message}}"}' />
                  </>
                )}
                {selectedNode.data.kind === 'loop' && (
                  <>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                      Loop nodes map a list into a new array. Use <code>{'{{item}}'}</code> and <code>{'{{index}}'}</code> inside the item template.
                    </div>
                    <textarea value={selectedNode.data.itemsTemplate || ''} onChange={(e) => updateSelectedNode({ itemsTemplate: e.target.value })} className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" placeholder='{{input.items}} or ["a","b"]' />
                    <textarea value={selectedNode.data.itemTemplate || ''} onChange={(e) => updateSelectedNode({ itemTemplate: e.target.value })} className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" placeholder='Item {{index}}: {{item}}' />
                    <input value={selectedNode.data.joinWith || ''} onChange={(e) => updateSelectedNode({ joinWith: e.target.value, subtitle: 'Maps over a list' })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="\n" />
                  </>
                )}
                {selectedNode.data.kind === 'condition' && (
                  <>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      Connect the first outgoing edge for the true branch and the second for the false branch.
                    </div>
                    <input value={selectedNode.data.left || ''} onChange={(e) => updateSelectedNode({ left: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="{{last.text}}" />
                    <select value={selectedNode.data.operator || 'contains'} onChange={(e) => updateSelectedNode({ operator: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="truthy">truthy</option>
                    </select>
                    <input value={selectedNode.data.right || ''} onChange={(e) => updateSelectedNode({ right: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="success" />
                  </>
                )}
                {selectedNode.data.kind === 'output' && (
                  <textarea value={selectedNode.data.template || ''} onChange={(e) => updateSelectedNode({ template: e.target.value })} className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="{{last.text}}" />
                )}
              </>
            ) : (
              <div className="text-sm text-slate-500">Select a node on the canvas to edit it.</div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">{workflowTriggerType === 'webhook' ? 'Webhook Payload' : 'Run Input'}</div>
            <textarea value={executionInput} onChange={(e) => setExecutionInput(e.target.value)} className="min-h-[110px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" />
            <div className="text-xs text-slate-500">
              Use JSON input like <span className="font-mono">{"{\"message\":\"Launch campaign audit\",\"items\":[\"ads\",\"campaigns\"]}"}</span>.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-900">Recent Runs</div>
              <Clock3 size={14} className="text-slate-400" />
            </div>
            <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
              {runs.length ? runs.map((run) => (
                <button key={run.id} onClick={() => setSelectedRun(run)} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left hover:bg-slate-100">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">Run #{run.id}</div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTone(run.status)}`}>{run.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{new Date(run.created_at).toLocaleString()}</div>
                  {runningWorkflowRunId === run.id && <div className="mt-1 text-[11px] text-indigo-600">Streaming live updates…</div>}
                </button>
              )) : <div className="text-sm text-slate-500">No workflow runs yet.</div>}
            </div>
            {selectedRun && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-2">Run Detail</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">Run #{selectedRun.id}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTone(selectedRun.status)}`}>{selectedRun.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="uppercase tracking-[0.18em] text-slate-400">Events</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{selectedRun.logs?.length || 0}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="uppercase tracking-[0.18em] text-slate-400">Updated</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{new Date(selectedRun.updated_at || selectedRun.created_at).toLocaleTimeString()}</div>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-slate-500">Input</div>
                <pre className="mt-1 max-h-[100px] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-[11px] text-slate-700 border border-slate-200">{JSON.stringify(selectedRun.input, null, 2)}</pre>
                <div className="mt-2 text-[11px] text-slate-500">Output</div>
                <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 text-[11px] text-slate-100">{JSON.stringify(selectedRun.output, null, 2)}</pre>
                <div className="mt-3 text-[11px] text-slate-500">Logs</div>
                <div className="mt-1 max-h-[160px] overflow-auto space-y-2">
                  {(selectedRun.logs || []).map((log, index) => (
                    <div key={`${log.ts}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{log.type}</div>
                      <div className="mt-1 text-[11px] text-slate-600">{JSON.stringify(log.payload)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {showVersions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="text-lg font-semibold text-slate-900">Workflow Versions</div>
              <button onClick={() => setShowVersions(false)} className="text-slate-400 hover:text-slate-600"><RotateCcw size={16} /></button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5 space-y-3">
              {versions.map((version) => (
                <div key={version.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">v{version.version_number} • {version.change_kind}</div>
                      <div className="text-xs text-slate-500 mt-1">{new Date(version.created_at).toLocaleString()}</div>
                    </div>
                    <button onClick={() => void restoreVersion(version.id)} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">
                      Restore
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{version.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
