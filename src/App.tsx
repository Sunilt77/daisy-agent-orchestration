/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, RequireAuth } from './utils/auth';

// Lazy load pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const CrewsPage = lazy(() => import('./pages/CrewsPage'));
const CrewPage = lazy(() => import('./pages/CrewPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const CredentialsPage = lazy(() => import('./pages/CredentialsPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectTracesPage = lazy(() => import('./pages/ProjectTracesPage'));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const McpPage = lazy(() => import('./pages/McpPage'));
const PlatformPage = lazy(() => import('./pages/PlatformPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const TracesPage = lazy(() => import('./pages/TracesPage'));
const TraceDetailPage = lazy(() => import('./pages/TraceDetailPage'));
const TaskControlPage = lazy(() => import('./pages/TaskControlPage'));
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'));
const AgentExecutionPage = lazy(() => import('./pages/AgentExecutionPage'));
const AgentExecutionsPage = lazy(() => import('./pages/AgentExecutionsPage'));
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'));
const KnowledgebasePage = lazy(() => import('./pages/KnowledgebasePage'));
const VoicePage = lazy(() => import('./pages/VoicePage'));

const PageLoader = () => (
  <div className="flex h-64 w-full items-center justify-center">
    <div className="panel-chrome rounded-2xl px-5 py-4 flex items-center gap-3 text-slate-700">
      <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent" />
      <span className="text-sm font-semibold">Loading workspace...</span>
    </div>
  </div>
);

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route
              path="/mcps"
              element={
                <Layout>
                  <ErrorBoundary title="MCPs page failed to render">
                    <McpPage />
                  </ErrorBoundary>
                </Layout>
              }
            />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Layout>
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/projects" element={<ProjectsPage />} />
                        <Route path="/projects/:id/traces" element={<ProjectTracesPage />} />
                        <Route path="/traces" element={<TracesPage />} />
                        <Route path="/traces/:runId" element={<TraceDetailPage />} />
                        <Route path="/platform" element={<PlatformPage />} />
                        <Route path="/agents" element={<AgentsPage />} />
                        <Route path="/agent-executions" element={<AgentExecutionsPage />} />
                        <Route path="/agent-executions/:id" element={<AgentExecutionPage />} />
                        <Route path="/agent-chat" element={<AgentChatPage />} />
                        <Route path="/voice" element={<VoicePage />} />
                        <Route path="/workflows" element={<WorkflowsPage />} />
                        <Route path="/crews" element={<CrewsPage />} />
                        <Route path="/tools" element={<ToolsPage />} />
                        <Route path="/credentials" element={<CredentialsPage />} />
                        <Route path="/providers" element={<ProvidersPage />} />
                        <Route path="/pricing" element={<PricingPage />} />
                        <Route path="/knowledgebase" element={<KnowledgebasePage />} />
                        <Route path="/crew/:id" element={<CrewPage />} />
                        <Route path="/task-control" element={<TaskControlPage />} />
                      </Routes>
                    </Suspense>
                  </Layout>
                </RequireAuth>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}
