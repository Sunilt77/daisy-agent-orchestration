import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Edge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { User, Target, CheckCircle2 } from 'lucide-react';

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

interface CrewWorkflowProps {
  tasks: Task[];
  agents: Agent[];
  onNodeClick: (task: Task) => void;
  processType: string;
}

const TaskNode = ({ data }: NodeProps) => {
  const task = data.task as Task;
  const agent = data.agent as Agent | undefined;
  const index = data.index as number;

  return (
    <div className="bg-white border-2 border-slate-200 rounded-xl shadow-sm w-72 overflow-hidden hover:border-indigo-400 transition-colors cursor-pointer">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-indigo-500" />
      
      <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
            {index + 1}
          </div>
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Task</span>
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
      </div>
      
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-indigo-500" />
    </div>
  );
};

const nodeTypes = {
  taskNode: TaskNode,
};

export default function CrewWorkflow({ tasks, agents, onNodeClick, processType }: CrewWorkflowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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
        data: { task, agent, index },
      };
    });

    const newEdges: Edge[] = [];
    for (let i = 0; i < tasks.length - 1; i++) {
      newEdges.push({
        id: `e-${tasks[i].id}-${tasks[i+1].id}`,
        source: `task-${tasks[i].id}`,
        target: `task-${tasks[i+1].id}`,
        animated: true,
        style: { stroke: '#6366f1', strokeWidth: 2 },
      });
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [tasks, agents, processType]);

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const handleNodeClick = (event: React.MouseEvent, node: any) => {
    if (node.data && node.data.task) {
      onNodeClick(node.data.task);
    }
  };

  return (
    <div className="w-full h-[600px] bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
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
            return '#6366f1';
          }}
          maskColor="rgba(248, 250, 252, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
