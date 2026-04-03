import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  AudioLines,
  Boxes,
  Building2,
  ChevronsRight,
  Database,
  DollarSign,
  Folder,
  Key,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Server,
  Sparkles,
  Timer,
  Users,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../utils/auth';

type NavItem = {
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  label: string;
  path: string;
  section: 'Operations' | 'Agents' | 'Infrastructure';
  hint?: string;
};

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/', section: 'Operations', hint: 'System posture and health' },
  { icon: Folder, label: 'Projects', path: '/projects', section: 'Operations', hint: 'Tenant projects and links' },
  { icon: Building2, label: 'Platform Admin', path: '/platform', section: 'Operations', hint: 'Governance and plans' },
  { icon: Activity, label: 'Traces', path: '/traces', section: 'Operations', hint: 'Run-level observability' },
  { icon: Timer, label: 'Agent Executions', path: '/agent-executions', section: 'Agents', hint: 'Execution records and replay' },
  { icon: MessageSquare, label: 'Agent Chat', path: '/agent-chat', section: 'Agents', hint: 'Interactive agent console' },
  { icon: Users, label: 'Agents', path: '/agents', section: 'Agents', hint: 'Agent builder and runtime controls' },
  { icon: Sparkles, label: 'Crews', path: '/crews', section: 'Agents', hint: 'Multi-agent orchestration' },
  { icon: Workflow, label: 'Workflows', path: '/workflows', section: 'Agents', hint: 'Graph-based automation' },
  { icon: AudioLines, label: 'Voice Console', path: '/voice', section: 'Agents', hint: 'Realtime voice operations' },
  { icon: Wrench, label: 'Tools', path: '/tools', section: 'Infrastructure', hint: 'Tooling and connectors' },
  { icon: Plug, label: 'MCPs', path: '/mcps', section: 'Infrastructure', hint: 'MCP exposure and bundles' },
  { icon: Database, label: 'Knowledgebase', path: '/knowledgebase', section: 'Infrastructure', hint: 'RAG corpus and docs' },
  { icon: Server, label: 'LLM Providers', path: '/providers', section: 'Infrastructure', hint: 'Provider keys and models' },
  { icon: DollarSign, label: 'Pricing', path: '/pricing', section: 'Infrastructure', hint: 'Token cost configuration' },
  { icon: Key, label: 'Credentials', path: '/credentials', section: 'Infrastructure', hint: 'Secret management' },
  { icon: ListChecks, label: 'Task Control', path: '/task-control', section: 'Infrastructure', hint: 'Emergency stop controls' },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Operations Dashboard', subtitle: 'Live command center for platform health and orchestration readiness.' },
  '/projects': { title: 'Projects', subtitle: 'Organize orchestration scope, tenancy, and traceability by project.' },
  '/platform': { title: 'Platform Admin', subtitle: 'Configure platform plans, governance, and shared policy controls.' },
  '/traces': { title: 'Traces', subtitle: 'Inspect run execution trails, failures, and latency hotspots.' },
  '/agents': { title: 'Agents', subtitle: 'Build, tune, and operate specialist and supervisor agents.' },
  '/agent-executions': { title: 'Agent Executions', subtitle: 'Monitor execution timelines, retries, and output quality.' },
  '/agent-chat': { title: 'Agent Chat', subtitle: 'Run realtime conversational sessions with selected agents.' },
  '/voice': { title: 'Voice Console', subtitle: 'Operate low-latency speech agents with diagnostics and controls.' },
  '/workflows': { title: 'Workflows', subtitle: 'Design graph automation with loops, branches, and webhooks.' },
  '/crews': { title: 'Crews', subtitle: 'Coordinate multi-agent crews with routing and quorum policies.' },
  '/tools': { title: 'Tools', subtitle: 'Build, test, and assign runtime tools for agent execution.' },
  '/knowledgebase': { title: 'Knowledgebase', subtitle: 'Manage retrieval sources and document context for grounding.' },
  '/mcps': { title: 'MCP Registry', subtitle: 'Publish, bundle, and route MCP capabilities across the platform.' },
  '/providers': { title: 'LLM Providers', subtitle: 'Manage provider credentials, models, and failover targets.' },
  '/pricing': { title: 'Pricing', subtitle: 'Track and tune model pricing assumptions for cost visibility.' },
  '/credentials': { title: 'Credentials', subtitle: 'Store and govern secrets used by tools and providers.' },
  '/task-control': { title: 'Task Control', subtitle: 'Issue emergency stop/cancel controls for active runtime jobs.' },
};

function getPageMeta(pathname: string) {
  if (PAGE_META[pathname]) return PAGE_META[pathname];
  if (pathname.startsWith('/crew/')) return { title: 'Crew Runtime', subtitle: 'Manage crew tasks, execution state, and routing behavior.' };
  if (pathname.startsWith('/agent-executions/')) return { title: 'Execution Detail', subtitle: 'Detailed execution timeline, logs, and diagnostics.' };
  if (pathname.startsWith('/projects/') && pathname.endsWith('/traces')) return { title: 'Project Traces', subtitle: 'Project-scoped traces, errors, and outcome analytics.' };
  if (pathname.startsWith('/traces/')) return { title: 'Trace Detail', subtitle: 'End-to-end event timeline for a single platform run.' };
  return { title: 'AgentOps Console', subtitle: 'Unified operations surface for agentic orchestration.' };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('layout_sidebar_collapsed');
      if (raw == null) setSidebarCollapsed(window.innerWidth < 1360);
      else setSidebarCollapsed(raw === '1');
      const hiddenRaw = localStorage.getItem('layout_sidebar_hidden');
      if (hiddenRaw == null) setSidebarHidden(window.innerWidth < 980);
      else setSidebarHidden(hiddenRaw === '1');
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('layout_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    try { localStorage.setItem('layout_sidebar_hidden', sidebarHidden ? '1' : '0'); } catch {}
  }, [sidebarHidden]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((prev) => !prev);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setCommandOpen(false);
    setCommandQuery('');
  }, [location.pathname]);

  const sections: Array<NavItem['section']> = ['Operations', 'Agents', 'Infrastructure'];
  const pageMeta = getPageMeta(location.pathname);
  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => {
      return [item.label, item.section, item.hint, item.path].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    });
  }, [commandQuery]);

  const isActivePath = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className="app-shell flex h-screen text-slate-900 overflow-hidden">
      <motion.aside
        animate={{
          width: sidebarHidden ? 0 : (sidebarCollapsed ? 92 : 300),
          opacity: sidebarHidden ? 0 : 1,
          x: sidebarHidden ? -24 : 0,
        }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="tech-sidebar flex flex-col h-full relative z-20 overflow-visible"
      >
        {!sidebarHidden && (
          <div className="absolute right-2 top-3 z-30 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="layout-chip"
              title={sidebarCollapsed ? 'Expand Navigation' : 'Compact Navigation'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <button
              type="button"
              onClick={() => setSidebarHidden(true)}
              className="layout-chip"
              title="Hide Navigation"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className={sidebarCollapsed ? 'p-4 pt-7' : 'p-6 pt-7'}>
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} mb-2`}>
            <div className="p-2 premium-gradient rounded-2xl shadow-lg shadow-brand-200/70">
              <Sparkles className="text-white" size={18} />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="brand-headline text-2xl font-black tracking-tight text-gradient">AgentOps</h1>
                <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500 mt-0.5">
                  Orchestration Suite
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className={`flex-1 min-h-0 overflow-y-auto ${sidebarCollapsed ? 'px-2' : 'px-3'} pb-4`}>
          {sections.map((section) => {
            const sectionItems = NAV_ITEMS.filter((item) => item.section === section);
            return (
              <div key={section} className="mb-3">
                {!sidebarCollapsed && (
                  <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.26em] text-slate-400">
                    {section}
                  </div>
                )}
                <div className="space-y-1">
                  {sectionItems.map((item) => {
                    const active = isActivePath(item.path);
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        title={`${item.label}${item.hint ? ` - ${item.hint}` : ''}`}
                        className={`group flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                          active
                            ? 'panel-chrome text-brand-700 shadow-md shadow-brand-100/70'
                            : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg transition-colors ${
                          active ? 'bg-brand-200 text-brand-800' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700'
                        }`}>
                          <item.icon size={15} />
                        </div>
                        {!sidebarCollapsed && (
                          <div className="min-w-0">
                            <div className="truncate">{item.label}</div>
                            {item.hint && <div className="text-[10px] text-slate-400 truncate">{item.hint}</div>}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={`${sidebarCollapsed ? 'p-2' : 'p-3'} mt-auto shrink-0`}>
          <div className="panel-chrome rounded-2xl p-3">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold border border-white shadow-sm">
                  {user?.email?.[0].toUpperCase() || 'U'}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{user?.email || 'User'}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Operator</div>
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
          className="fixed left-3 top-1/2 -translate-y-1/2 z-40 panel-chrome px-2.5 py-3 rounded-xl text-slate-700 hover:text-brand-700 transition-colors"
          title="Show Navigation"
        >
          <div className="flex flex-col items-center gap-1.5">
            <ChevronsRight size={15} />
            <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-bold tracking-[0.16em] uppercase">
              Nav
            </span>
          </div>
        </button>
      )}

      <main className="command-canvas flex-1 relative overflow-hidden">
        <div className="scanline" />
        <header className="topbar-glass fixed z-30 left-0 right-0 lg:left-auto lg:right-0" style={{ paddingLeft: sidebarHidden ? 0 : (sidebarCollapsed ? 92 : 300) }}>
          <div className="h-16 px-4 sm:px-6 lg:px-8 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarHidden((v) => !v)}
              className="layout-chip"
              title={sidebarHidden ? 'Show Navigation' : 'Hide Navigation'}
            >
              {sidebarHidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-slate-900 truncate">{pageMeta.title}</div>
              <div className="text-xs text-slate-500 truncate">{pageMeta.subtitle}</div>
            </div>
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="layout-chip hidden sm:flex items-center gap-2 px-3"
              title="Open Command Palette"
            >
              <Search size={14} />
              <span className="text-xs font-semibold text-slate-600">Search</span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">⌘K</span>
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8, scale: 0.998 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.998 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="h-full w-full overflow-auto overflow-x-hidden"
          >
            <div className="app-content-shell p-4 pt-24 sm:p-6 sm:pt-24 lg:p-8 lg:pt-24 xl:p-10 xl:pt-24 rise-in">
              <div className="w-full max-w-(--app-max-width) mx-auto">
                {children}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {commandOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm p-4 flex items-start justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCommandOpen(false)}
          >
            <motion.div
              className="mt-16 w-full max-w-2xl panel-chrome rounded-2xl border border-slate-200 overflow-hidden"
              initial={{ opacity: 0, y: -20, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-slate-200/70 bg-white/80">
                <div className="flex items-center gap-2">
                  <Search size={16} className="text-slate-500" />
                  <input
                    autoFocus
                    value={commandQuery}
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder="Jump to page..."
                    className="w-full bg-transparent outline-none text-sm text-slate-800 placeholder:text-slate-400"
                  />
                  <button className="layout-chip" type="button" onClick={() => setCommandOpen(false)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="max-h-[58vh] overflow-y-auto p-2">
                {filteredCommandItems.length === 0 && (
                  <div className="px-3 py-6 text-sm text-slate-500 text-center">No matching pages.</div>
                )}
                {filteredCommandItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
                    onClick={() => setCommandOpen(false)}
                  >
                    <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600"><item.icon size={14} /></div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                      <div className="text-xs text-slate-500 truncate">{item.hint || item.section}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
