import React, { useMemo } from 'react';
import { Brain, Activity, Clock, DollarSign, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
}

export const LiveAgentCard: React.FC<LiveAgentCardProps> = ({ agent, onClick }) => {
  const isRunning = agent.status === 'running' || (agent.running_count ?? 0) > 0;
  const totalTokens = (agent.stats?.prompt_tokens ?? 0) + (agent.stats?.completion_tokens ?? 0);
  const roleTone = (agent.role || '').toLowerCase().includes('supervisor')
    ? 'text-violet-200 border-violet-400/30 bg-violet-500/15'
    : 'text-cyan-100 border-cyan-400/30 bg-cyan-500/15';

  return (
    <motion.div
      layout
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className={`relative group cursor-pointer glass-card rounded-[1.75rem] p-6 transition-all duration-300 overflow-hidden ${
        isRunning ? 'ring-2 ring-brand-400/50 shadow-[0_20px_80px_rgba(39,110,241,0.22)]' : 'hover:border-brand-200/60'
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_right,rgba(120,255,214,0.18),transparent_55%)] opacity-90" />
      <div className="absolute -right-10 top-4 h-28 w-28 rounded-full border border-white/10 bg-white/5 blur-xl" />
      <div className="absolute right-5 top-5 metric-orbit opacity-70" />

      <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity">
        <Brain size={88} />
      </div>

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-6">
          <div className={`p-3 rounded-2xl border transition-colors ${
            isRunning
              ? 'bg-brand-500/20 text-brand-100 border-brand-300/30 animate-pulse-subtle'
              : 'bg-white/10 text-white border-white/10'
          }`}>
            <Brain size={24} />
          </div>
          
          <AnimatePresence>
            {isRunning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-2 px-3 py-1 bg-emerald-400/15 text-emerald-100 border border-emerald-300/20 rounded-full text-[11px] font-bold uppercase tracking-[0.24em]"
              >
                <Loader2 size={12} className="animate-spin" />
                Working
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${roleTone}`}>
              {agent.role || 'Specialist'}
            </span>
            <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
              {isRunning ? 'Mesh Linked' : 'Standby'}
            </span>
          </div>
          <h3 className="text-xl font-bold text-white group-hover:text-brand-100 transition-colors mb-1">
            {agent.name}
          </h3>
          <p className="text-slate-400 text-sm font-medium">
            {isRunning ? 'Streaming work through the active swarm lane.' : 'Ready to absorb a new delegated workload.'}
          </p>
        </div>

        <div className="network-grid mb-5">
          <span className={`h-3 rounded-full ${isRunning ? 'bg-brand-300' : 'bg-white/20'}`} />
          <span className="h-3 rounded-full bg-white/15" />
          <span className={`h-3 rounded-full ${totalTokens > 0 ? 'bg-cyan-300' : 'bg-white/15'}`} />
          <span className="h-3 rounded-full bg-white/10" />
          <span className={`h-3 rounded-full ${agent.stats?.total_cost ? 'bg-emerald-300' : 'bg-white/10'}`} />
          <span className="h-3 rounded-full bg-white/10" />
          <span className={`h-3 rounded-full ${(agent.running_count ?? 0) > 1 ? 'bg-violet-300' : 'bg-white/10'}`} />
          <span className="h-3 rounded-full bg-white/15" />
          <span className={`h-3 rounded-full ${isRunning ? 'bg-white/80' : 'bg-white/15'}`} />
        </div>

        <div className="grid grid-cols-2 gap-3 pt-5 border-t border-white/10">
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.24em] flex items-center gap-1">
              <Activity size={10} /> Usage
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              {totalTokens.toLocaleString()}
            </div>
          </div>
          <div className="space-y-1 text-right">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.24em] flex items-center gap-1 justify-end">
              <DollarSign size={10} /> Cost
            </div>
            <div className="text-sm font-mono font-semibold text-emerald-300">
              ${(agent.stats?.total_cost ?? 0).toFixed(4)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
          <span>Runs in flight</span>
          <span className="font-mono text-white">{Math.max(0, agent.running_count ?? (isRunning ? 1 : 0))}</span>
        </div>
      </div>

      {isRunning && (
        <div className="absolute inset-0 rounded-[1.75rem] pointer-events-none border border-brand-300/40 animate-pulse-subtle opacity-70" />
      )}
    </motion.div>
  );
};
