import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  Edge,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, CheckCircle2, Clock3, Sparkles, User, Wrench } from 'lucide-react';

interface Task {
  id: number;
  description: string;
  expected_output: string;
  agent_id: number;
}

interface Agent {
  id: number;
  name: string;
  role: string;
}

interface LogEntry {
  type: string;
  agent?: string;
  task?: string;
  tool?: string;
  message?: string;
  status?: string;
  title?: string;
}

interface CrewWorkflowProps {
  tasks: Task[];
  agents: Agent[];
  onNodeClick: (task: Task) => void;
  processType: string;
  logs?: LogEntry[];
  isRunning?: boolean;
}

const TaskNode = ({ data }: NodeProps) => {
  const task = data.task as Task;
  const agent = data.agent as Agent | undefined;
  const index = data.index as number;
  const status = (data.status as 'idle' | 'active' | 'completed' | 'error') || 'idle';
  const activeTool = data.activeTool as string | undefined;
  const liveLabel = data.liveLabel as string | undefined;
  const isActive = status === 'active';
  const isCompleted = status === 'completed';
  const isError = status === 'error';

  return (
    <div
      className={`w-80 overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all cursor-pointer ${
        isActive
          ? 'border-cyan-400 shadow-cyan-200/80 shadow-2xl scale-[1.02]'
          : isCompleted
            ? 'border-emerald-300 shadow-emerald-100/70'
            : isError
              ? 'border-red-300 shadow-red-100/70'
              : 'border-slate-200 hover:border-indigo-400'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`w-3 h-3 ${isCompleted ? 'bg-emerald-500' : isActive ? 'bg-cyan-500' : 'bg-indigo-500'}`}
      />
      
      <div
        className={`flex items-center justify-between border-b p-3 ${
          isActive
            ? 'border-cyan-100 bg-gradient-to-r from-cyan-50 via-sky-50 to-white'
            : isCompleted
              ? 'border-emerald-100 bg-gradient-to-r from-emerald-50 to-white'
              : isError
                ? 'border-red-100 bg-gradient-to-r from-red-50 to-white'
                : 'border-slate-100 bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
              isActive
                ? 'bg-cyan-500 text-white'
                : isCompleted
                  ? 'bg-emerald-500 text-white'
                  : isError
                    ? 'bg-red-500 text-white'
                    : 'bg-indigo-100 text-indigo-600'
            }`}
          >
            {index + 1}
          </div>
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Task</span>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            isActive
              ? 'bg-cyan-100 text-cyan-700'
              : isCompleted
                ? 'bg-emerald-100 text-emerald-700'
                : isError
                  ? 'bg-red-100 text-red-700'
                  : 'bg-slate-100 text-slate-500'
          }`}
        >
          {isActive ? <Sparkles size={11} /> : isCompleted ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}
          {status}
        </div>
      </div>
      
      <div className="p-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-slate-800 line-clamp-2" title={task.description}>
            {task.description}
          </h4>
        </div>
        
        <div className="bg-slate-50 rounded-lg p-2 flex items-start gap-2 border border-slate-100">
          <User size={14} className="text-slate-400 mt-0.5" />
          <div>
            <div className="text-xs font-medium text-slate-700">{agent?.name || 'Unassigned'}</div>
            <div className="text-[10px] text-slate-500">{agent?.role || 'No role'}</div>
          </div>
        </div>

        {isActive && (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
            <div className="flex items-center gap-2 font-semibold">
              <Bot size={13} />
              Active now
            </div>
            <div className="mt-1 text-[11px] text-cyan-800">
              {liveLabel || 'Processing this node'}
            </div>
          </div>
        )}

        {activeTool && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            <div className="flex items-center gap-2 font-semibold">
              <Wrench size={13} />
              Tool in flight
            </div>
            <div className="mt-1 font-mono text-[11px] break-all">{activeTool}</div>
          </div>
        )}
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        className={`w-3 h-3 ${isCompleted ? 'bg-emerald-500' : isActive ? 'bg-cyan-500' : 'bg-indigo-500'}`}
      />
    </div>
  );
};

const nodeTypes = {
  taskNode: TaskNode,
};

function normalizeText(value: string | undefined | null) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export default function CrewWorkflow({ tasks, agents, onNodeClick, processType, logs = [], isRunning = false }: CrewWorkflowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const runtimeState = useMemo(() => {
    const taskStatus = new Map<number, 'idle' | 'active' | 'completed' | 'error'>();
    const activeToolByTask = new Map<number, string>();
    const liveLabelByTask = new Map<number, string>();
    const taskIdsByAgent = new Map<number, number[]>();
    const taskByDescription = new Map<string, number>();
    const agentNamesByTask = new Map<number, string>();
    let activeTaskId: number | null = null;
    let currentActivity = isRunning ? 'Crew is warming up.' : 'Ready for the next run.';
    let currentTool: string | null = null;

    tasks.forEach((task) => {
      taskStatus.set(task.id, 'idle');
      const descKey = normalizeText(task.description);
      if (descKey) taskByDescription.set(descKey, task.id);
      const list = taskIdsByAgent.get(task.agent_id) || [];
      list.push(task.id);
      taskIdsByAgent.set(task.agent_id, list);
      const agentName = agents.find((agent) => Number(agent.id) === Number(task.agent_id))?.name;
      if (agentName) agentNamesByTask.set(task.id, agentName);
    });

    const findTaskId = (log: LogEntry) => {
      const directTask = normalizeText(log.task);
      if (directTask && taskByDescription.has(directTask)) return taskByDescription.get(directTask) ?? null;
      const matchingTask = tasks.find((task) => {
        const taskText = normalizeText(task.description);
        const agentName = normalizeText(agentNamesByTask.get(task.id));
        const title = normalizeText(log.title);
        return (
          (directTask && (taskText.includes(directTask) || directTask.includes(taskText))) ||
          (title && (title.includes(taskText) || taskText.includes(title))) ||
          (log.agent && agentName && agentName === normalizeText(log.agent))
        );
      });
      return matchingTask?.id ?? null;
    };

    logs.forEach((log) => {
      const matchedTaskId = findTaskId(log);
      if (log.type === 'start' && matchedTaskId != null) {
        taskStatus.set(matchedTaskId, 'active');
        liveLabelByTask.set(matchedTaskId, log.task || `Running ${log.agent || 'assigned agent'}`);
        activeTaskId = matchedTaskId;
        currentActivity = `${log.agent || 'Agent'} is working on step ${tasks.findIndex((task) => task.id === matchedTaskId) + 1}.`;
      }
      if (log.type === 'tool_call' && matchedTaskId != null) {
        taskStatus.set(matchedTaskId, 'active');
        activeToolByTask.set(matchedTaskId, String(log.tool || 'tool'));
        liveLabelByTask.set(matchedTaskId, `Calling ${log.tool || 'tool'}`);
        activeTaskId = matchedTaskId;
        currentTool = String(log.tool || '');
        currentActivity = `${log.agent || 'Agent'} is calling ${log.tool || 'a tool'}.`;
      }
      if (log.type === 'tool_result' && matchedTaskId != null) {
        taskStatus.set(matchedTaskId, 'active');
        liveLabelByTask.set(matchedTaskId, `Tool returned from ${log.tool || 'tool'}`);
      }
      if ((log.type === 'finish' || (log.type === 'crew_delegate' && log.status === 'completed') || log.type === 'crew_synthesis_step') && matchedTaskId != null) {
        taskStatus.set(matchedTaskId, 'completed');
        activeToolByTask.delete(matchedTaskId);
        if (activeTaskId === matchedTaskId) activeTaskId = null;
        currentActivity = `${log.agent || 'Crew'} completed step ${tasks.findIndex((task) => task.id === matchedTaskId) + 1}.`;
      }
      if (log.type === 'error' && matchedTaskId != null) {
        taskStatus.set(matchedTaskId, 'error');
        activeToolByTask.delete(matchedTaskId);
        activeTaskId = matchedTaskId;
        liveLabelByTask.set(matchedTaskId, log.message || 'Step failed');
        currentActivity = log.message || 'A crew step failed.';
      }
      if ((log.type === 'crew_result' || log.type === 'crew_summary') && !isRunning) {
        currentActivity = 'Crew run completed. Review the final synthesis below.';
        currentTool = null;
      }
    });

    if (isRunning && activeTaskId == null) {
      const firstIdle = tasks.find((task) => taskStatus.get(task.id) === 'idle');
      if (firstIdle) {
        activeTaskId = firstIdle.id;
        if (taskStatus.get(firstIdle.id) !== 'completed') {
          taskStatus.set(firstIdle.id, 'active');
          liveLabelByTask.set(firstIdle.id, 'Queued as the next active step');
        }
      }
    }

    return {
      taskStatus,
      activeTaskId,
      activeToolByTask,
      liveLabelByTask,
      currentActivity,
      currentTool,
      completedCount: Array.from(taskStatus.values()).filter((status) => status === 'completed').length,
    };
  }, [agents, isRunning, logs, tasks]);

  useEffect(() => {
    const newNodes = tasks.map((task, index) => {
      const agent = agents.find(a => a.id === task.agent_id);
      
      // Calculate position based on process type
      // For sequential, just line them up vertically
      // For hierarchical, we could do a tree, but let's stick to a simple layout for now
      const x = 250;
      const y = index * 250 + 50;

      return {
        id: `task-${task.id}`,
        type: 'taskNode',
        position: { x, y },
        data: {
          task,
          agent,
          index,
          status: runtimeState.taskStatus.get(task.id) || 'idle',
          activeTool: runtimeState.activeToolByTask.get(task.id),
          liveLabel: runtimeState.liveLabelByTask.get(task.id),
        },
      };
    });

    const newEdges: Edge[] = [];
    for (let i = 0; i < tasks.length - 1; i++) {
      const sourceTask = tasks[i];
      const targetTask = tasks[i + 1];
      const sourceDone = runtimeState.taskStatus.get(sourceTask.id) === 'completed';
      const targetActive = runtimeState.activeTaskId === targetTask.id;
      newEdges.push({
        id: `e-${tasks[i].id}-${tasks[i+1].id}`,
        source: `task-${tasks[i].id}`,
        target: `task-${tasks[i+1].id}`,
        animated: isRunning && (targetActive || !sourceDone),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: sourceDone ? '#10b981' : targetActive ? '#06b6d4' : '#6366f1',
        },
        style: {
          stroke: sourceDone ? '#10b981' : targetActive ? '#06b6d4' : '#6366f1',
          strokeWidth: targetActive ? 3 : 2,
        },
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [tasks, agents, processType, runtimeState, isRunning, setNodes, setEdges]);

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const handleNodeClick = (event: React.MouseEvent, node: any) => {
    if (node.data && node.data.task) {
      onNodeClick(node.data.task);
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_28%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">Live Crew Orchestration</div>
            <div className="mt-1 text-sm text-slate-100">
              {runtimeState.currentActivity}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-100">
              {runtimeState.completedCount}/{tasks.length || 0} completed
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isRunning ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/30' : 'bg-emerald-400/15 text-emerald-100 ring-1 ring-emerald-300/30'
            }`}>
              {isRunning ? 'Execution Live' : 'Idle'}
            </div>
            {runtimeState.currentTool ? (
              <div className="rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-mono text-violet-100">
                {runtimeState.currentTool}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="h-[640px] bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
        >
          <Background color="#cbd5e1" gap={16} />
          <Controls />
          <MiniMap 
            nodeColor={(node) => {
              const status = (node.data as any)?.status;
              if (status === 'completed') return '#10b981';
              if (status === 'active') return '#06b6d4';
              if (status === 'error') return '#ef4444';
              return '#6366f1';
            }}
            maskColor="rgba(248, 250, 252, 0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
