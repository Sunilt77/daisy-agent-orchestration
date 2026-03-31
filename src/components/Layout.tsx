import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, Wrench, Key, Folder, Building2, Server, Activity, Sparkles, LogOut, DollarSign, Plug, ListChecks, MessageSquare, PanelLeftClose, PanelLeftOpen, ChevronsRight, Workflow, Database, AudioLines } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../utils/auth';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('layout_sidebar_collapsed');
      if (raw == null) {
        setSidebarCollapsed(window.innerWidth < 1360);
      } else {
        setSidebarCollapsed(raw === '1');
      }
      const hiddenRaw = localStorage.getItem('layout_sidebar_hidden');
      if (hiddenRaw == null) {
        setSidebarHidden(window.innerWidth < 980);
      } else {
        setSidebarHidden(hiddenRaw === '1');
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('layout_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('layout_sidebar_hidden', sidebarHidden ? '1' : '0');
    } catch {}
  }, [sidebarHidden]);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Folder, label: 'Projects', path: '/projects' },
    { icon: Building2, label: 'Platform Admin', path: '/platform' },
    { icon: Activity, label: 'Traces', path: '/traces' },
    { icon: Users, label: 'Agents', path: '/agents' },
    { icon: MessageSquare, label: 'Agent Chat', path: '/agent-chat' },
    { icon: AudioLines, label: 'Voice Console', path: '/voice' },
    { icon: Workflow, label: 'Workflows', path: '/workflows' },
    { icon: Sparkles, label: 'Crews', path: '/crews' },
    { icon: Wrench, label: 'Tools', path: '/tools' },
    { icon: Database, label: 'Knowledgebase', path: '/knowledgebase' },
    { icon: Plug, label: 'MCPs', path: '/mcps' },
    { icon: ListChecks, label: 'Task Control', path: '/task-control' },
    { icon: Server, label: 'LLM Providers', path: '/providers' },
    { icon: DollarSign, label: 'Pricing', path: '/pricing' },
    { icon: Key, label: 'Credentials', path: '/credentials' },
  ];

  return (
    <div className="app-shell flex h-screen text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        animate={{
          width: sidebarHidden ? 0 : (sidebarCollapsed ? 88 : 288),
          opacity: sidebarHidden ? 0 : 1,
          x: sidebarHidden ? -28 : 0,
        }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="tech-sidebar flex flex-col h-full relative z-20 overflow-visible"
      >
        {!sidebarHidden && (
          <div className="absolute right-2 top-4 z-30 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(v => !v)}
              className="w-7 h-7 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:text-indigo-700"
              title={sidebarCollapsed ? 'Expand Navigation' : 'Compact Navigation'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <button
              type="button"
              onClick={() => setSidebarHidden(true)}
              className="w-7 h-7 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:text-indigo-700"
              title="Hide Navigation"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col">
          <div className={sidebarCollapsed ? 'p-4 pt-8' : 'p-8'}>
            <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} mb-1`}>
              <div className="p-2 premium-gradient rounded-2xl shadow-lg shadow-brand-200">
                 <Sparkles className="text-white" size={20} />
              </div>
              {!sidebarCollapsed && (
                <div>
                  <h1 className="brand-headline text-2xl font-black tracking-tight text-gradient">
                    AgentOrch
                  </h1>
                  <div className="text-[10px] font-bold uppercase tracking-[0.32em] text-slate-400 mt-1">
                    Swarm Runtime
                  </div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 network-grid">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  <span>Node Mesh</span>
                  <span>Online</span>
                </div>
                <div className="mt-3 flex items-end gap-2">
                  {[42, 68, 36, 80, 54, 74, 46].map((h, idx) => (
                    <div key={idx} className="flex-1 rounded-full bg-gradient-to-t from-brand-500/70 via-cyan-400/55 to-emerald-300/45" style={{ height: `${h}px` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <nav className={`flex-1 min-h-0 overflow-y-auto ${sidebarCollapsed ? 'px-2' : 'px-4'} space-y-1 pb-2`}>
            {!sidebarCollapsed && (
              <div className="px-4 py-2 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.24em]">
                Command Surface
              </div>
            )}
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  className={`group flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 hud-rim ${
                    isActive
                      ? 'panel-chrome text-brand-700 translate-x-0.5 shadow-lg shadow-brand-100/60'
                      : 'text-slate-600 hover:bg-white/72 hover:text-slate-900'
                  }`}
                >
                  <div className={`p-1.5 rounded-lg transition-colors ${
                    isActive ? 'bg-brand-200 text-brand-800' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-700'
                  }`}>
                    <item.icon size={16} />
                  </div>
                  {!sidebarCollapsed && item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={`${sidebarCollapsed ? 'p-2' : 'p-4'} mt-auto shrink-0`}>
          <div className="panel-chrome rounded-2xl p-3">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold border-2 border-white shadow-sm">
                  {user?.email?.[0].toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">{user?.email || 'User'}</div>
                  <div className="text-[10px] text-slate-500 font-medium tracking-[0.18em] uppercase">Operator Access</div>
                </div>
              </div>
            )}
            <button
              onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all border border-transparent hover:border-red-100"
              title="Sign Out"
            >
              <LogOut size={14} />
              {!sidebarCollapsed && 'Sign Out'}
            </button>
          </div>
        </div>
      </motion.aside>

      {sidebarHidden && (
        <button
          type="button"
          onClick={() => setSidebarHidden(false)}
          className="fixed left-3 top-1/2 -translate-y-1/2 z-40 panel-chrome px-2 py-3 rounded-xl text-slate-700 hover:text-brand-700 transition-colors"
          title="Show Navigation"
        >
          <div className="flex flex-col items-center gap-2">
            <ChevronsRight size={16} />
            <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold tracking-[0.18em] uppercase">
              Dock
            </span>
          </div>
        </button>
      )}

      {/* Main Content */}
      <main className="command-canvas flex-1 relative overflow-hidden">
        <div className="scanline" />
        <div className="absolute top-0 left-0 right-0 z-10 px-4 sm:px-6 lg:px-8 xl:px-10 pt-4 pointer-events-none">
          <div className="panel-chrome rounded-2xl px-4 py-2 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-slate-500">
            <span>Runtime: Emergent Mesh</span>
            <span className="hidden md:inline">Flow: Adaptive</span>
            <span>Status: Operational</span>
            <span className="hidden xl:inline">Path: {location.pathname}</span>
          </div>
        </div>
        
        <AnimatePresence mode='wait'>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8, scale: 0.998 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.998 }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
            className="h-full w-full overflow-auto overflow-x-hidden"
          >
            <div className="app-content-shell p-4 pt-20 sm:p-6 sm:pt-24 lg:p-8 lg:pt-28 xl:p-10 xl:pt-28 rise-in">
              <div className="w-full max-w-(--app-max-width) mx-auto">
                {children}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
