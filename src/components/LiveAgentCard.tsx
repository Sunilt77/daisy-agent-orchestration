import React from 'react';
import { Brain, Activity, DollarSign, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  stats?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_cost: number;
  };
  running_count?: number;
}

interface LiveAgentCardProps {
  agent: Agent;
  onClick?: () => void;
  variant?: 'default' | 'dashboard';
}

export const LiveAgentCard: React.FC<LiveAgentCardProps> = ({ agent, onClick, variant = 'default' }) => {
  const isRunning = agent.status === 'running' || (agent.running_count ?? 0) > 0;
  const totalTokens = (agent.stats?.prompt_tokens ?? 0) + (agent.stats?.completion_tokens ?? 0);
  const activeRuns = Math.max(0, agent.running_count ?? (isRunning ? 1 : 0));
  const roleLabel = (agent.role || 'Specialist').trim();
  const isDashboard = variant === 'dashboard';

  return (
    <motion.div
      layout
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      className={`relative rounded-3xl border p-5 transition-all duration-200 ${
        isDashboard
          ? 'bg-slate-950/85 border-slate-800 text-slate-100 shadow-[0_24px_50px_rgba(15,23,42,0.45)]'
          : 'panel-chrome border-slate-200/80'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
            isDashboard ? 'border-slate-700 text-slate-300 bg-slate-900/50' : 'border-slate-200 text-slate-500 bg-white/70'
          }`}>
            <Brain size={11} />
            {roleLabel}
          </div>
          <h3 className={`mt-3 text-lg font-black truncate ${isDashboard ? 'text-white' : 'text-slate-900'}`}>
            {agent.name}
          </h3>
          <p className={`mt-1 text-xs ${isDashboard ? 'text-slate-400' : 'text-slate-500'}`}>
            {isRunning ? 'Processing active workload' : 'Ready for new assignments'}
          </p>
        </div>

        <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ${
          isRunning
            ? (isDashboard ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
            : (isDashboard ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-100 text-slate-600 border border-slate-200')
        }`}>
          {isRunning && <Loader2 size={11} className="animate-spin" />}
          {isRunning ? 'Active' : 'Idle'}
        </div>
      </div>

      <div className={`mt-4 grid grid-cols-3 gap-2 rounded-2xl border p-3 ${
        isDashboard ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white/70'
      }`}>
        <div>
          <div className={`text-[10px] uppercase tracking-[0.18em] font-bold ${isDashboard ? 'text-slate-400' : 'text-slate-500'}`}>
            <Activity size={10} className="inline mr-1" />
            Tokens
          </div>
          <div className={`mt-1 text-sm font-semibold font-mono ${isDashboard ? 'text-white' : 'text-slate-900'}`}>
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div>
          <div className={`text-[10px] uppercase tracking-[0.18em] font-bold ${isDashboard ? 'text-slate-400' : 'text-slate-500'}`}>
            <DollarSign size={10} className="inline mr-1" />
            Cost
          </div>
          <div className={`mt-1 text-sm font-semibold font-mono ${isDashboard ? 'text-emerald-200' : 'text-emerald-700'}`}>
            ${(agent.stats?.total_cost ?? 0).toFixed(4)}
          </div>
        </div>
        <div>
          <div className={`text-[10px] uppercase tracking-[0.18em] font-bold ${isDashboard ? 'text-slate-400' : 'text-slate-500'}`}>
            Runs
          </div>
          <div className={`mt-1 text-sm font-semibold font-mono ${isDashboard ? 'text-white' : 'text-slate-900'}`}>
            {activeRuns}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
