/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AgentsPage from './pages/AgentsPage';
import CrewsPage from './pages/CrewsPage';
import CrewPage from './pages/CrewPage';

import ToolsPage from './pages/ToolsPage';
import CredentialsPage from './pages/CredentialsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectTracesPage from './pages/ProjectTracesPage';
import ProvidersPage from './pages/ProvidersPage';
import PricingPage from './pages/PricingPage';
import McpPage from './pages/McpPage';
import PlatformPage from './pages/PlatformPage';
import ErrorBoundary from './components/ErrorBoundary';
import AuthPage from './pages/AuthPage';
import TracesPage from './pages/TracesPage';
import TraceDetailPage from './pages/TraceDetailPage';
import TaskControlPage from './pages/TaskControlPage';
import AgentChatPage from './pages/AgentChatPage';
import AgentExecutionPage from './pages/AgentExecutionPage';
import WorkflowsPage from './pages/WorkflowsPage';
import KnowledgebasePage from './pages/KnowledgebasePage';
import { AuthProvider, RequireAuth } from './utils/auth';

export default function App() {
  return (
    <Router>
      <AuthProvider>
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
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/projects" element={<ProjectsPage />} />
                    <Route path="/projects/:id/traces" element={<ProjectTracesPage />} />
                    <Route path="/traces" element={<TracesPage />} />
                    <Route path="/traces/:runId" element={<TraceDetailPage />} />
                    <Route path="/platform" element={<PlatformPage />} />
                    <Route path="/agents" element={<AgentsPage />} />
                    <Route path="/agent-executions/:id" element={<AgentExecutionPage />} />
                    <Route path="/agent-chat" element={<AgentChatPage />} />
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
                </Layout>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
}
