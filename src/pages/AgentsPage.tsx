import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Trash2, User, Brain, Target, ScrollText, Wrench, Edit, Globe, Terminal, Copy, Check, X, Folder, Activity, Key, Sparkles, Play, Loader2, ExternalLink, Gauge, Search, List, LayoutGrid, ArrowUpDown, AudioLines, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Pagination from '../components/Pagination';
import { LiveAgentCard } from '../components/LiveAgentCard';
import { loadPersisted, savePersisted } from '../utils/persistence';

interface Tool {
  id: number;
  name: string;
}

interface VoiceConfigPreset {
  id: number;
  name: string;
  voice_id: string;
  tts_model_id: string;
  stt_model_id: string;
  output_format: string;
  sample_rate: number;
  language_code: string;
  auto_tts: boolean;
  notes?: string;
  meta?: {
    vad_enabled?: boolean;
    vad_silence_threshold_secs?: number;
    vad_threshold?: number;
    min_speech_duration_ms?: number;
    min_silence_duration_ms?: number;
    max_tokens_to_recompute?: number;
    browser_noise_suppression?: boolean;
    browser_echo_cancellation?: boolean;
    browser_auto_gain_control?: boolean;
  };
}

const DEFAULT_VAD_SILENCE_THRESHOLD_SECS = 0.8;
const DEFAULT_VAD_THRESHOLD = 0.6;
const DEFAULT_MIN_SPEECH_DURATION_MS = 220;
const DEFAULT_MIN_SILENCE_DURATION_MS = 420;
const DEFAULT_MAX_TOKENS_TO_RECOMPUTE = 5;

interface Agent {
  id: number;
  name: string;
  role: string;
  agent_role?: string;
  status?: 'idle' | 'running';
  goal: string;
  backstory: string;
  system_prompt?: string;
  model: string;
  provider: string;
  temperature?: number | null;
  max_tokens?: number | null;
  memory_window?: number | null;
  max_iterations?: number | null;
  tools_enabled?: boolean | number;
  retry_policy?: string | null;
  timeout_ms?: number | null;
  is_exposed: boolean;
  project_id?: number;
  tools: Tool[];
  mcp_tool_ids?: number[];
  mcp_bundle_ids?: number[];
  mcp_tools?: Array<{ tool_id: number; tool_name: string; exposed_name?: string }>;
  mcp_bundles?: Array<{ id: number; name: string; slug: string }>;
  stats?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_cost: number;
  };
  running_count?: number;
  credential_source?: string;
  credential_source_name?: string;
}

interface AgentExecution {
    id: number;
    agent_id: number;
    status?: string;
    execution_kind?: string;
    parent_execution_id?: number | null;
    delegation_title?: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    total_cost: number;
    input?: string;
    output?: string;
    created_at: string;
}

interface AgentDelegation {
    id: number;
    parent_execution_id: number;
    child_execution_id?: number | null;
    child_job_id?: number | null;
    agent_id: number;
    agent_name?: string;
    role?: string;
    title?: string | null;
    status?: string;
    task?: string | null;
    result?: string | null;
    error?: string | null;
    created_at?: string;
    updated_at?: string;
}

function executionKindLabel(kind?: string) {
    switch (kind) {
        case 'delegated_parent':
            return 'Supervisor';
        case 'delegated_child':
            return 'Delegate';
        case 'delegated_synthesis':
            return 'Synthesis';
        default:
            return 'Standard';
    }
}

function statusPillClass(status?: string) {
    return status === 'failed' || status === 'canceled'
        ? 'bg-red-100 text-red-700'
        : status === 'running' || status === 'queued'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-emerald-100 text-emerald-700';
}

const AgentRunModal = ({ agent, onClose }: { agent: Agent; onClose: () => void }) => {
    const [task, setTask] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState('');
    const [output, setOutput] = useState<string | null>(null);

    const runAgent = async () => {
        if (!task.trim()) return;
        setIsRunning(true);
        setError('');
        setOutput(null);
        try {
            const res = await fetch(`/api/agents/${agent.id}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task })
            });
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
            if (!res.ok) {
                const message = data.error || text || 'Failed to run agent';
                setOutput(`ERROR: ${message}`);
                throw new Error(message);
            }
            setOutput(data.result ?? data.output ?? text ?? '');
        } catch (e: any) {
            setError(e.message || 'Failed to run agent');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-[min(96vw,1200px)] max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900">Run Agent: {agent.name}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Task / Requirements</label>
                        <textarea
                            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28"
                            placeholder="Describe the task and any inputs."
                            value={task}
                            onChange={(e) => setTask(e.target.value)}
                        />
                    </div>
                    {error && <div className="text-sm text-red-600">{error}</div>}
                    {output != null && (
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Output</div>
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap font-mono">
                                {output || 'No output returned.'}
                            </div>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">
                        Close
                    </button>
                    <button
                        onClick={runAgent}
                        disabled={isRunning || !task.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 font-medium"
                    >
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const SupervisorRunModal = ({
    supervisor,
    agents,
    onClose,
    onStarted,
}: {
    supervisor: Agent;
    agents: Agent[];
    onClose: () => void;
    onStarted: (executionId: number) => void;
}) => {
    const delegateCandidates = agents.filter((agent) => agent.id !== supervisor.id);
    const [task, setTask] = useState('');
    const [selectedDelegateIds, setSelectedDelegateIds] = useState<number[]>([]);
    const [delegateInstructions, setDelegateInstructions] = useState<Record<number, string>>({});
    const [synthesize, setSynthesize] = useState(true);
    const [synthesisAgentId, setSynthesisAgentId] = useState<number>(supervisor.id);
    const [isLaunching, setIsLaunching] = useState(false);
    const [error, setError] = useState('');

    const toggleDelegate = (agentId: number) => {
        setSelectedDelegateIds((prev) => prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]);
    };

    const launchDelegation = async () => {
        const normalizedTask = task.trim();
        if (!normalizedTask || !selectedDelegateIds.length) return;
        setIsLaunching(true);
        setError('');
        try {
            const delegates = selectedDelegateIds.map((agentId) => ({
                agent_id: agentId,
                task: delegateInstructions[agentId]?.trim() || normalizedTask,
                title: delegateCandidates.find((agent) => agent.id === agentId)?.name || `Agent ${agentId}`,
            }));
            const res = await fetch(`/api/agents/${supervisor.id}/delegate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task: normalizedTask,
                    delegates,
                    synthesize,
                    synthesis_agent_id: synthesize ? synthesisAgentId : null,
                    wait: false,
                }),
            });
            const data = await safeJson(res) as any;
            if (!res.ok) throw new Error(data?.error || 'Failed to launch supervisor run');
            const executionId = Number(data?.parent_execution_id || 0);
            if (!executionId) throw new Error('No parent execution id returned');
            onStarted(executionId);
            onClose();
        } catch (e: any) {
            setError(e?.message || 'Failed to launch supervisor run');
        } finally {
            setIsLaunching(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-[min(96vw,1200px)] max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">Launch Supervisor Run</h3>
                        <p className="text-sm text-slate-500 mt-1">{supervisor.name} will coordinate background delegate agents.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Mission</label>
                        <textarea
                            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28"
                            placeholder="Describe the objective the supervisor should coordinate."
                            value={task}
                            onChange={(e) => setTask(e.target.value)}
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-slate-700">Delegate Agents</label>
                            <span className="text-xs text-slate-500">{selectedDelegateIds.length} selected</span>
                        </div>
                        {delegateCandidates.length === 0 ? (
                            <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-4">
                                Create at least one additional agent to use supervisor mode.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {delegateCandidates.map((agent) => {
                                    const selected = selectedDelegateIds.includes(agent.id);
                                    return (
                                        <div key={agent.id} className={`rounded-xl border p-4 ${selected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                                            <label className="flex items-start gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                                    checked={selected}
                                                    onChange={() => toggleDelegate(agent.id)}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-slate-900">{agent.name}</div>
                                                    <div className="text-xs text-slate-500">{agent.role}</div>
                                                    <textarea
                                                        className="mt-3 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-60"
                                                        placeholder={`Optional task specialization for ${agent.name}`}
                                                        value={delegateInstructions[agent.id] || ''}
                                                        disabled={!selected}
                                                        onChange={(e) => setDelegateInstructions((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                                                    />
                                                </div>
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                checked={synthesize}
                                onChange={(e) => setSynthesize(e.target.checked)}
                            />
                            <span className="text-sm font-medium text-slate-700">Run a final synthesis pass</span>
                        </label>
                        {synthesize && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Synthesis Agent</label>
                                <select
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                    value={synthesisAgentId}
                                    onChange={(e) => setSynthesisAgentId(Number(e.target.value))}
                                >
                                    {[supervisor, ...delegateCandidates].map((agent) => (
                                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                    {error && <div className="text-sm text-red-600">{error}</div>}
                </div>
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">
                        Close
                    </button>
                    <button
                        onClick={launchDelegation}
                        disabled={isLaunching || !task.trim() || !selectedDelegateIds.length}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 font-medium"
                    >
                        {isLaunching ? 'Launching...' : 'Launch Supervisor'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const AgentActivityModal = ({ agent, onClose, initialExecutionId }: { agent: Agent; onClose: () => void; initialExecutionId?: number | null }) => {
    const [executions, setExecutions] = useState<AgentExecution[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedExecution, setSelectedExecution] = useState<AgentExecution | null>(null);
    const [timeline, setTimeline] = useState<any[]>([]);
    const [delegations, setDelegations] = useState<AgentDelegation[]>([]);

    const loadExecutions = async () => {
        const res = await fetch(`/api/agents/${agent.id}/executions`);
        const data = await safeJson(res);
        if (data) setExecutions(data);
        setLoading(false);
    };

    const loadTimeline = async (execId: number) => {
        const res = await fetch(`/api/agent-executions/${execId}/timeline`);
        const data = await safeJson(res);
        if (data?.execution) setSelectedExecution(data.execution);
        setTimeline(Array.isArray(data?.timeline) ? data.timeline : []);
        setDelegations(Array.isArray(data?.delegations) ? data.delegations : []);
    };

    useEffect(() => {
        loadExecutions();
    }, [agent.id]);

    useEffect(() => {
        if (!initialExecutionId) return;
        void loadTimeline(initialExecutionId);
    }, [initialExecutionId]);

    useEffect(() => {
        if (!selectedExecution) return;
        loadTimeline(selectedExecution.id);
        if (selectedExecution.status !== 'running') return;
        const es = new EventSource(`/api/agent-executions/${selectedExecution.id}/stream`);
        es.addEventListener('update', () => {
            loadExecutions();
            loadTimeline(selectedExecution.id);
        });
        es.addEventListener('done', () => {
            loadExecutions();
            loadTimeline(selectedExecution.id);
            es.close();
        });
        es.onerror = () => es.close();
        return () => es.close();
    }, [selectedExecution?.id, selectedExecution?.status]);

    const cancelExecution = async (id: number) => {
        try {
            const res = await fetch(`/api/agent-executions/${id}/cancel`, { method: 'POST' });
            if (!res.ok) {
                const data = await safeJson(res) as any;
                throw new Error(data?.error || 'Failed to cancel execution');
            }
        } catch (e: any) {
            alert(e.message || 'Failed to cancel execution');
        } finally {
            await loadExecutions();
        }
    };

    const retryExecution = async (id: number) => {
        try {
            const res = await fetch(`/api/agent-executions/${id}/retry`, { method: 'POST' });
            if (!res.ok) {
                const data = await safeJson(res) as any;
                throw new Error(data?.error || 'Failed to retry execution');
            }
        } catch (e: any) {
            alert(e.message || 'Failed to retry execution');
        } finally {
            await loadExecutions();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-[min(96vw,1300px)] max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Activity size={24} className="text-indigo-600" />
                        Activity Log: {agent.name}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6">
                    {loading ? (
                        <div className="text-center py-8 text-slate-500">Loading activity...</div>
                    ) : executions.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                            No execution history found for this agent.
                        </div>
                    ) : selectedExecution ? (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                            <div className="flex items-center gap-4 mb-4">
                                <button 
                                    onClick={() => setSelectedExecution(null)}
                                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1"
                                >
                                    &larr; Back to List
                                </button>
                                <span className="text-slate-400 text-sm">|</span>
                                <span className="text-slate-600 text-sm font-medium">
                                    {new Date(selectedExecution.created_at).toLocaleString()}
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
                                    <div className="font-medium text-slate-900">{selectedExecution.prompt_tokens.toLocaleString()}</div>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <div className="text-xs text-slate-500 mb-1">Completion Tokens</div>
                                    <div className="font-medium text-slate-900">{selectedExecution.completion_tokens.toLocaleString()}</div>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                    <div className="text-xs text-slate-500 mb-1">Total Cost</div>
                                    <div className="font-medium text-emerald-600">${selectedExecution.total_cost.toFixed(6)}</div>
                                </div>
                            </div>
                            <div className="pt-4 border-t border-slate-100">
                                <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Timeline</h5>
                                <div className="space-y-2">
                                    {timeline.map((step: any, idx: number) => (
                                        <div key={`${step.stage}-${idx}`} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                                            <div className="text-slate-700">{step.stage}</div>
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-full ${statusPillClass(step.status)}`}>{step.status}</span>
                                                <span className="font-mono text-slate-500">{step.duration_ms != null ? `${step.duration_ms}ms` : '-'}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {!timeline.length && <div className="text-xs text-slate-500">No timeline steps recorded.</div>}
                                </div>
                            </div>
                            {delegations.length > 0 && (
                                <div className="pt-4 border-t border-slate-100">
                                    <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Delegation Tree</h5>
                                    <div className="space-y-3">
                                        {delegations.map((delegation) => (
                                            <div key={delegation.id} className="rounded-lg border border-slate-200 p-3 bg-slate-50/70">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold text-slate-900">{delegation.title || delegation.agent_name || `Agent ${delegation.agent_id}`}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {delegation.role === 'synthesis' ? 'Synthesis step' : `Delegate agent: ${delegation.agent_name || delegation.agent_id}`}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs ${statusPillClass(delegation.status)}`}>{delegation.status || 'unknown'}</span>
                                                        {delegation.child_execution_id ? (
                                                            <button
                                                                onClick={() => loadTimeline(Number(delegation.child_execution_id))}
                                                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                            >
                                                                Open Child #{delegation.child_execution_id}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                {delegation.task ? (
                                                    <div className="mt-3 text-xs text-slate-700 whitespace-pre-wrap">
                                                        <span className="font-semibold text-slate-600">Task:</span> {delegation.task}
                                                    </div>
                                                ) : null}
                                                {delegation.result ? (
                                                    <div className="mt-3 rounded-lg bg-white border border-slate-200 p-3 text-xs text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                                        {delegation.result}
                                                    </div>
                                                ) : null}
                                                {!delegation.result && delegation.error ? (
                                                    <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 whitespace-pre-wrap">
                                                        {delegation.error}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                <div className="text-xs text-slate-500">Status: <span className="font-semibold text-slate-700">{selectedExecution.status || 'completed'}</span></div>
                                <div className="flex items-center gap-2">
                                    {selectedExecution.status === 'running' && (
                                        <button
                                            onClick={() => cancelExecution(selectedExecution.id)}
                                            className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                                        >
                                            Cancel Execution
                                        </button>
                                    )}
                                    {selectedExecution.status !== 'running' && (
                                        <button
                                            onClick={() => retryExecution(selectedExecution.id)}
                                            className="px-3 py-2 text-xs font-semibold rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                                        >
                                            Retry Execution
                                        </button>
                                    )}
                                    <Link
                                        to={`/agent-executions/${selectedExecution.id}`}
                                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                    >
                                        Open Full Page
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                            <table className="w-full text-sm text-left text-slate-600">
                                <thead className="bg-slate-50 text-slate-700 font-medium">
                                    <tr>
                                        <th className="px-4 py-3">Time</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3 text-right">Prompt Tokens</th>
                                        <th className="px-4 py-3 text-right">Completion Tokens</th>
                                        <th className="px-4 py-3 text-right">Cost</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {executions.map(exec => (
                                        <tr 
                                            key={exec.id} 
                                            className="hover:bg-slate-50 cursor-pointer transition-colors"
                                            onClick={() => loadTimeline(exec.id)}
                                        >
                                            <td className="px-4 py-3 text-slate-900">
                                                {new Date(exec.created_at).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-slate-700">
                                                <div className="flex items-center gap-2">
                                                    <span>{exec.status || 'completed'}</span>
                                                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                                        {executionKindLabel(exec.execution_kind)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {exec.prompt_tokens.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {exec.completion_tokens.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-emerald-600 font-medium">
                                                ${exec.total_cost.toFixed(6)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {exec.status === 'running' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); cancelExecution(exec.id); }}
                                                            className="text-xs font-semibold text-red-600 hover:text-red-700"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                    {exec.status !== 'running' && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); retryExecution(exec.id); }}
                                                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                                                        >
                                                            Retry
                                                        </button>
                                                    )}
                                                    <Link
                                                        to={`/agent-executions/${exec.id}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-xs font-semibold text-slate-600 hover:text-slate-800"
                                                    >
                                                        Open
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 font-semibold text-slate-900">
                                    <tr>
                                        <td className="px-4 py-3">Total</td>
                                        <td className="px-4 py-3 text-right">
                                            {executions.reduce((acc, curr) => acc + curr.prompt_tokens, 0).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {executions.reduce((acc, curr) => acc + curr.completion_tokens, 0).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right text-emerald-600">
                                            ${executions.reduce((acc, curr) => acc + curr.total_cost, 0).toFixed(6)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
                
                <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

const ConnectionModal = ({ agent, onClose }: { agent: Agent; onClose: () => void }) => {
    const [copied, setCopied] = useState(false);
    const origin = window.location.origin;
    const apiUrl = `${origin}/api/agents/${agent.id}/run`;
    const voiceWsUrl = `${origin.replace(/^http/, 'ws')}/ws/voice?targetType=agent&targetId=${agent.id}`;
    
    const curlCommand = `curl -X POST ${apiUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"task": "Your task here", "user_id": "user_123"}'`;

    const mcpConfig = `{
  "mcpServers": {
    "${agent.name.toLowerCase().replace(/\s+/g, '_')}": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse", "--url", "${origin}/mcp/sse"]
    }
  }
}`;
    const mcpCallExample = `{
  "task": "Your task here",
  "user_id": "user_123"
}`;

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl w-[min(96vw,1200px)] max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Globe size={24} className="text-indigo-600" />
                        Connect to {agent.name}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 space-y-8">
                    {/* REST API Section */}
                    <div>
                        <h4 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                            <Terminal size={18} />
                            REST API
                        </h4>
                        <p className="text-sm text-slate-600 mb-3">
                            Execute this agent directly via HTTP POST. Include a stable <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">user_id</code> or reuse <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">session_id</code> to keep memory per user/session.
                        </p>
                        <div className="bg-slate-900 rounded-lg p-4 relative group">
                            <button 
                                onClick={() => copyToClipboard(curlCommand)}
                                className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                                {curlCommand}
                            </pre>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                            <Radio size={18} className="text-cyan-600" />
                            Voice WebSocket
                        </h4>
                        <p className="text-sm text-slate-600 mb-3">
                            Connect a realtime voice client directly to this exposed agent over WebSocket.
                        </p>
                        <div className="bg-slate-900 rounded-lg p-4 relative group">
                            <button 
                                onClick={() => copyToClipboard(voiceWsUrl)}
                                className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                {copied ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                                {voiceWsUrl}
                            </pre>
                        </div>
                    </div>

                    {/* MCP Section */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-indigo-600">
                                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                Model Context Protocol (MCP)
                            </h4>
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">Experimental</span>
                        </div>
                        <p className="text-sm text-slate-600 mb-3">
                            Add this agent as a tool to Claude Desktop or other MCP clients. Send <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">user_id</code> (or reuse <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">session_id</code>) in the tool arguments to keep memory.
                        </p>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                            <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">claude_desktop_config.json</p>
                            <div className="bg-slate-900 rounded-lg p-4 relative group">
                                <button 
                                    onClick={() => copyToClipboard(mcpConfig)}
                                    className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                </button>
                                <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                                    {mcpConfig}
                                </pre>
                            </div>
                            <p className="text-xs text-slate-500 mt-4 mb-2 font-medium uppercase tracking-wide">Tool Call Payload</p>
                            <div className="bg-slate-900 rounded-lg p-4 relative group">
                                <button 
                                    onClick={() => copyToClipboard(mcpCallExample)}
                                    className="absolute top-3 right-3 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                </button>
                                <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                                    {mcpCallExample}
                                </pre>
                            </div>
                            <p className="text-xs text-slate-500 mt-3">
                                Note: This requires a generic SSE-to-Stdio bridge. The URL for this agent's manifest is: <br/>
                                <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">{origin}/mcp/manifest</code>
                            </p>
                        </div>
                    </div>
                </div>
                
                <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

async function safeJson(res: Response) {
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export default function AgentsPage() {
type AgentOptionalConfig =
    | 'agent_role'
    | 'backstory'
    | 'goal'
    | 'system_prompt'
    | 'advanced'
    | 'voice'
    | 'project'
    | 'tools'
    | 'mcp'
    | 'exposure';
  const AGENTS_UI_KEY = 'agents_ui_state_v1';
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigPreset[]>([]);
  const [mcpExposedTools, setMcpExposedTools] = useState<Array<{ tool_id: number; tool_name: string; exposed_name?: string; exposed_description?: string }>>([]);
  const [mcpBundles, setMcpBundles] = useState<Array<{ id: number; name: string; slug: string; description?: string }>>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    agent_role: '',
    goal: '',
    backstory: '',
    system_prompt: '',
    model: 'gemini-1.5-flash',
    provider: 'google',
    temperature: '',
    max_tokens: '',
    memory_window: '',
    max_iterations: '',
    tools_enabled: true,
    retry_policy: 'standard',
    timeout_ms: '',
    is_exposed: false,
    voice_id: 'JBFqnCBsd6RMkjVDRZzb',
    tts_model_id: 'eleven_multilingual_v2',
    stt_model_id: 'scribe_v2_realtime',
    voice_output_format: 'mp3_44100_128',
    voice_sample_rate: '16000',
    voice_language_code: 'en',
    voice_auto_tts: true,
    voice_vad_enabled: true,
    voice_vad_silence_threshold_secs: '0.8',
    voice_vad_threshold: '0.6',
    voice_min_speech_duration_ms: '220',
    voice_min_silence_duration_ms: '420',
    voice_max_tokens_to_recompute: '5',
    voice_browser_noise_suppression: true,
    voice_browser_echo_cancellation: true,
    voice_browser_auto_gain_control: false,
    voice_preset_id: '',
    project_id: '' as string | number,
    toolIds: [] as number[],
    mcp_tool_ids: [] as number[],
    mcp_bundle_ids: [] as number[],
  });

  const [projects, setProjects] = useState<{id: number, name: string}[]>([]);

  const [providers, setProviders] = useState<{id: string, name: string, type: string}[]>([]);
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: '', provider: 'google', api_key: '', api_base: '', is_default: false });
  const [isSavingProvider, setIsSavingProvider] = useState(false);

  const providerTypes = [
    { id: 'google', name: 'Google Gemini' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai-compatible', name: 'OpenAI Compatible (Ollama, vLLM…)' },
  ];

  const [availableModels, setAvailableModels] = useState<{ id: string, name: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAgentSaving, setIsAgentSaving] = useState(false);
  const [agentSaveNotice, setAgentSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [activityAgent, setActivityAgent] = useState<Agent | null>(null);
  const [runAgent, setRunAgent] = useState<Agent | null>(null);
  const [delegateAgent, setDelegateAgent] = useState<Agent | null>(null);
  const [activityExecutionId, setActivityExecutionId] = useState<number | null>(null);
  const formRef = React.useRef<HTMLDivElement | null>(null);
  const [agentsPage, setAgentsPage] = useState(1);
  const [agentsPageSize, setAgentsPageSize] = useState(12);
  const [agentSearch, setAgentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'idle'>('all');
  const [architectureFilter, setArchitectureFilter] = useState<'all' | 'supervisor' | 'specialist'>('all');
  const [sortMode, setSortMode] = useState<'name' | 'activity' | 'cost'>('activity');
  const [agentView, setAgentView] = useState<'grid' | 'list'>('grid');
  const [visibleAgentConfigs, setVisibleAgentConfigs] = useState<AgentOptionalConfig[]>([]);
  const [agentConfigPicker, setAgentConfigPicker] = useState<'' | AgentOptionalConfig>('');
  const requiredAgentConfigs: AgentOptionalConfig[] = ['project', 'exposure'];

  // Auto-Build State
  const [isAutoBuilding, setIsAutoBuilding] = useState(false);
  const [autoBuildGoal, setAutoBuildGoal] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [buildEvents, setBuildEvents] = useState<{message: string, type: 'status' | 'error' | 'done', id?: number}[]>([]);
  const [autoBuildProvider, setAutoBuildProvider] = useState('google');
  const [autoBuildModel, setAutoBuildModel] = useState('gemini-1.5-flash');
  const [autoBuildArchitecture, setAutoBuildArchitecture] = useState<'auto' | 'specialist' | 'supervisor'>('auto');
  const [autoBuildProjectId, setAutoBuildProjectId] = useState('');
  const [stateReady, setStateReady] = useState(false);
  
  const navigate = useNavigate();

  const agentConfigOptions: Array<{ key: AgentOptionalConfig; label: string }> = [
    { key: 'agent_role', label: 'Internal Role' },
    { key: 'backstory', label: 'Backstory' },
    { key: 'goal', label: 'Mission Goal' },
    { key: 'system_prompt', label: 'System Prompt' },
    { key: 'advanced', label: 'Advanced LLM Settings' },
    { key: 'voice', label: 'Voice Runtime' },
    { key: 'tools', label: 'Tools Access' },
    { key: 'mcp', label: 'Direct MCP Connections' },
  ];

  const showAgentConfig = (key: AgentOptionalConfig) => requiredAgentConfigs.includes(key) || visibleAgentConfigs.includes(key);
  const addAgentConfig = (key: AgentOptionalConfig) => {
    setVisibleAgentConfigs((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const removeAgentConfig = (key: AgentOptionalConfig) => {
    if (requiredAgentConfigs.includes(key)) return;
    setVisibleAgentConfigs((prev) => prev.filter((k) => k !== key));
  };

  useEffect(() => {
    const persisted = loadPersisted<any>(AGENTS_UI_KEY, {});
    if (persisted && typeof persisted === 'object') {
      if (persisted.formData) setFormData((prev) => ({ ...prev, ...persisted.formData }));
      if (typeof persisted.agentsPage === 'number') setAgentsPage(persisted.agentsPage);
      if (typeof persisted.agentsPageSize === 'number') setAgentsPageSize(persisted.agentsPageSize);
      if (typeof persisted.agentSearch === 'string') setAgentSearch(persisted.agentSearch);
      if (persisted.statusFilter === 'all' || persisted.statusFilter === 'running' || persisted.statusFilter === 'idle') setStatusFilter(persisted.statusFilter);
      if (persisted.architectureFilter === 'all' || persisted.architectureFilter === 'supervisor' || persisted.architectureFilter === 'specialist') setArchitectureFilter(persisted.architectureFilter);
      if (persisted.sortMode === 'name' || persisted.sortMode === 'activity' || persisted.sortMode === 'cost') setSortMode(persisted.sortMode);
      if (persisted.agentView === 'grid' || persisted.agentView === 'list') setAgentView(persisted.agentView);
      if (typeof persisted.isCreating === 'boolean') setIsCreating(persisted.isCreating);
      if (typeof persisted.editingId === 'number') setEditingId(persisted.editingId);
      if (typeof persisted.autoBuildGoal === 'string') setAutoBuildGoal(persisted.autoBuildGoal);
      if (typeof persisted.autoBuildProvider === 'string') setAutoBuildProvider(persisted.autoBuildProvider);
      if (typeof persisted.autoBuildModel === 'string') setAutoBuildModel(persisted.autoBuildModel);
      if (persisted.autoBuildArchitecture === 'auto' || persisted.autoBuildArchitecture === 'specialist' || persisted.autoBuildArchitecture === 'supervisor') {
        setAutoBuildArchitecture(persisted.autoBuildArchitecture);
      }
      if (typeof persisted.autoBuildProjectId === 'string') setAutoBuildProjectId(persisted.autoBuildProjectId);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    savePersisted(AGENTS_UI_KEY, {
      formData,
      agentsPage,
      agentsPageSize,
      agentSearch,
      statusFilter,
      architectureFilter,
      sortMode,
      agentView,
      isCreating,
      editingId,
      autoBuildGoal,
      autoBuildProvider,
      autoBuildModel,
      autoBuildArchitecture,
      autoBuildProjectId,
    });
  }, [stateReady, formData, agentsPage, agentsPageSize, agentSearch, statusFilter, architectureFilter, sortMode, agentView, isCreating, editingId, autoBuildGoal, autoBuildProvider, autoBuildModel, autoBuildArchitecture, autoBuildProjectId]);

  useEffect(() => {
    fetchAgents();
    fetchTools();
    fetchVoiceConfigs();
    fetchMcpExposedTools();
    fetchMcpBundles();
    fetchProjects();
    fetchProviders();

    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAgentsPage(1);
  }, [agents.length]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = agentSearch.trim().toLowerCase();
    const filtered = agents.filter((agent) => {
      const isRunning = (agent.running_count || 0) > 0 || agent.status === 'running';
      const architecture = agent.agent_role === 'supervisor' ? 'supervisor' : 'specialist';
      const matchesQuery = !normalizedQuery || [
        agent.name,
        agent.role,
        agent.goal,
        agent.backstory,
        agent.system_prompt,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'running' ? isRunning : !isRunning);
      const matchesArchitecture = architectureFilter === 'all' || architecture === architectureFilter;
      return matchesQuery && matchesStatus && matchesArchitecture;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'cost') return (b.stats?.total_cost || 0) - (a.stats?.total_cost || 0);
      const aActivity = (a.running_count || 0) > 0 ? 1000000 + (a.running_count || 0) : ((a.stats?.prompt_tokens || 0) + (a.stats?.completion_tokens || 0));
      const bActivity = (b.running_count || 0) > 0 ? 1000000 + (b.running_count || 0) : ((b.stats?.prompt_tokens || 0) + (b.stats?.completion_tokens || 0));
      return bActivity - aActivity;
    });

    return sorted;
  }, [agents, agentSearch, statusFilter, architectureFilter, sortMode]);

  const pagedAgents = useMemo(() => {
    const start = (agentsPage - 1) * agentsPageSize;
    return filteredAgents.slice(start, start + agentsPageSize);
  }, [filteredAgents, agentsPage, agentsPageSize]);

  const agentInsights = useMemo(() => {
    const running = agents.filter((a) => (a.running_count || 0) > 0 || a.status === 'running').length;
    const exposed = agents.filter((a) => a.is_exposed).length;
    const totalCost = agents.reduce((sum, a) => sum + (a.stats?.total_cost || 0), 0);
    const totalTokens = agents.reduce((sum, a) => {
      const st = a.stats;
      return sum + ((st?.prompt_tokens || 0) + (st?.completion_tokens || 0));
    }, 0);
    return {
      running,
      exposed,
      totalCost,
      totalTokens,
      utilization: agents.length ? Math.round((running / agents.length) * 100) : 0,
    };
  }, [agents]);

  const fetchModelsForProvider = async (providerId: string, isAutoBuild: boolean = false) => {
    setIsLoadingModels(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/models`);
      let models: { id: string, name: string }[] = [];

      if (res.ok) {
        const fetchedModels = await safeJson(res);
        if (Array.isArray(fetchedModels)) {
          models = fetchedModels;
        }
      }

      // NO HARDCODED FALLBACKS HERE - let the backend handle it or show empty
      if (models.length === 0) {
        console.warn("No models returned from provider fetching.");
      }

      setAvailableModels(models);

      // Auto-select first model if current is invalid
      if (models.length > 0) {
        if (isAutoBuild) {
          if (!models.find(m => m.id === autoBuildModel)) {
            setAutoBuildModel(models[0].id);
          }
        } else {
          if (!models.find(m => m.id === formData.model)) {
            setFormData(prev => ({ ...prev, model: models[0]?.id || '' }));
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Fetch models when provider changes
  useEffect(() => {
      if (isCreating || editingId) {
          fetchModelsForProvider(formData.provider, false);
      }
  }, [formData.provider, isCreating, editingId]);

  useEffect(() => {
      if (isAutoBuilding) {
          if (providers.length && !providers.some((p: any) => p.id === autoBuildProvider)) {
            setAutoBuildProvider(providers[0].id);
            return;
          }
          fetchModelsForProvider(autoBuildProvider, true);
      }
  }, [autoBuildProvider, isAutoBuilding, providers]);

  const autoBuildAgent = async () => {
      if (!autoBuildGoal) return;
      setIsBuilding(true);
      setBuildError('');
      setBuildEvents([]);

      try {
          const response = await fetch('/api/agents/autobuild', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  goal: autoBuildGoal,
                  project_id: autoBuildProjectId || null,
                  provider: autoBuildProvider,
                  model: autoBuildModel,
                  agent_role_preference: autoBuildArchitecture,
                  stream: true
              })
          });

          if (!response.ok) {
              let errorMessage = `Server error: ${response.status} ${response.statusText}`;
              try {
                  const contentType = response.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                      const data = await response.json();
                      errorMessage = data.error || errorMessage;
                  } else {
                      const text = await response.text();
                      if (text && text.length < 200) errorMessage = text;
                  }
              } catch (parseError) {
                  console.error("Failed to parse error response", parseError);
              }
              throw new Error(errorMessage);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          while (true) {
              const { done, value } = await reader!.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                  if (line.startsWith('data: ')) {
                      try {
                          const event = JSON.parse(line.slice(6));
                          setBuildEvents(prev => [...prev, event]);

                          if (event.type === 'done') {
                              setTimeout(() => {
                                  setIsAutoBuilding(false);
                                  setIsBuilding(false);
                                  fetchAgents();
                              }, 1500);
                          } else if (event.type === 'error') {
                              setBuildError(event.message);
                              setIsBuilding(false);
                          }
                      } catch (e) {
                          console.error("Failed to parse event", e);
                      }
                  }
              }
          }
      } catch (e: any) {
          setBuildError(e.message);
          setIsBuilding(false);
      }
  };

  const fetchProviders = () => {
    fetch('/api/providers')
      .then(res => safeJson(res))
      .then(data => {
        if (!data) return;
        // Only show providers that are actually saved in the DB
        const dbProviders = data.map((p: any) => ({ id: p.name, name: p.name, type: p.provider }));
        setProviders(dbProviders);
        // Reset selected provider if it no longer exists
        if (dbProviders.length > 0 && !dbProviders.find((p: any) => p.id === formData.provider)) {
          setFormData(prev => ({ ...prev, provider: dbProviders[0].id }));
        }
        // Keep Auto-Build provider in sync with real provider entries.
        if (dbProviders.length > 0) {
          setAutoBuildProvider((prev) => (dbProviders.some((p: any) => p.id === prev) ? prev : dbProviders[0].id));
        }
      })
      .catch(() => setProviders([]));
  };

  const saveQuickProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProvider(true);
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newProvider, is_default: true })
      });
      if (!res.ok) throw new Error('Failed to save');
      setIsAddingProvider(false);
      setNewProvider({ name: '', provider: 'google', api_key: '', api_base: '', is_default: false });
      await fetchProviders();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsSavingProvider(false);
    }
  };

  const fetchAgents = () => {
    fetch('/api/agents')
      .then(res => res.json())
      .then(setAgents);
  };

  const fetchTools = () => {
    fetch('/api/tools')
      .then(res => res.json())
      .then(setTools);
  };

  const fetchVoiceConfigs = async () => {
    try {
      const res = await fetch('/api/voice/configs');
      const data = await safeJson(res);
      setVoiceConfigs(Array.isArray(data) ? data : []);
    } catch {
      setVoiceConfigs([]);
    }
  };

  const fetchMcpExposedTools = () => {
    fetch('/api/mcp/exposed-tools')
      .then(res => safeJson(res))
      .then((data) => {
        const list = Array.isArray(data) ? data.filter((x: any) => !!x.exposed_name) : [];
        setMcpExposedTools(list);
      });
  };

  const fetchMcpBundles = () => {
    fetch('/api/mcp/bundles')
      .then(res => safeJson(res))
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setMcpBundles(list);
      });
  };

  const fetchProjects = () => {
    fetch('/api/projects')
      .then(res => res.json())
      .then(setProjects);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentSaveNotice(null);
    setIsAgentSaving(true);

    // Project is optional when editing an existing agent; required when creating.
    const normalizedProjectId = formData.project_id === '' || formData.project_id == null ? null : Number(formData.project_id);
    if (!editingId && (!Number.isFinite(normalizedProjectId as any) || (normalizedProjectId as number) <= 0)) {
      setAgentSaveNotice({ type: 'error', message: 'Project link is required. Please select a project.' });
      setIsAgentSaving(false);
      return;
    }
    
    const url = editingId ? `/api/agents/${editingId}` : '/api/agents';
    const method = editingId ? 'PUT' : 'POST';
    const normalizedGoal = String(formData.goal || '').trim() || `Act as ${formData.role || 'AI Specialist'} and complete assigned tasks with clear, reliable outputs.`;
    const normalizedBackstory = String(formData.backstory || '').trim();

    const payload = {
      ...formData,
      goal: normalizedGoal,
      backstory: normalizedBackstory,
      temperature: formData.temperature === '' ? null : Number(formData.temperature),
      max_tokens: formData.max_tokens === '' ? null : Number(formData.max_tokens),
      memory_window: formData.memory_window === '' ? null : Number(formData.memory_window),
      max_iterations: formData.max_iterations === '' ? null : Number(formData.max_iterations),
      timeout_ms: formData.timeout_ms === '' ? null : Number(formData.timeout_ms),
      mcp_tool_ids: formData.mcp_tool_ids,
      mcp_bundle_ids: formData.mcp_bundle_ids,
      project_id: normalizedProjectId,
    };

    try {
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await safeJson(res) as any;
        throw new Error(data?.error || 'Failed to save agent');
      }
      const savedAgent = await safeJson(res) as any;
      const savedAgentId = Number(savedAgent?.id || editingId);
      if (Number.isFinite(savedAgentId) && savedAgentId > 0) {
        const voiceRes = await fetch(`/api/voice/agents/${savedAgentId}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voice_id: formData.voice_id,
            tts_model_id: formData.tts_model_id,
            stt_model_id: formData.stt_model_id,
            output_format: formData.voice_output_format,
            sample_rate: Number(formData.voice_sample_rate || 16000),
            language_code: formData.voice_language_code,
            auto_tts: Boolean(formData.voice_auto_tts),
            meta: {
              preset_id: formData.voice_preset_id ? Number(formData.voice_preset_id) : null,
              vad_enabled: Boolean(formData.voice_vad_enabled),
              vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
              vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
              min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
              min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
              max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
              browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
              browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
              browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
            },
          }),
        });
        if (!voiceRes.ok) {
          const data = await safeJson(voiceRes) as any;
          throw new Error(data?.error || 'Agent saved, but voice profile failed to save');
        }
      }
      setAgentSaveNotice({ type: 'success', message: editingId ? 'Agent updated successfully.' : 'Agent created successfully.' });
      fetchAgents();
      setTimeout(() => {
        setAgentSaveNotice(null);
        resetForm();
      }, 700);
    } catch (e: any) {
      setAgentSaveNotice({ type: 'error', message: e.message || 'Failed to save agent' });
    } finally {
      setIsAgentSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      role: '',
      agent_role: '',
      goal: '',
      backstory: '',
      system_prompt: '',
      model: '',
      provider: providers.length > 0 ? providers[0].id : '',
      temperature: '',
      max_tokens: '',
      memory_window: '',
      max_iterations: '',
      tools_enabled: true,
      retry_policy: 'standard',
      timeout_ms: '',
      is_exposed: false,
      voice_id: 'JBFqnCBsd6RMkjVDRZzb',
      tts_model_id: 'eleven_multilingual_v2',
      stt_model_id: 'scribe_v2_realtime',
      voice_output_format: 'mp3_44100_128',
      voice_sample_rate: '16000',
      voice_language_code: 'en',
      voice_auto_tts: true,
      voice_vad_enabled: true,
      voice_vad_silence_threshold_secs: '0.8',
      voice_vad_threshold: '0.6',
      voice_min_speech_duration_ms: '220',
      voice_min_silence_duration_ms: '420',
      voice_max_tokens_to_recompute: '5',
      voice_browser_noise_suppression: true,
      voice_browser_echo_cancellation: true,
      voice_browser_auto_gain_control: false,
      voice_preset_id: '',
      project_id: '',
      toolIds: [],
      mcp_tool_ids: [],
      mcp_bundle_ids: [],
    });
    setIsCreating(false);
    setEditingId(null);
    setVisibleAgentConfigs([]);
    setAgentConfigPicker('');
  };

  const startCreateAgent = () => {
    resetForm();
    setIsCreating(true);
  };

  const startEdit = async (agent: Agent) => {
      const initialConfigs: AgentOptionalConfig[] = [];
      if (agent.agent_role) initialConfigs.push('agent_role');
      if (agent.backstory) initialConfigs.push('backstory');
      if (agent.goal) initialConfigs.push('goal');
      if (agent.system_prompt) initialConfigs.push('system_prompt');
      if (agent.temperature != null || agent.max_tokens != null || agent.memory_window != null || agent.max_iterations != null || agent.timeout_ms != null || agent.retry_policy) initialConfigs.push('advanced');
      initialConfigs.push('voice');
      if (agent.project_id) initialConfigs.push('project');
      if ((agent.tools || []).length > 0) initialConfigs.push('tools');
      if ((agent.mcp_tool_ids || []).length > 0 || (agent.mcp_bundle_ids || []).length > 0) initialConfigs.push('mcp');
      if (agent.is_exposed) initialConfigs.push('exposure');

      let voiceProfile: any = null;
      try {
        const res = await fetch(`/api/voice/agents/${agent.id}/profile`);
        voiceProfile = res.ok ? await safeJson(res) : null;
      } catch {
        voiceProfile = null;
      }

      setFormData({
          name: agent.name,
          role: agent.role,
          agent_role: agent.agent_role || '',
          goal: agent.goal,
          backstory: agent.backstory || '',
          system_prompt: agent.system_prompt || '',
          model: agent.model,
          provider: agent.provider || 'google',
          temperature: agent.temperature ?? '',
          max_tokens: agent.max_tokens ?? '',
          memory_window: agent.memory_window ?? '',
          max_iterations: agent.max_iterations ?? '',
          tools_enabled: agent.tools_enabled !== 0 && agent.tools_enabled !== false,
          retry_policy: agent.retry_policy || 'standard',
          timeout_ms: agent.timeout_ms ?? '',
          is_exposed: agent.is_exposed || false,
          voice_id: String(voiceProfile?.voice_id || 'JBFqnCBsd6RMkjVDRZzb'),
          tts_model_id: String(voiceProfile?.tts_model_id || 'eleven_multilingual_v2'),
          stt_model_id: String(voiceProfile?.stt_model_id || 'scribe_v2_realtime'),
          voice_output_format: String(voiceProfile?.output_format || 'mp3_44100_128'),
          voice_sample_rate: String(voiceProfile?.sample_rate || 16000),
          voice_language_code: String(voiceProfile?.language_code || 'en'),
          voice_auto_tts: Boolean(voiceProfile?.auto_tts ?? true),
          voice_vad_enabled: Boolean(voiceProfile?.meta?.vad_enabled ?? true),
          voice_vad_silence_threshold_secs: String(voiceProfile?.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
          voice_vad_threshold: String(voiceProfile?.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD),
          voice_min_speech_duration_ms: String(voiceProfile?.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS),
          voice_min_silence_duration_ms: String(voiceProfile?.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS),
          voice_max_tokens_to_recompute: String(voiceProfile?.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
          voice_browser_noise_suppression: Boolean(voiceProfile?.meta?.browser_noise_suppression ?? true),
          voice_browser_echo_cancellation: Boolean(voiceProfile?.meta?.browser_echo_cancellation ?? true),
          voice_browser_auto_gain_control: Boolean(voiceProfile?.meta?.browser_auto_gain_control ?? false),
          voice_preset_id: String(voiceProfile?.meta?.preset_id || ''),
          project_id: agent.project_id || '',
          toolIds: agent.tools ? agent.tools.map(t => t.id) : [],
          mcp_tool_ids: Array.isArray(agent.mcp_tool_ids) ? agent.mcp_tool_ids : [],
          mcp_bundle_ids: Array.isArray(agent.mcp_bundle_ids) ? agent.mcp_bundle_ids : [],
      });
      setVisibleAgentConfigs(initialConfigs);
      setAgentConfigPicker('');
      setEditingId(agent.id);
      setIsCreating(true);
      requestAnimationFrame(() => {
        if (formRef.current) {
          formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
  };

  const deleteAgent = async (id: number) => {
    try {
        const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete agent');
        }
        fetchAgents();
    } catch (e: any) {
        alert(e.message);
    }
  };

  const toggleTool = (toolId: number) => {
    setFormData(prev => {
        const newToolIds = prev.toolIds.includes(toolId)
            ? prev.toolIds.filter(id => id !== toolId)
            : [...prev.toolIds, toolId];
        return { ...prev, toolIds: newToolIds };
    });
  };

  const toggleMcpTool = (toolId: number) => {
    setFormData(prev => {
      const next = prev.mcp_tool_ids.includes(toolId)
        ? prev.mcp_tool_ids.filter(id => id !== toolId)
        : [...prev.mcp_tool_ids, toolId];
      return { ...prev, mcp_tool_ids: next };
    });
  };

  const toggleMcpBundle = (bundleId: number) => {
    setFormData(prev => {
      const next = prev.mcp_bundle_ids.includes(bundleId)
        ? prev.mcp_bundle_ids.filter(id => id !== bundleId)
        : [...prev.mcp_bundle_ids, bundleId];
      return { ...prev, mcp_bundle_ids: next };
    });
  };

  const applyVoicePreset = (presetId: string) => {
    const preset = voiceConfigs.find((item) => String(item.id) === String(presetId));
    if (!preset) {
      setFormData((prev) => ({ ...prev, voice_preset_id: '' }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      voice_preset_id: presetId,
      voice_id: String(preset.voice_id || 'JBFqnCBsd6RMkjVDRZzb'),
      tts_model_id: String(preset.tts_model_id || 'eleven_multilingual_v2'),
      stt_model_id: String(preset.stt_model_id || 'scribe_v2_realtime'),
      voice_output_format: String(preset.output_format || 'mp3_44100_128'),
      voice_sample_rate: String(preset.sample_rate || 16000),
      voice_language_code: String(preset.language_code || 'en'),
      voice_auto_tts: Boolean(preset.auto_tts ?? true),
      voice_vad_enabled: Boolean(preset.meta?.vad_enabled ?? true),
      voice_vad_silence_threshold_secs: String(preset.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
      voice_vad_threshold: String(preset.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD),
      voice_min_speech_duration_ms: String(preset.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS),
      voice_min_silence_duration_ms: String(preset.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS),
      voice_max_tokens_to_recompute: String(preset.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
      voice_browser_noise_suppression: Boolean(preset.meta?.browser_noise_suppression ?? true),
      voice_browser_echo_cancellation: Boolean(preset.meta?.browser_echo_cancellation ?? true),
      voice_browser_auto_gain_control: Boolean(preset.meta?.browser_auto_gain_control ?? false),
    }));
  };

  const saveCurrentVoicePreset = async () => {
    const name = window.prompt('Voice preset name');
    if (!name?.trim()) return;
    const res = await fetch('/api/voice/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        voice_id: formData.voice_id,
        tts_model_id: formData.tts_model_id,
        stt_model_id: formData.stt_model_id,
        output_format: formData.voice_output_format,
        sample_rate: Number(formData.voice_sample_rate || 16000),
        language_code: formData.voice_language_code,
        auto_tts: Boolean(formData.voice_auto_tts),
        meta: {
          vad_enabled: Boolean(formData.voice_vad_enabled),
          vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
          vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
          min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
          min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
          max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
          browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
          browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
          browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
        },
      }),
    });
    const data = await safeJson(res) as any;
    if (!res.ok) {
      setAgentSaveNotice({ type: 'error', message: data?.error || 'Failed to save voice preset' });
      return;
    }
    await fetchVoiceConfigs();
    setFormData((prev) => ({ ...prev, voice_preset_id: String(data?.id || '') }));
  };

  const updateSelectedVoicePreset = async () => {
    if (!formData.voice_preset_id) return;
    const preset = voiceConfigs.find((item) => String(item.id) === String(formData.voice_preset_id));
    if (!preset) return;
    const res = await fetch(`/api/voice/configs/${formData.voice_preset_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: preset.name,
        voice_id: formData.voice_id,
        tts_model_id: formData.tts_model_id,
        stt_model_id: formData.stt_model_id,
        output_format: formData.voice_output_format,
        sample_rate: Number(formData.voice_sample_rate || 16000),
        language_code: formData.voice_language_code,
        auto_tts: Boolean(formData.voice_auto_tts),
        meta: {
          vad_enabled: Boolean(formData.voice_vad_enabled),
          vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
          vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
          min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
          min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
          max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
          browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
          browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
          browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
        },
        notes: preset.notes || '',
      }),
    });
    const data = await safeJson(res) as any;
    if (!res.ok) {
      setAgentSaveNotice({ type: 'error', message: data?.error || 'Failed to update voice preset' });
      return;
    }
    await fetchVoiceConfigs();
  };

  const deleteSelectedVoicePreset = async () => {
    if (!formData.voice_preset_id || !window.confirm('Delete this voice preset?')) return;
    await fetch(`/api/voice/configs/${formData.voice_preset_id}`, { method: 'DELETE' });
    await fetchVoiceConfigs();
    setFormData((prev) => ({ ...prev, voice_preset_id: '' }));
  };

  const supervisorCount = useMemo(() => agents.filter((agent) => agent.agent_role === 'supervisor').length, [agents]);
  const specialistCount = useMemo(() => agents.filter((agent) => agent.agent_role !== 'supervisor').length, [agents]);
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="mb-8 panel-chrome rounded-3xl p-6 border border-slate-200 relative overflow-hidden"
      >
        <div className="absolute -top-20 right-0 w-80 h-80 bg-gradient-to-br from-indigo-200/30 to-cyan-200/30 blur-3xl pointer-events-none" />
        <div className="flex justify-between items-start gap-4 relative z-10">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Agent Command Grid</h1>
            <p className="text-slate-500 mt-2">Build specialists, run missions, and monitor live intelligence flow.</p>
          </div>
          <div className="flex gap-3">
            <button 
                onClick={() => setIsAutoBuilding(true)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors shadow-sm"
            >
                <Sparkles size={18} />
                Auto-Build Agent
            </button>
            <button 
            onClick={startCreateAgent}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors"
            >
            <Plus size={18} />
            New Agent
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-6 relative z-10">
          {[
            { label: 'Total Agents', value: agents.length.toString(), icon: User, tone: 'text-indigo-700 bg-indigo-100' },
            { label: 'Running Now', value: agentInsights.running.toString(), icon: Activity, tone: 'text-amber-700 bg-amber-100' },
            { label: 'Supervisors', value: supervisorCount.toString(), icon: Sparkles, tone: 'text-violet-700 bg-violet-100' },
            { label: 'Specialists', value: specialistCount.toString(), icon: Gauge, tone: 'text-cyan-700 bg-cyan-100' },
          ].map((kpi, idx) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + idx * 0.05 }}
              className="rounded-2xl border border-white/60 bg-white/80 backdrop-blur p-4"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{kpi.label}</div>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${kpi.tone}`}>
                  <kpi.icon size={14} />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-900 mt-2">{kpi.value}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <div className="mb-6 rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm backdrop-blur">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.7fr))_auto]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Search by name, role, goal, backstory, or prompt..."
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'running' | 'idle')}
          >
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="idle">Idle</option>
          </select>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={architectureFilter}
            onChange={(e) => setArchitectureFilter(e.target.value as 'all' | 'supervisor' | 'specialist')}
          >
            <option value="all">All Architectures</option>
            <option value="supervisor">Supervisors</option>
            <option value="specialist">Specialists</option>
          </select>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'name' | 'activity' | 'cost')}
          >
            <option value="activity">Sort: Activity</option>
            <option value="name">Sort: Name</option>
            <option value="cost">Sort: Cost</option>
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            <ArrowUpDown size={14} className="text-slate-400" />
            {filteredAgents.length} visible
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setAgentView('grid')}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${agentView === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => setAgentView('list')}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${agentView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-3xl border border-indigo-200 bg-linear-to-r from-indigo-50 via-white to-cyan-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-indigo-500">Coordinator Pattern</div>
            <h3 className="mt-2 text-xl font-black text-slate-900">Set up one coordinator, many specialists.</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Use a supervisor agent to plan, delegate, and synthesize. Keep domain tools and MCP bundles attached to specialist agents so each delegate can execute with its own capabilities.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:w-[640px]">
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Coordinator Agent</div>
              <div className="mt-2 text-sm text-slate-700">Mark as `supervisor`, attach `delegate_to_agent`, keep it orchestration-focused.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Specialist Agents</div>
              <div className="mt-2 text-sm text-slate-700">Attach HTTP tools, local tools, and MCP bundles directly to the specialists that actually use them.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Execution View</div>
              <div className="mt-2 text-sm text-slate-700">Delegation chains now show parent, current, and child executions so you can trace handoffs cleanly.</div>
            </div>
          </div>
        </div>
      </div>

      {isAutoBuilding && (
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
            onClick={() => !isBuilding && setIsAutoBuilding(false)}
          >
              <div 
                className="bg-white rounded-2xl shadow-2xl w-[min(94vw,980px)] overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-purple-50/50">
                      <h3 className="text-lg font-bold text-purple-900 flex items-center gap-2">
                          <Sparkles size={20} className="text-purple-600" />
                          Auto-Build Agent with AI
                      </h3>
                      <button 
                        onClick={() => !isBuilding && setIsAutoBuilding(false)} 
                        className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                        disabled={isBuilding}
                      >
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto">
                      <p className="text-slate-600 mb-4 text-sm">
                          Describe the agent you need, and the AI Architect will choose or honor a supervisor/specialist architecture, then design the role, goal, and system prompt.
                      </p>
                      
                      <div className="mb-4">
                          <label className="block text-sm font-medium text-slate-700 mb-1">Agent's Purpose</label>
                          <textarea
                              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none h-32 resize-none"
                              placeholder="e.g. A senior technical writer that specializes in creating clear API documentation for various programming languages."
                              value={autoBuildGoal}
                              onChange={(e) => setAutoBuildGoal(e.target.value)}
                              disabled={isBuilding}
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                            <select
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                                value={autoBuildProvider}
                                onChange={(e) => {
                                    const newProviderId = e.target.value;
                                    setAutoBuildProvider(newProviderId);
                                }}
                                disabled={isBuilding}
                            >
                                {providers.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
                            <select
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                                value={autoBuildModel}
                                onChange={(e) => setAutoBuildModel(e.target.value)}
                                disabled={isBuilding || isLoadingModels}
                            >
                                {isLoadingModels ? (
                                    <option value="">Loading models...</option>
                                ) : (
                                    availableModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))
                                )}
                            </select>
                        </div>
                      </div>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Architecture</label>
                        <select
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                            value={autoBuildArchitecture}
                            onChange={(e) => setAutoBuildArchitecture(e.target.value as 'auto' | 'specialist' | 'supervisor')}
                            disabled={isBuilding}
                        >
                            <option value="auto">Auto Decide</option>
                            <option value="specialist">Specialist</option>
                            <option value="supervisor">Supervisor</option>
                        </select>
                        <p className="text-xs text-slate-500 mt-1">
                          Supervisor agents coordinate delegates and synthesize outputs. Specialist agents execute focused work directly.
                        </p>
                      </div>

                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Project (Optional)</label>
                        <select
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                            value={autoBuildProjectId}
                            onChange={(e) => setAutoBuildProjectId(e.target.value)}
                            disabled={isBuilding}
                        >
                            <option value="">No Project</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                      {buildEvents.length > 0 && (
                        <div className="mb-6 space-y-3">
                            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2">
                                <Activity size={12} /> Design Stream
                            </div>
                            <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs space-y-2 max-h-48 overflow-y-auto">
                                <AnimatePresence mode='popLayout'>
                                    {buildEvents.map((event, i) => (
                                        <motion.div 
                                            key={i}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className={`${event.type === 'error' ? 'text-red-400' : event.type === 'done' ? 'text-emerald-400' : 'text-slate-300'} flex items-start gap-2`}
                                        >
                                            <span className="text-slate-500 shrink-0">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                                            <span>
                                                {event.message}
                                                {event.agent && <span className="ml-2 px-1.5 py-0.5 bg-slate-800 rounded text-purple-300 font-bold border border-slate-700">{event.agent}</span>}
                                            </span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div id="stream-end" />
                            </div>
                        </div>
                      )}

                      {buildError && (
                          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
                              {buildError}
                          </div>
                      )}

                      <div className="flex justify-end gap-3 mt-4">
                          <button
                              onClick={() => {
                                  setIsAutoBuilding(false);
                                  setBuildEvents([]);
                              }}
                              className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
                              disabled={isBuilding}
                          >
                              Cancel
                          </button>
                          <button
                              onClick={autoBuildAgent}
                              disabled={isBuilding || !autoBuildGoal.trim()}
                              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow-md transition-all active:scale-95 flex items-center gap-2"
                          >
                              {isBuilding ? (
                                  <>
                                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                      Architecting...
                                  </>
                              ) : 'Start Build'}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {isCreating && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
          onClick={resetForm}
        >
          <div 
            className="bg-white w-[min(96vw,1500px)] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
            ref={formRef}
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <h3 className="text-xl font-bold text-slate-900">
                {editingId ? 'Edit AI Specialist' : 'Create New Agent'}
              </h3>
              <button 
                onClick={resetForm} 
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto custom-scrollbar">
              <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-linear-to-br from-slate-50 to-white p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-500">Agent Blueprint</div>
                  <h4 className="mt-2 text-2xl font-black text-slate-900">Build around mission first, personality second.</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Name, role, goal, provider, and project are the core. Use backstory only when it improves judgment or tone. Supervisor agents should stay operational and delegation-focused, not fictional.
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                    Keep the primary setup visible. Open voice, MCP, and exposure only when that agent actually needs them.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[480px]">
                  {[
                    { key: '', label: 'Adaptive', hint: 'Let runtime behavior define the shape.' },
                    { key: 'specialist', label: 'Specialist', hint: 'Focused execution and domain work.' },
                    { key: 'supervisor', label: 'Supervisor', hint: 'Delegates, coordinates, synthesizes.' },
                  ].map((option) => {
                    const selected = formData.agent_role === option.key;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setFormData({ ...formData, agent_role: option.key })}
                        className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                          selected
                            ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">{option.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-600">Architecture Guidance</div>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
                  <div className="text-sm font-semibold text-slate-900">Supervisor</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    Best when this agent should route work, call `delegate_to_agent`, and synthesize outcomes instead of owning all MCPs directly.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
                  <div className="text-sm font-semibold text-slate-900">Specialist</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    Best when this agent should own the actual tools or MCP bundles for one domain and return focused outputs to a coordinator or crew.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
                  <div className="text-sm font-semibold text-slate-900">Recommended Split</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    Coordinators orchestrate. Specialists execute. Put shared business logic in prompts and keep domain integrations close to the specialist that needs them.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. Research Analyst"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.role}
                  onChange={e => setFormData({...formData, role: e.target.value})}
                  placeholder="e.g. Senior Researcher"
                />
              </div>
            </div>

            {showAgentConfig('goal') && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <label className="block text-sm font-medium text-slate-700">Goal</label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Optional</span>
                </div>
                <textarea
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                  value={formData.goal}
                  onChange={e => setFormData({...formData, goal: e.target.value})}
                  placeholder="What is this agent trying to achieve?"
                />
                <p className="text-xs text-slate-500 mt-1">
                  The behavioral objective for this agent. Optional—if omitted, we build one from the name and role.
                </p>
              </div>
            )}

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Add Configuration</label>
                <select
                  className="ui-select !py-1.5 !text-xs min-w-[210px]"
                  value={agentConfigPicker}
                  onChange={(e) => {
                    const key = e.target.value as AgentOptionalConfig;
                    if (!key) return;
                    addAgentConfig(key);
                    setAgentConfigPicker('');
                  }}
                >
                  <option value="">Choose optional field...</option>
                  {agentConfigOptions
                    .filter((opt) => !visibleAgentConfigs.includes(opt.key))
                    .map((opt) => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                </select>
              </div>
              {visibleAgentConfigs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {visibleAgentConfigs.map((key) => (
                    <span key={key} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-slate-200 rounded-full text-slate-700">
                      {agentConfigOptions.find((o) => o.key === key)?.label || key}
                      <button type="button" onClick={() => removeAgentConfig(key)} className="text-slate-400 hover:text-red-500">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {showAgentConfig('agent_role') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Agent Architecture</label>
                <select
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  value={formData.agent_role}
                  onChange={e => setFormData({...formData, agent_role: e.target.value})}
                >
                  <option value="">Unspecified</option>
                  <option value="specialist">Specialist</option>
                  <option value="supervisor">Supervisor</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Use `supervisor` for agents that coordinate delegated work. Use `specialist` for focused task execution.
                </p>
              </div>
            )}

            {showAgentConfig('backstory') && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <label className="block text-sm font-medium text-slate-700">Backstory</label>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Optional</span>
                </div>
                <textarea
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                  value={formData.backstory}
                  onChange={e => setFormData({...formData, backstory: e.target.value})}
                  placeholder="Optional operating context. Keep it short and practical, like domain background or decision style."
                />
                <p className="text-xs text-slate-500 mt-1">
                  Skip this unless you want a consistent tone, domain bias, or operating style. Avoid long fictional biographies.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-3 mb-1">
                <label className="block text-sm font-medium text-slate-700">System Prompt</label>
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Optional Override</span>
              </div>
              <textarea
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28"
                value={formData.system_prompt}
                onChange={e => setFormData({...formData, system_prompt: e.target.value})}
                placeholder="Optional. If empty, a default prompt is built from name/role and safe defaults."
              />
              <p className="text-xs text-slate-500 mt-1">
                Only write a custom prompt when you need tighter behavioral control than role + goal already provide.
              </p>
            </div>

            <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Brain size={16} className="text-brand-500" />
                  LLM Configuration
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingProvider(true)}
                  className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 font-bold px-2 py-1 rounded-lg hover:bg-brand-50 transition-colors"
                >
                  <Plus size={12} /> Add Provider
                </button>
              </div>

              {/* Quick-add provider popup */}
              <AnimatePresence>
                {isAddingProvider && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="border border-brand-200 bg-white rounded-xl p-4 shadow-lg space-y-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-brand-700 uppercase tracking-widest">New LLM Provider</span>
                      <button type="button" onClick={() => setIsAddingProvider(false)} className="text-slate-400 hover:text-slate-600">
                        <X size={16} />
                      </button>
                    </div>
                    <form onSubmit={saveQuickProvider} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Display Name</label>
                          <input
                            required
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                            placeholder="e.g. My Google Key"
                            value={newProvider.name}
                            onChange={e => setNewProvider({...newProvider, name: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Provider Type</label>
                          <select
                            required
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                            value={newProvider.provider}
                            onChange={e => setNewProvider({...newProvider, provider: e.target.value})}
                          >
                            {providerTypes.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">API Key</label>
                        <div className="relative">
                          <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            required
                            type="password"
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none"
                            placeholder="sk-... or AIza..."
                            value={newProvider.api_key}
                            onChange={e => setNewProvider({...newProvider, api_key: e.target.value})}
                          />
                        </div>
                      </div>
                      {(newProvider.provider === 'openai-compatible') && (
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">API Base URL</label>
                          <input
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none"
                            placeholder="http://localhost:11434/v1"
                            value={newProvider.api_base}
                            onChange={e => setNewProvider({...newProvider, api_base: e.target.value})}
                          />
                        </div>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => setIsAddingProvider(false)} className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 font-medium">Cancel</button>
                        <button
                          type="submit"
                          disabled={isSavingProvider}
                          className="text-xs px-4 py-1.5 premium-gradient text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-60"
                        >
                          {isSavingProvider ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Save & Select
                        </button>
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Step 1: Provider */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  1 · LLM Provider
                </label>
                {providers.length === 0 ? (
                  <div className="border border-dashed border-slate-300 rounded-lg p-4 text-center">
                    <p className="text-xs text-slate-500 mb-2">No LLM providers configured yet.</p>
                    <button
                      type="button"
                      onClick={() => setIsAddingProvider(true)}
                      className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1 mx-auto"
                    >
                      <Plus size={12} /> Add your first provider
                    </button>
                  </div>
                ) : (
                  <select
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none bg-white text-sm"
                    value={formData.provider}
                    onChange={e => {
                      setFormData({ ...formData, provider: e.target.value, model: '' });
                    }}
                  >
                    <option value="" disabled>Select a provider...</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Step 2: Credential note */}
              {formData.provider && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    2 · Credential
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white">
                    <Key size={13} className="text-emerald-500 shrink-0" />
                    <span className="text-xs text-slate-500">
                      API key is taken from the selected provider configuration.{' '}
                      <Link to="/providers" className="text-brand-600 hover:underline font-medium">
                        Edit in LLM Providers
                      </Link>
                    </span>
                  </div>
                </div>
              )}

              {/* Step 3: Model */}
              {formData.provider && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    3 · Model
                  </label>
                  <select
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none bg-white text-sm disabled:opacity-60"
                    value={formData.model}
                    onChange={e => setFormData({ ...formData, model: e.target.value })}
                    disabled={isLoadingModels || !formData.provider}
                  >
                    {isLoadingModels ? (
                      <option value="">Loading models...</option>
                    ) : availableModels.length === 0 ? (
                      <option value="">No models found — check provider credentials</option>
                    ) : (
                      availableModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>

            {showAgentConfig('advanced') && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Advanced Config</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Temperature (Optional)</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.temperature}
                    onChange={e => setFormData({...formData, temperature: e.target.value})}
                    placeholder="e.g. 0.7"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Max Tokens (Optional)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.max_tokens}
                    onChange={e => setFormData({...formData, max_tokens: e.target.value})}
                    placeholder="e.g. 1024"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Memory Window (Optional)</label>
                  <input
                    type="number"
                    min="2"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.memory_window}
                    onChange={e => setFormData({...formData, memory_window: e.target.value})}
                    placeholder="e.g. 12 messages"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Max Iterations (Optional)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.max_iterations}
                    onChange={e => setFormData({...formData, max_iterations: e.target.value})}
                    placeholder="e.g. 8"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Timeout (ms) (Optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.timeout_ms}
                    onChange={e => setFormData({...formData, timeout_ms: e.target.value})}
                    placeholder="e.g. 15000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Retry Policy (Optional)</label>
                  <select
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.retry_policy}
                    onChange={e => setFormData({...formData, retry_policy: e.target.value})}
                  >
                    <option value="standard">Standard</option>
                    <option value="aggressive">Aggressive</option>
                    <option value="relaxed">Relaxed</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 mt-7">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    checked={formData.tools_enabled}
                    onChange={e => setFormData({...formData, tools_enabled: e.target.checked})}
                  />
                  <label className="text-sm font-medium text-slate-700">Tools Enabled</label>
                </div>
              </div>
            </div>
            )}

            {showAgentConfig('voice') && (
            <details className="border border-emerald-100 rounded-xl p-4 bg-emerald-50/40 space-y-3 group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-emerald-950">
                    <AudioLines size={16} className="text-emerald-600" />
                    Voice Runtime
                  </label>
                  <p className="text-xs text-emerald-900/75 mt-1">
                    Save ElevenLabs voice defaults on the agent so browser voice sessions, websocket consumers, and test consoles all inherit the same runtime profile.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link to="/voice" className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">
                    Open Voice Console
                  </Link>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 group-open:bg-emerald-700 group-open:text-white">
                    Expand
                  </span>
                </div>
              </summary>
              <div className="pt-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Voice Config Preset</label>
                    <select
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                      value={formData.voice_preset_id}
                      onChange={e => applyVoicePreset(e.target.value)}
                    >
                      <option value="">Custom runtime values</option>
                      {voiceConfigs.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={saveCurrentVoicePreset} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Save As Preset
                  </button>
                  <button type="button" onClick={updateSelectedVoicePreset} disabled={!formData.voice_preset_id} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                    Update Preset
                  </button>
                  <button type="button" onClick={deleteSelectedVoicePreset} disabled={!formData.voice_preset_id} className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-40">
                    Delete Preset
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Voice ID</label>
                    <input className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_id} onChange={e => setFormData({ ...formData, voice_id: e.target.value })} placeholder="JBFqnCBsd6RMkjVDRZzb" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TTS Model</label>
                    <input className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.tts_model_id} onChange={e => setFormData({ ...formData, tts_model_id: e.target.value })} placeholder="eleven_multilingual_v2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">STT Model</label>
                    <input className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.stt_model_id} onChange={e => setFormData({ ...formData, stt_model_id: e.target.value })} placeholder="scribe_v2_realtime" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Output Format</label>
                    <input className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_output_format} onChange={e => setFormData({ ...formData, voice_output_format: e.target.value })} placeholder="mp3_44100_128" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Sample Rate</label>
                    <input type="number" min="8000" step="1000" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white" value={formData.voice_sample_rate} onChange={e => setFormData({ ...formData, voice_sample_rate: e.target.value })} placeholder="16000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Language</label>
                    <input className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_language_code} onChange={e => setFormData({ ...formData, voice_language_code: e.target.value })} placeholder="en" />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                    checked={formData.voice_auto_tts}
                    onChange={e => setFormData({ ...formData, voice_auto_tts: e.target.checked })}
                  />
                  <span className="text-sm text-slate-700">Auto-play TTS replies for this agent</span>
                </label>
                <div className="rounded-xl border border-emerald-100 bg-white/80 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">Turn Detection And Disturbance Control</div>
                    <div className="text-xs text-slate-500 mt-1">These defaults are reused by the Voice Console and websocket consumers to ignore short disturbances and commit speech turns faster.</div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" checked={formData.voice_vad_enabled} onChange={e => setFormData({ ...formData, voice_vad_enabled: e.target.checked })} />
                      VAD auto-commit
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" checked={formData.voice_browser_noise_suppression} onChange={e => setFormData({ ...formData, voice_browser_noise_suppression: e.target.checked })} />
                      Browser noise suppression
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" checked={formData.voice_browser_echo_cancellation} onChange={e => setFormData({ ...formData, voice_browser_echo_cancellation: e.target.checked })} />
                      Echo cancellation
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" checked={formData.voice_browser_auto_gain_control} onChange={e => setFormData({ ...formData, voice_browser_auto_gain_control: e.target.checked })} />
                      Auto gain control
                    </label>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Silence Threshold (sec)</label>
                      <input type="number" min="0.2" max="3" step="0.1" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_vad_silence_threshold_secs} onChange={e => setFormData({ ...formData, voice_vad_silence_threshold_secs: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">VAD Threshold</label>
                      <input type="number" min="0.1" max="0.95" step="0.05" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_vad_threshold} onChange={e => setFormData({ ...formData, voice_vad_threshold: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Min Speech (ms)</label>
                      <input type="number" min="50" max="2000" step="10" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_min_speech_duration_ms} onChange={e => setFormData({ ...formData, voice_min_speech_duration_ms: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Min Silence (ms)</label>
                      <input type="number" min="50" max="3000" step="10" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_min_silence_duration_ms} onChange={e => setFormData({ ...formData, voice_min_silence_duration_ms: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Recompute Window</label>
                      <input type="number" min="0" max="50" step="1" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-mono text-sm" value={formData.voice_max_tokens_to_recompute} onChange={e => setFormData({ ...formData, voice_max_tokens_to_recompute: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
            </details>
            )}

            {showAgentConfig('project') && (
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Project Link (Required)</label>
                <select
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    value={formData.project_id}
                    onChange={e => setFormData({...formData, project_id: e.target.value})}
                >
                    <option value="">Select project...</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Agents must be linked to a project for tenant/project mapping and governance.
                </p>
            </div>
            )}

            {showAgentConfig('tools') && (
            <div>
                <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-slate-700">Tools</label>
                    <a href="/tools" className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                        <Wrench size={12} />
                        Manage Tools
                    </a>
                </div>
                
                {tools.length === 0 ? (
                    <div className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
                        No tools available. <a href="/tools" className="text-indigo-600 hover:underline">Create a tool</a> to assign it to this agent.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {tools.map(tool => {
                            const isSelected = formData.toolIds.includes(tool.id);
                            return (
                                <button
                                    key={tool.id}
                                    type="button"
                                    onClick={() => toggleTool(tool.id)}
                                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm border transition-all ${
                                        isSelected
                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                                    }`}
                                >
                                    <span className="truncate mr-2">{tool.name}</span>
                                    {isSelected && <Check size={14} className="shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                )}
                <p className="text-xs text-slate-500 mt-2">
                    Select tools this agent can use to perform tasks.
                </p>
            </div>
            )}

            {showAgentConfig('mcp') && (
            <details className="border border-indigo-100 rounded-xl p-4 bg-indigo-50/40 space-y-3 group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <label className="block text-sm font-medium text-indigo-900">Direct MCP Connections</label>
                  <p className="text-xs text-indigo-800/80 mt-1">
                    Attach MCP exposed tools and bundles directly to this agent without creating intermediate MCP tool entries.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <a href="/mcps" className="text-xs text-indigo-700 hover:text-indigo-900 font-medium">Manage MCPs</a>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700 group-open:bg-indigo-700 group-open:text-white">
                    Expand
                  </span>
                </div>
              </summary>
              <div className="pt-3 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-indigo-900 mb-1.5">Exposed MCP Tools</div>
                  {mcpExposedTools.length === 0 ? (
                    <div className="text-xs text-slate-500 bg-white border border-indigo-100 rounded-lg px-3 py-2">
                      No MCP tools exposed yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {mcpExposedTools.map((row) => {
                        const selected = formData.mcp_tool_ids.includes(Number(row.tool_id));
                        return (
                          <button
                            key={`mcp-tool-${row.tool_id}`}
                            type="button"
                            onClick={() => toggleMcpTool(Number(row.tool_id))}
                            className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                              selected
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-900'
                                : 'bg-white border-indigo-100 text-slate-700 hover:bg-indigo-50'
                            }`}
                          >
                            <div className="font-medium">{row.tool_name}</div>
                            <div className="text-[11px] opacity-80">/{row.exposed_name}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-indigo-900 mb-1.5">MCP Bundles</div>
                  {mcpBundles.length === 0 ? (
                    <div className="text-xs text-slate-500 bg-white border border-indigo-100 rounded-lg px-3 py-2">
                      No MCP bundles available.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {mcpBundles.map((b) => {
                        const selected = formData.mcp_bundle_ids.includes(Number(b.id));
                        return (
                          <button
                            key={`mcp-bundle-${b.id}`}
                            type="button"
                            onClick={() => toggleMcpBundle(Number(b.id))}
                            className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                              selected
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-900'
                                : 'bg-white border-indigo-100 text-slate-700 hover:bg-indigo-50'
                            }`}
                          >
                            <div className="font-medium">{b.name}</div>
                            <div className="text-[11px] opacity-80">bundle/{b.slug}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </details>
            )}

            {showAgentConfig('exposure') && (
            <details className="space-y-4 group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">Exposure And Endpoints</div>
                    <div className="text-xs text-slate-500 mt-1">Publish this agent for API, MCP, and voice websocket consumers.</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 group-open:bg-slate-900 group-open:text-white">
                    Expand
                  </span>
                </summary>
                <div className="space-y-4 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                      <input
                          type="checkbox"
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          checked={formData.is_exposed}
                          onChange={e => setFormData({...formData, is_exposed: e.target.checked})}
                      />
                      <span className="text-sm font-medium text-slate-700">Expose as API / MCP Tool</span>
                  </label>
                  <p className="text-xs text-slate-500 mt-1 ml-6">
                      If checked, this agent can be called directly via the API or used as a tool in the Model Context Protocol.
                  </p>
                  {formData.is_exposed && editingId && (
                    <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 space-y-3">
                      <div className="text-sm font-semibold text-cyan-900 flex items-center gap-2">
                        <Radio size={16} />
                        Voice WebSocket
                      </div>
                      <div className="text-xs text-cyan-900/80">
                        External realtime voice clients can connect directly to this exposed agent using the websocket endpoint below.
                      </div>
                      <div className="rounded-lg border border-cyan-100 bg-white px-3 py-2 font-mono text-xs break-all">
                        {appOrigin.replace(/^http/, 'ws')}/ws/voice?targetType=agent&targetId={editingId}
                      </div>
                    </div>
                  )}
                </div>
            </details>
            )}
            
            <div className="pt-6 border-t border-slate-100 bg-transparent flex justify-end gap-3 rounded-lg">
              {agentSaveNotice && (
                <div className={`mr-auto px-3 py-2 rounded-lg text-sm border ${
                  agentSaveNotice.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                  {agentSaveNotice.message}
                </div>
              )}
              <button
                type="button"
                onClick={resetForm}
                className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-white transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAgentSaving}
                className="px-8 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg font-bold shadow-md transition-all active:scale-95"
              >
                {isAgentSaving ? 'Saving...' : (editingId ? `Update ${formData.agent_role === 'supervisor' ? 'Supervisor' : 'Specialist'}` : `Deploy ${formData.agent_role === 'supervisor' ? 'Supervisor' : 'Specialist'}`)}
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
      )}

      <div className={`grid gap-6 ${agentView === 'grid' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        {pagedAgents.map(agent => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 16, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileHover={{ y: -4 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className={`bg-white/90 p-6 rounded-3xl border border-slate-200 hover:shadow-xl hover:shadow-indigo-100/50 transition-all relative overflow-hidden ${agentView === 'list' ? 'md:p-5' : ''}`}
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-100/60 to-cyan-100/40 rounded-full -mr-10 -mt-10 pointer-events-none" />
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 relative">
                  <User size={20} />
                  {agent.is_exposed && (
                      <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5 border-2 border-white" title="Exposed via API/MCP">
                          <Globe size={10} className="text-white" />
                      </div>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{agent.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500">{agent.role}</p>
                  {agent.running_count && agent.running_count > 0 ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                            {agent.running_count} Running
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
                            Idle
                        </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      agent.agent_role === 'supervisor'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-cyan-100 text-cyan-700'
                    }`}>
                      {agent.agent_role === 'supervisor' ? 'Supervisor' : 'Specialist'}
                    </div>
                    {agent.is_exposed && (
                      <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        API / MCP
                      </div>
                    )}
                  </div>
                  {agent.project_id && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full w-fit">
                          <Folder size={10} />
                          <span>{projects.find(p => p.id === agent.project_id)?.name}</span>
                      </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {agent.is_exposed && (
                    <button 
                        onClick={() => setSelectedAgent(agent)}
                        className="text-slate-400 hover:text-green-600 transition-colors mr-1"
                        title="Connection Info"
                    >
                        <Globe size={18} />
                    </button>
                )}
                <button
                    onClick={() => setRunAgent(agent)}
                    className="text-slate-400 hover:text-indigo-600 transition-colors"
                    title="Run Agent"
                >
                    <Play size={18} />
                </button>
                <button
                    onClick={() => setDelegateAgent(agent)}
                    className="text-slate-400 hover:text-violet-600 transition-colors"
                    title="Launch Supervisor Run"
                >
                    <Sparkles size={18} />
                </button>
                <button 
                    onClick={() => startEdit(agent)}
                    className="text-slate-400 hover:text-indigo-500 transition-colors"
                    title="Edit"
                >
                    <Edit size={18} />
                </button>
                <button 
                    onClick={() => deleteAgent(agent.id)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete"
                >
                    <Trash2 size={18} />
                </button>
              </div>
            </div>
            
            <div className={`text-sm ${agentView === 'list' ? 'grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : 'space-y-3'}`}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 mb-2">Mission Profile</div>
                <div className="flex gap-2">
                <Target size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-slate-600"><span className="font-medium text-slate-700">Goal:</span> {agent.goal || 'No explicit goal saved.'}</p>
              </div>
                {agent.backstory ? (
                  <div className="flex gap-2 mt-3">
                    <ScrollText size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-slate-600 line-clamp-2"><span className="font-medium text-slate-700">Backstory:</span> {agent.backstory}</p>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">
                    No backstory set. This agent is running with a lean mission-first profile.
                  </div>
                )}
              </div>
              <div className={agentView === 'list' ? 'space-y-3' : 'space-y-3'}>
              <div className="flex gap-2">
                <ScrollText size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-slate-600 line-clamp-2"><span className="font-medium text-slate-700">System Prompt:</span> {agent.system_prompt || '—'}</p>
              </div>
              <div className="flex gap-2">
                <Brain size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-slate-600"><span className="font-medium text-slate-700">Model:</span> {agent.model}</p>
              </div>
              <div className="flex gap-2">
                <Activity size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div className="text-slate-600 flex flex-wrap gap-1">
                  <span className="font-medium text-slate-700 mr-1">Config:</span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Temp: {agent.temperature ?? 'default'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Max: {agent.max_tokens ?? 'default'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Memory: {agent.memory_window ?? 'default'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Iter: {agent.max_iterations ?? 'default'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Tools: {(agent.tools_enabled !== 0 && agent.tools_enabled !== false) ? 'on' : 'off'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Retry: {agent.retry_policy || 'standard'}
                  </span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 border border-slate-200">
                    Timeout: {agent.timeout_ms ?? 'default'}ms
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Key size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div className="text-slate-600 flex items-center flex-wrap gap-1">
                    <span className="font-medium text-slate-700">Auth:</span> 
                    {agent.credential_source === 'env_var' && (
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono border border-slate-200" title="Using Environment Variable">
                            ENV: {agent.credential_source_name}
                        </span>
                    )}
                    {agent.credential_source === 'specific_provider' && (
                        <span className="text-[10px] bg-blue-50 px-1.5 py-0.5 rounded text-blue-700 border border-blue-100" title="Using Specific Provider Config">
                            Provider: {agent.credential_source_name}
                        </span>
                    )}
                    {agent.credential_source === 'default_provider' && (
                        <span className="text-[10px] bg-blue-50 px-1.5 py-0.5 rounded text-blue-700 border border-blue-100" title="Using Default Provider Config">
                            Default: {agent.credential_source_name}
                        </span>
                    )}
                    {agent.credential_source === 'legacy_credential' && (
                        <span className="text-[10px] bg-amber-50 px-1.5 py-0.5 rounded text-amber-700 border border-amber-100" title="Using Saved Credential">
                            Saved Credential
                        </span>
                    )}
                    {agent.credential_source === 'missing' && (
                        <span className="text-[10px] bg-red-50 px-1.5 py-0.5 rounded text-red-700 font-bold border border-red-100">
                            Missing Key!
                        </span>
                    )}
                </div>
              </div>
              {agent.tools && agent.tools.length > 0 && (
                <div className="flex gap-2">
                    <Wrench size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                        {agent.tools.map(t => (
                            <span key={t.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                {t.name}
                            </span>
                        ))}
                    </div>
                </div>
              )}
              {((agent.mcp_tools && agent.mcp_tools.length > 0) || (agent.mcp_bundles && agent.mcp_bundles.length > 0)) && (
                <div className="flex gap-2">
                    <Globe size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                        {(agent.mcp_tools || []).map((t) => (
                            <span key={`mcp-tool-${t.tool_id}`} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">
                                mcp:{t.exposed_name || t.tool_name}
                            </span>
                        ))}
                        {(agent.mcp_bundles || []).map((b) => (
                            <span key={`mcp-bundle-${b.id}`} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md">
                                bundle:{b.slug}
                            </span>
                        ))}
                    </div>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                {agent.stats ? (
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-slate-500">
                            <span className="font-medium text-slate-700">Cost:</span> 
                            <span className="font-mono text-emerald-600">${agent.stats.total_cost.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-500">
                            <span className="font-medium text-slate-700">Tokens:</span> 
                            <span className="font-mono">{(agent.stats.prompt_tokens + agent.stats.completion_tokens).toLocaleString()}</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-slate-400 italic">No execution history yet</div>
                )}
                <button 
                    onClick={() => {
                        setActivityExecutionId(null);
                        setActivityAgent(agent);
                    }}
                    className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                >
                    <Activity size={12} />
                    View History
                </button>
              </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      {filteredAgents.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-slate-500">
          No agents match the current search and filter settings.
        </div>
      )}
      <div className="mt-6">
        <Pagination
          page={agentsPage}
          pageSize={agentsPageSize}
          total={filteredAgents.length}
          onPageChange={setAgentsPage}
          onPageSizeChange={setAgentsPageSize}
        />
      </div>

      {selectedAgent && (
        <ConnectionModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
      {runAgent && (
        <AgentRunModal agent={runAgent} onClose={() => setRunAgent(null)} />
      )}
      {delegateAgent && (
        <SupervisorRunModal
          supervisor={delegateAgent}
          agents={agents}
          onClose={() => setDelegateAgent(null)}
          onStarted={(executionId) => {
            setActivityExecutionId(executionId);
            setActivityAgent(delegateAgent);
            fetchAgents();
          }}
        />
      )}

      {activityAgent && (
        <AgentActivityModal
          agent={activityAgent}
          initialExecutionId={activityExecutionId}
          onClose={() => {
            setActivityAgent(null);
            setActivityExecutionId(null);
          }}
        />
      )}
    </div>
  );
}
