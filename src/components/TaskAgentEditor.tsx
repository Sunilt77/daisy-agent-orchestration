import React, { useState, useEffect } from 'react';
import { X, Save, Trash2 } from 'lucide-react';

interface Tool {
  id: number;
  name: string;
}

interface Agent {
  id: number;
  name: string;
  role: string;
  goal: string;
  backstory: string;
  model: string;
  provider: string;
  is_exposed: boolean;
  tools: Tool[];
}

interface Task {
  id: number;
  description: string;
  expected_output: string;
  agent_id: number;
}

interface TaskAgentEditorProps {
  task: Task;
  agent?: Agent;
  allAgents: Agent[];
  onClose: () => void;
  onSaveTask: (taskId: number, updates: Partial<Task>) => Promise<void>;
  onSaveAgent: (agentId: number, updates: Partial<Agent>) => Promise<void>;
  onDeleteTask: (taskId: number) => Promise<void>;
}

export default function TaskAgentEditor({
  task,
  agent,
  allAgents,
  onClose,
  onSaveTask,
  onSaveAgent,
  onDeleteTask
}: TaskAgentEditorProps) {
  const [activeTab, setActiveTab] = useState<'task' | 'agent'>('task');
  
  // Task State
  const [taskDescription, setTaskDescription] = useState(task.description);
  const [taskOutput, setTaskOutput] = useState(task.expected_output);
  const [taskAgentId, setTaskAgentId] = useState(task.agent_id.toString());
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Agent State
  const [agentName, setAgentName] = useState(agent?.name || '');
  const [agentRole, setAgentRole] = useState(agent?.role || '');
  const [agentGoal, setAgentGoal] = useState(agent?.goal || '');
  const [agentBackstory, setAgentBackstory] = useState(agent?.backstory || '');
  const [agentModel, setAgentModel] = useState(agent?.model || 'gemini-1.5-flash');
  const [agentProvider, setAgentProvider] = useState(agent?.provider || 'google');
  const [isSavingAgent, setIsSavingAgent] = useState(false);

  useEffect(() => {
    setTaskDescription(task.description);
    setTaskOutput(task.expected_output);
    setTaskAgentId(task.agent_id.toString());
  }, [task]);

  useEffect(() => {
    if (agent) {
      setAgentName(agent.name);
      setAgentRole(agent.role);
      setAgentGoal(agent.goal);
      setAgentBackstory(agent.backstory);
      setAgentModel(agent.model);
      setAgentProvider(agent.provider);
    }
  }, [agent]);

  const handleSaveTask = async () => {
    setIsSavingTask(true);
    await onSaveTask(task.id, {
      description: taskDescription,
      expected_output: taskOutput,
      agent_id: Number(taskAgentId)
    });
    setIsSavingTask(false);
  };

  const handleSaveAgent = async () => {
    if (!agent) return;
    setIsSavingAgent(true);
    await onSaveAgent(agent.id, {
      name: agentName,
      role: agentRole,
      goal: agentGoal,
      backstory: agentBackstory,
      model: agentModel,
      provider: agentProvider
    });
    setIsSavingAgent(false);
  };

  const handleDeleteTask = async () => {
    if (confirm('Are you sure you want to delete this task?')) {
      await onDeleteTask(task.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50 animate-in slide-in-from-right">
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800">Edit Configuration</h2>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
          <X size={20} />
        </button>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'task' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          onClick={() => setActiveTab('task')}
        >
          Task Settings
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'agent' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
          onClick={() => setActiveTab('agent')}
        >
          Agent Settings
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'task' ? (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expected Output</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                value={taskOutput}
                onChange={(e) => setTaskOutput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Agent</label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                value={taskAgentId}
                onChange={(e) => setTaskAgentId(e.target.value)}
              >
                <option value="">Select an agent...</option>
                {allAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>
            </div>
            
            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <button
                onClick={handleDeleteTask}
                className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm font-medium px-3 py-2 rounded-lg hover:bg-red-50"
              >
                <Trash2 size={16} /> Delete Task
              </button>
              
              <button
                onClick={handleSaveTask}
                disabled={isSavingTask}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium"
              >
                <Save size={16} /> {isSavingTask ? 'Saving...' : 'Save Task'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {agent ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                  <input
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <input
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Goal</label>
                  <textarea
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px]"
                    value={agentGoal}
                    onChange={(e) => setAgentGoal(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Backstory</label>
                  <textarea
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[120px]"
                    value={agentBackstory}
                    onChange={(e) => setAgentBackstory(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                    <select
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      value={agentProvider}
                      onChange={(e) => setAgentProvider(e.target.value)}
                    >
                      <option value="google">Google</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
                    <input
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={agentModel}
                      onChange={(e) => setAgentModel(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="pt-4 flex items-center justify-end border-t border-slate-100">
                  <button
                    onClick={handleSaveAgent}
                    disabled={isSavingAgent}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium"
                  >
                    <Save size={16} /> {isSavingAgent ? 'Saving...' : 'Save Agent'}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-slate-500">
                No agent assigned to this task.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
