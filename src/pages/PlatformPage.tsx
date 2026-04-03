import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Building2, KeyRound, MessageSquare, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Users, Zap } from 'lucide-react';
import Pagination from '../components/Pagination';

type AdminStats = {
  total_tenants: number;
  total_users: number;
  total_messages: number;
  total_numbers?: number;
  active_users?: number;
  active_sessions?: number;
  total_agents?: number;
  total_crews?: number;
  total_tools?: number;
  total_mcp_bundles?: number;
};

type TenantRow = {
  id: string;
  name: string;
  created_at: string;
  users_count: number;
  projects_count: number;
  runs_count: number;
  status: 'active' | 'suspended';
  plan_id: string | null;
  plan_name?: string | null;
  policy: {
    daily_message_cap?: number;
    batch_size?: number;
    rate_limit_per_second?: number;
    max_agents?: number;
    max_crews?: number;
    max_linked_tools?: number;
    max_linked_mcp_tools?: number;
    max_linked_mcp_bundles?: number;
    max_active_sessions_per_user?: number;
    max_active_sessions_org?: number;
  };
  policy_overrides?: Record<string, number>;
  usage?: {
    local_projects_count: number;
    agents_count: number;
    crews_count: number;
    linked_tools_count: number;
    linked_mcp_tools_count: number;
    linked_mcp_bundles_count: number;
    agent_executions_count: number;
    crew_executions_count: number;
    tool_executions_count: number;
    platform_runs_count: number;
    platform_events_count: number;
  };
};

type UserRow = {
  id: string;
  email: string;
  org_id: string;
  org_name: string;
  created_at: string;
  last_login_at?: string | null;
  active_sessions: number;
};

type Plan = {
  id: string;
  name: string;
  description?: string;
  credit_limit: number;
  contact_limit: number;
  max_users: number;
  max_numbers: number;
  daily_message_cap: number;
  batch_size: number;
  rate_limit_per_second?: number;
  max_agents?: number;
  max_crews?: number;
  max_linked_tools?: number;
  max_linked_mcp_tools?: number;
  max_linked_mcp_bundles?: number;
  max_active_sessions_per_user?: number;
  max_active_sessions_org?: number;
  price: number;
  is_active?: boolean;
};

type AccessPolicy = {
  agents_mode?: 'all' | 'none' | 'allowlist';
  allowed_agent_ids?: number[];
  tools_mode?: 'all' | 'none' | 'allowlist';
  mcp_mode?: 'all' | 'none' | 'allowlist';
  allowed_tool_ids?: number[];
  allowed_mcp_tool_ids?: number[];
  allowed_mcp_bundle_ids?: number[];
};

type AccessControlsResponse = {
  global: AccessPolicy;
  tenants: Record<string, AccessPolicy>;
  resources: {
    tools: Array<{ id: number; name: string; type: string; category?: string }>;
    mcp_tools: Array<{ tool_id: number; tool_name: string; exposed_name?: string }>;
    mcp_bundles: Array<{ id: number; name: string; slug: string }>;
    agents: Array<{ id: number; name: string; project_id?: number | null; org_id?: string | null }>;
  };
};

type Settings = {
  daily_message_cap: number;
  batch_size: number;
  rate_limit_per_second: number;
  max_agents: number;
  max_crews: number;
  max_linked_tools: number;
  max_linked_mcp_tools: number;
  max_linked_mcp_bundles: number;
  max_active_sessions_per_user: number;
  max_active_sessions_org: number;
};

type LearningSummary = {
  lessons: number;
  feedback_rows: number;
  preferences: number;
  disabled_counts: {
    agents: number;
    crews: number;
    workflows: number;
  };
};

type LearningSettingRow = {
  resource_type: 'agent' | 'crew' | 'workflow';
  resource_id: number;
  enabled: number;
  updated_at: string;
};

type LearningLessonRow = {
  id: string;
  agent_id: number;
  agent_name: string;
  user_id: string;
  lesson_kind: string;
  task_signature: string | null;
  guidance: string;
  weight: number;
  source_feedback_id?: string | null;
  updated_at: string;
};

type AgentFeedbackRow = {
  id: string;
  execution_id: string;
  agent_id: number;
  agent_name: string;
  user_id: string;
  rating: 'helpful' | 'improve';
  solved: number;
  feedback_text?: string | null;
  task_signature?: string | null;
  tool_sequence?: string | null;
  created_at: string;
};

type CrewFeedbackRow = {
  id: string;
  execution_id: string;
  crew_id: number;
  crew_name: string;
  user_id: string;
  rating: 'helpful' | 'improve';
  solved: number;
  feedback_text?: string | null;
  created_at: string;
};

type WorkflowFeedbackRow = {
  id: string;
  workflow_run_id: string;
  workflow_id: number;
  workflow_name: string;
  user_id: string;
  rating: 'helpful' | 'improve';
  solved: number;
  feedback_text?: string | null;
  created_at: string;
};

type LearningPreferenceRow = {
  user_id: string;
  agent_id: number;
  agent_name: string;
  preference_text: string;
  updated_at: string;
};

type LearningInsightsResponse = {
  summary: LearningSummary;
  settings: LearningSettingRow[];
  agent_lessons: LearningLessonRow[];
  agent_feedback: AgentFeedbackRow[];
  crew_feedback: CrewFeedbackRow[];
  workflow_feedback: WorkflowFeedbackRow[];
  preferences: LearningPreferenceRow[];
};

const DEFAULT_SETTINGS: Settings = {
  daily_message_cap: 1,
  batch_size: 1,
  rate_limit_per_second: 1,
  max_agents: 1,
  max_crews: 1,
  max_linked_tools: 1,
  max_linked_mcp_tools: 1,
  max_linked_mcp_bundles: 1,
  max_active_sessions_per_user: 1,
  max_active_sessions_org: 1,
};

const EMPTY_PLAN: Omit<Plan, 'id'> = {
  name: '',
  description: '',
  credit_limit: 0,
  contact_limit: 0,
  max_users: 0,
  max_numbers: 0,
  daily_message_cap: 0,
  batch_size: 0,
  rate_limit_per_second: 0,
  max_agents: 0,
  max_crews: 0,
  max_linked_tools: 0,
  max_linked_mcp_tools: 0,
  max_linked_mcp_bundles: 0,
  max_active_sessions_per_user: 0,
  max_active_sessions_org: 0,
  price: 0,
  is_active: true,
};

const TENANT_POLICY_FIELDS = [
  { key: 'daily_message_cap', label: 'Daily Cap' },
  { key: 'rate_limit_per_second', label: 'Rate/sec' },
  { key: 'max_agents', label: 'Max Agents' },
  { key: 'max_crews', label: 'Max Crews' },
  { key: 'max_linked_tools', label: 'Max Tools' },
  { key: 'max_linked_mcp_tools', label: 'Max MCP Tools' },
  { key: 'max_linked_mcp_bundles', label: 'Max MCP Bundles' },
  { key: 'max_active_sessions_per_user', label: 'Sess/User' },
  { key: 'max_active_sessions_org', label: 'Sess/Org' },
] as const;

export default function PlatformPage() {
  const [stats, setStats] = useState<AdminStats>({
    total_tenants: 0,
    total_users: 0,
    total_messages: 0,
    active_users: 0,
    active_sessions: 0,
  });
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantStatusFilter, setTenantStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [tenantPage, setTenantPage] = useState(1);
  const [tenantPageSize, setTenantPageSize] = useState(8);
  const [userSearch, setUserSearch] = useState('');
  const [userSessionFilter, setUserSessionFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(8);
  const [newPassword, setNewPassword] = useState<Record<string, string>>({});
  const [tenantEditor, setTenantEditor] = useState<TenantRow | null>(null);
  const [tenantEditorPlanId, setTenantEditorPlanId] = useState<string>('');
  const [tenantEditorPolicy, setTenantEditorPolicy] = useState<Record<string, string>>({});
  const [passwordModalUser, setPasswordModalUser] = useState<UserRow | null>(null);
  const [accessControls, setAccessControls] = useState<AccessControlsResponse>({
    global: { agents_mode: 'all', tools_mode: 'all', mcp_mode: 'all', allowed_agent_ids: [], allowed_tool_ids: [], allowed_mcp_tool_ids: [], allowed_mcp_bundle_ids: [] },
    tenants: {},
    resources: { tools: [], mcp_tools: [], mcp_bundles: [], agents: [] },
  });
  const [globalAccessDraft, setGlobalAccessDraft] = useState<AccessPolicy>({ agents_mode: 'all', tools_mode: 'all', mcp_mode: 'all', allowed_agent_ids: [], allowed_tool_ids: [], allowed_mcp_tool_ids: [], allowed_mcp_bundle_ids: [] });
  const [tenantAccessDraft, setTenantAccessDraft] = useState<AccessPolicy>({ agents_mode: 'all', tools_mode: 'all', mcp_mode: 'all', allowed_agent_ids: [], allowed_tool_ids: [], allowed_mcp_tool_ids: [], allowed_mcp_bundle_ids: [] });
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [planForm, setPlanForm] = useState<Omit<Plan, 'id'>>(EMPTY_PLAN);
  const [tenantPolicyTenantId, setTenantPolicyTenantId] = useState<string>('');
  const [tenantPolicyDraft, setTenantPolicyDraft] = useState<Record<string, string>>({});
  const [learningInsights, setLearningInsights] = useState<LearningInsightsResponse>({
    summary: { lessons: 0, feedback_rows: 0, preferences: 0, disabled_counts: { agents: 0, crews: 0, workflows: 0 } },
    settings: [],
    agent_lessons: [],
    agent_feedback: [],
    crew_feedback: [],
    workflow_feedback: [],
    preferences: [],
  });
  const [learningSearch, setLearningSearch] = useState('');
  const [learningScope, setLearningScope] = useState<'all' | 'agent' | 'crew' | 'workflow'>('all');

  const notify = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 2000);
  };

  const requestJson = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statsRes, tenantsRes, usersRes, plansRes, settingsRes, learningRes] = await Promise.all([
        requestJson('/api/admin/stats'),
        requestJson('/api/admin/tenants'),
        requestJson('/api/admin/users'),
        requestJson('/api/admin/plans'),
        requestJson('/api/admin/settings'),
        requestJson('/api/admin/learning-insights'),
      ]);
      const accessRes = await requestJson('/api/admin/access-controls');
      setStats(statsRes);
      setTenants(Array.isArray(tenantsRes) ? tenantsRes : []);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setPlans(Array.isArray(plansRes) ? plansRes : []);
      setSettings(settingsRes || DEFAULT_SETTINGS);
      setLearningInsights(learningRes || {});
      setAccessControls(accessRes);
      setGlobalAccessDraft(accessRes?.global || {});
    } catch (e: any) {
      notify('error', e.message || 'Failed to load platform admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (!tenantPolicyTenantId) return;
    hydrateTenantPolicyDraft(tenantPolicyTenantId);
  }, [tenantPolicyTenantId, tenants]);

  useEffect(() => {
    setTenantPage(1);
  }, [searchTerm, tenantStatusFilter, tenants.length]);

  useEffect(() => {
    setUserPage(1);
  }, [userSearch, userSessionFilter, users.length]);

  const filteredTenants = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return tenants.filter((t) => {
      if (tenantStatusFilter !== 'all' && t.status !== tenantStatusFilter) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    });
  }, [tenants, searchTerm, tenantStatusFilter]);

  const pagedTenants = useMemo(() => {
    const start = (tenantPage - 1) * tenantPageSize;
    return filteredTenants.slice(start, start + tenantPageSize);
  }, [filteredTenants, tenantPage, tenantPageSize]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userSessionFilter === 'active' && Number(u.active_sessions || 0) <= 0) return false;
      if (userSessionFilter === 'inactive' && Number(u.active_sessions || 0) > 0) return false;
      if (!q) return true;
      return [u.email, u.org_name, u.id].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [users, userSearch, userSessionFilter]);

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, userPage, userPageSize]);

  const insightMetrics = useMemo(() => {
    const activeUsers = Number(stats.active_users || 0);
    const totalUsers = Number(stats.total_users || 0);
    const activeSessions = Number(stats.active_sessions || 0);
    const activeRate = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
    const sessionsPerActiveUser = activeUsers > 0 ? Number((activeSessions / activeUsers).toFixed(2)) : 0;
    const avgRunsPerTenant = tenants.length > 0
      ? Number((tenants.reduce((sum, t) => sum + Number(t.usage?.platform_runs_count || 0), 0) / tenants.length).toFixed(1))
      : 0;
    const totalAgentExecutions = tenants.reduce((sum, t) => sum + Number(t.usage?.agent_executions_count || 0), 0);
    const totalToolExecutions = tenants.reduce((sum, t) => sum + Number(t.usage?.tool_executions_count || 0), 0);
    return {
      activeRate,
      sessionsPerActiveUser,
      avgRunsPerTenant,
      automationLoad: totalAgentExecutions > 0 ? Math.round((totalToolExecutions / totalAgentExecutions) * 100) : 0,
    };
  }, [stats, tenants]);

  const riskTenants = useMemo(() => {
    const enriched = tenants.map((t) => {
      const runCap = Number(t.policy.daily_message_cap || 0);
      const runUsage = Number(t.usage?.platform_runs_count || 0);
      const runUtil = runCap > 0 ? runUsage / runCap : 0;
      const maxAgents = Number(t.policy.max_agents || 0);
      const agentUsage = Number(t.usage?.agents_count || 0);
      const agentUtil = maxAgents > 0 ? agentUsage / maxAgents : 0;
      const maxMcpBundles = Number(t.policy.max_linked_mcp_bundles || 0);
      const mcpBundleUsage = Number(t.usage?.linked_mcp_bundles_count || 0);
      const mcpUtil = maxMcpBundles > 0 ? mcpBundleUsage / maxMcpBundles : 0;
      const riskScore = Math.max(runUtil, agentUtil, mcpUtil, t.status === 'suspended' ? 1 : 0);
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        riskScore,
        runUtil,
        agentUtil,
        mcpUtil,
      };
    });
    return enriched
      .filter((t) => t.riskScore >= 0.7)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 6);
  }, [tenants]);

  const toggleTenantStatus = async (tenant: TenantRow) => {
    const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
    try {
      await requestJson(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      notify('success', `${tenant.name} ${nextStatus}`);
      fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to update tenant status');
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const data = await requestJson('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setSettings(data);
      notify('success', 'System settings updated');
    } catch (e: any) {
      notify('error', e.message || 'Failed to update settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const createPlan = async () => {
    try {
      const planPayload = {
        ...planForm,
        daily_message_cap: planForm.daily_message_cap || settings.daily_message_cap,
        batch_size: planForm.batch_size || settings.batch_size,
        rate_limit_per_second: planForm.rate_limit_per_second || settings.rate_limit_per_second,
        max_agents: planForm.max_agents || settings.max_agents,
        max_crews: planForm.max_crews || settings.max_crews,
        max_linked_tools: planForm.max_linked_tools || settings.max_linked_tools,
        max_linked_mcp_tools: planForm.max_linked_mcp_tools || settings.max_linked_mcp_tools,
        max_linked_mcp_bundles: planForm.max_linked_mcp_bundles || settings.max_linked_mcp_bundles,
        max_active_sessions_per_user: planForm.max_active_sessions_per_user || settings.max_active_sessions_per_user,
        max_active_sessions_org: planForm.max_active_sessions_org || settings.max_active_sessions_org,
      };
      await requestJson('/api/admin/plans', {
        method: 'POST',
        body: JSON.stringify(planPayload),
      });
      setPlanForm(EMPTY_PLAN);
      notify('success', 'Plan created');
      fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to create plan');
    }
  };

  const deletePlan = async (planId: string) => {
    try {
      await requestJson(`/api/admin/plans/${planId}`, { method: 'DELETE' });
      notify('success', 'Plan deleted');
      fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to delete plan');
    }
  };

  const assignPlan = async () => {
    if (!selectedTenant || !selectedPlanId) return;
    try {
      await requestJson(`/api/admin/tenants/${selectedTenant}/assign-plan`, {
        method: 'POST',
        body: JSON.stringify({ plan_id: selectedPlanId }),
      });
      notify('success', 'Plan assigned');
      fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to assign plan');
    }
  };

  const hydrateTenantPolicyDraft = (tenantId: string) => {
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      setTenantPolicyDraft({});
      return;
    }
    const overrides = tenant.policy_overrides || {};
    const next: Record<string, string> = {};
    for (const field of TENANT_POLICY_FIELDS) {
      const value = (overrides as any)[field.key];
      next[field.key] = value == null ? '' : String(value);
    }
    setTenantPolicyDraft(next);
  };

  const saveTenantPolicy = async () => {
    if (!tenantPolicyTenantId) return;
    const payload: Record<string, number | null> = {};
    for (const field of TENANT_POLICY_FIELDS) {
      const raw = String(tenantPolicyDraft[field.key] || '').trim();
      payload[field.key] = raw ? Number(raw) : null;
    }
    try {
      await requestJson(`/api/admin/tenants/${tenantPolicyTenantId}/policy`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify('success', 'Tenant policy updated');
      await fetchAll();
      hydrateTenantPolicyDraft(tenantPolicyTenantId);
    } catch (e: any) {
      notify('error', e.message || 'Failed to save tenant policy');
    }
  };

  const openTenantEditor = (tenant: TenantRow) => {
    setTenantEditor(tenant);
    setTenantEditorPlanId(tenant.plan_id || '');
    const overrides = tenant.policy_overrides || {};
    const next: Record<string, string> = {};
    for (const field of TENANT_POLICY_FIELDS) {
      const value = (overrides as any)[field.key];
      next[field.key] = value == null ? '' : String(value);
    }
    setTenantEditorPolicy(next);
    const tenantPolicy = accessControls.tenants?.[tenant.id] || accessControls.global || {};
    setTenantAccessDraft({
      agents_mode: tenantPolicy.agents_mode || 'all',
      allowed_agent_ids: tenantPolicy.allowed_agent_ids || [],
      tools_mode: tenantPolicy.tools_mode || 'all',
      mcp_mode: tenantPolicy.mcp_mode || 'all',
      allowed_tool_ids: tenantPolicy.allowed_tool_ids || [],
      allowed_mcp_tool_ids: tenantPolicy.allowed_mcp_tool_ids || [],
      allowed_mcp_bundle_ids: tenantPolicy.allowed_mcp_bundle_ids || [],
    });
  };

  const saveTenantEditor = async () => {
    if (!tenantEditor) return;
    try {
      if (tenantEditorPlanId && tenantEditorPlanId !== tenantEditor.plan_id) {
        await requestJson(`/api/admin/tenants/${tenantEditor.id}/assign-plan`, {
          method: 'POST',
          body: JSON.stringify({ plan_id: tenantEditorPlanId }),
        });
      }
      const payload: Record<string, number | null> = {};
      for (const field of TENANT_POLICY_FIELDS) {
        const raw = String(tenantEditorPolicy[field.key] || '').trim();
        payload[field.key] = raw ? Number(raw) : null;
      }
      await requestJson(`/api/admin/tenants/${tenantEditor.id}/policy`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await requestJson(`/api/admin/tenants/${tenantEditor.id}/access-controls`, {
        method: 'PATCH',
        body: JSON.stringify({ policy: tenantAccessDraft }),
      });
      notify('success', 'Tenant updated');
      setTenantEditor(null);
      await fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to update tenant');
    }
  };

  const saveGlobalAccessControls = async () => {
    try {
      const data = await requestJson('/api/admin/access-controls/global', {
        method: 'PATCH',
        body: JSON.stringify({ policy: globalAccessDraft }),
      });
      setAccessControls((prev) => ({ ...prev, global: data?.global || prev.global }));
      notify('success', 'Global access controls updated');
      await fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to save global access controls');
    }
  };

  const toggleId = (list: number[] | undefined, id: number) => {
    const current = Array.isArray(list) ? list : [];
    return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  };

  const resetPassword = async (userId: string) => {
    const pwd = (newPassword[userId] || '').trim();
    if (pwd.length < 8) return notify('error', 'Password must be at least 8 characters');
    try {
      await requestJson(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: pwd }),
      });
      setNewPassword((prev) => ({ ...prev, [userId]: '' }));
      notify('success', 'Password reset');
    } catch (e: any) {
      notify('error', e.message || 'Failed to reset password');
    }
  };

  const removeLearningItem = async (
    scope: 'agent-lessons' | 'agent-feedback' | 'crew-feedback' | 'workflow-feedback',
    id: string,
  ) => {
    try {
      await requestJson(`/api/admin/learning-insights/${scope}/${id}`, { method: 'DELETE' });
      notify('success', 'Learning record removed');
      await fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to remove learning record');
    }
  };

  const clearLearningEntity = async (resourceType: 'agent' | 'crew' | 'workflow', resourceId: number) => {
    try {
      await requestJson(`/api/admin/learning-insights/entity/${resourceType}/${resourceId}`, { method: 'DELETE' });
      notify('success', `${resourceType} learning history cleared`);
      await fetchAll();
    } catch (e: any) {
      notify('error', e.message || 'Failed to clear entity learning history');
    }
  };

  const learningStatusText = (enabled: number) => (Number(enabled) === 0 ? 'Disabled' : 'Enabled');
  const learningQuery = learningSearch.trim().toLowerCase();
  const filteredAgentLessons = useMemo(() => {
    return learningInsights.agent_lessons.filter((row) => {
      if (learningScope !== 'all' && learningScope !== 'agent') return false;
      if (!learningQuery) return true;
      return [row.agent_name, row.user_id, row.lesson_kind, row.guidance, row.task_signature || ''].some((value) =>
        String(value).toLowerCase().includes(learningQuery),
      );
    });
  }, [learningInsights.agent_lessons, learningQuery, learningScope]);

  const filteredAgentFeedback = useMemo(() => {
    return learningInsights.agent_feedback.filter((row) => {
      if (learningScope !== 'all' && learningScope !== 'agent') return false;
      if (!learningQuery) return true;
      return [row.agent_name, row.user_id, row.feedback_text || '', row.task_signature || '', row.rating].some((value) =>
        String(value).toLowerCase().includes(learningQuery),
      );
    });
  }, [learningInsights.agent_feedback, learningQuery, learningScope]);

  const filteredCrewFeedback = useMemo(() => {
    return learningInsights.crew_feedback.filter((row) => {
      if (learningScope !== 'all' && learningScope !== 'crew') return false;
      if (!learningQuery) return true;
      return [row.crew_name, row.user_id, row.feedback_text || '', row.rating].some((value) =>
        String(value).toLowerCase().includes(learningQuery),
      );
    });
  }, [learningInsights.crew_feedback, learningQuery, learningScope]);

  const filteredWorkflowFeedback = useMemo(() => {
    return learningInsights.workflow_feedback.filter((row) => {
      if (learningScope !== 'all' && learningScope !== 'workflow') return false;
      if (!learningQuery) return true;
      return [row.workflow_name, row.user_id, row.feedback_text || '', row.rating].some((value) =>
        String(value).toLowerCase().includes(learningQuery),
      );
    });
  }, [learningInsights.workflow_feedback, learningQuery, learningScope]);

  const filteredPreferences = useMemo(() => {
    return learningInsights.preferences.filter((row) => {
      if (learningScope !== 'all' && learningScope !== 'agent') return false;
      if (!learningQuery) return true;
      return [row.agent_name, row.user_id, row.preference_text].some((value) =>
        String(value).toLowerCase().includes(learningQuery),
      );
    });
  }, [learningInsights.preferences, learningQuery, learningScope]);

  return (
    <div className="space-y-7">
      <div className="swarm-hero p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">Platform Administration</h1>
            <p className="text-slate-300 mt-1">Control tenants, users, plans, access policies, and usage ceilings from one command surface.</p>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Refreshing...' : 'Refresh Metrics'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl px-4 py-2 text-sm ${notice.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {notice.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-9 gap-4">
        {[
          { label: 'Organizations', value: stats.total_tenants, icon: Building2, tone: 'text-blue-700 bg-blue-50' },
          { label: 'Users', value: stats.total_users, icon: Users, tone: 'text-violet-700 bg-violet-50' },
          { label: 'Active Users', value: stats.active_users || 0, icon: ShieldCheck, tone: 'text-emerald-700 bg-emerald-50' },
          { label: 'Active Sessions', value: stats.active_sessions || 0, icon: Activity, tone: 'text-amber-700 bg-amber-50' },
          { label: 'Trace Events', value: stats.total_messages, icon: MessageSquare, tone: 'text-sky-700 bg-sky-50' },
          { label: 'Agents', value: stats.total_agents || 0, icon: Users, tone: 'text-cyan-700 bg-cyan-50' },
          { label: 'Crews', value: stats.total_crews || 0, icon: Activity, tone: 'text-indigo-700 bg-indigo-50' },
          { label: 'Tools', value: stats.total_tools || 0, icon: KeyRound, tone: 'text-fuchsia-700 bg-fuchsia-50' },
          { label: 'MCP Bundles', value: stats.total_mcp_bundles || 0, icon: KeyRound, tone: 'text-rose-700 bg-rose-50' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{kpi.label}</div>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${kpi.tone}`}>
                <kpi.icon size={14} />
              </div>
            </div>
            <div className="text-2xl font-black text-slate-900 mt-2">{Number(kpi.value || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {[
          { label: 'User Activity Rate', value: `${insightMetrics.activeRate}%`, helper: `${stats.active_users || 0}/${stats.total_users || 0} users active`, meter: insightMetrics.activeRate },
          {
            label: 'Sessions Per Active User',
            value: `${insightMetrics.sessionsPerActiveUser}`,
            helper: `${stats.active_sessions || 0} active sessions`,
            meter: Math.min(100, Math.round((insightMetrics.sessionsPerActiveUser / Math.max(1, settings.max_active_sessions_per_user)) * 100)),
          },
          { label: 'Automation Load Index', value: `${insightMetrics.automationLoad}%`, helper: `${insightMetrics.avgRunsPerTenant} avg runs per tenant`, meter: Math.min(100, insightMetrics.automationLoad) },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{m.label}</div>
              <Zap size={14} className="text-indigo-500" />
            </div>
            <div className="text-2xl font-black text-slate-900 mt-2">{m.value}</div>
            <div className="text-xs text-slate-500 mt-1">{m.helper}</div>
            <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600" style={{ width: `${Math.max(2, m.meter)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <details className="bg-white border border-slate-200 rounded-2xl p-5 group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">Global Session/Usage Limits</div>
            <div className="text-xs text-slate-500">Defaults applied to all orgs unless overridden by plan.</div>
          </div>
          <span className="text-xs font-semibold text-slate-600 group-open:hidden">Show limits</span>
          <span className="text-xs font-semibold text-slate-600 hidden group-open:inline">Hide limits</span>
        </summary>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <input type="number" className="ui-input w-48" value={settings.daily_message_cap} onChange={(e) => setSettings((s) => ({ ...s, daily_message_cap: Number(e.target.value || 0) }))} placeholder="Daily cap" />
          <input type="number" className="ui-input w-40" value={settings.batch_size} onChange={(e) => setSettings((s) => ({ ...s, batch_size: Number(e.target.value || 0) }))} placeholder="Batch size" />
          <input type="number" className="ui-input w-52" value={settings.rate_limit_per_second} onChange={(e) => setSettings((s) => ({ ...s, rate_limit_per_second: Number(e.target.value || 0) }))} placeholder="Rate/sec" />
          <input type="number" className="ui-input w-40" value={settings.max_agents} onChange={(e) => setSettings((s) => ({ ...s, max_agents: Number(e.target.value || 0) }))} placeholder="Max agents" />
          <input type="number" className="ui-input w-40" value={settings.max_crews} onChange={(e) => setSettings((s) => ({ ...s, max_crews: Number(e.target.value || 0) }))} placeholder="Max crews" />
          <input type="number" className="ui-input w-44" value={settings.max_linked_tools} onChange={(e) => setSettings((s) => ({ ...s, max_linked_tools: Number(e.target.value || 0) }))} placeholder="Max tools" />
          <input type="number" className="ui-input w-48" value={settings.max_linked_mcp_tools} onChange={(e) => setSettings((s) => ({ ...s, max_linked_mcp_tools: Number(e.target.value || 0) }))} placeholder="Max MCP tools" />
          <input type="number" className="ui-input w-52" value={settings.max_linked_mcp_bundles} onChange={(e) => setSettings((s) => ({ ...s, max_linked_mcp_bundles: Number(e.target.value || 0) }))} placeholder="Max MCP bundles" />
          <input type="number" className="ui-input w-56" value={settings.max_active_sessions_per_user} onChange={(e) => setSettings((s) => ({ ...s, max_active_sessions_per_user: Number(e.target.value || 0) }))} placeholder="Sessions per user" />
          <input type="number" className="ui-input w-52" value={settings.max_active_sessions_org} onChange={(e) => setSettings((s) => ({ ...s, max_active_sessions_org: Number(e.target.value || 0) }))} placeholder="Sessions per org" />
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2"
          >
            <Save size={14} />
            {savingSettings ? 'Saving...' : 'Save'}
          </button>
        </div>
      </details>

      <details className="bg-white border border-slate-200 rounded-2xl p-5 group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-black text-slate-900">Global Access Controls</h3>
            <p className="text-xs text-slate-500">Control global visibility and usage of agents, tools, and MCP resources.</p>
          </div>
          <span className="text-xs font-semibold text-slate-600 group-open:hidden">Show policy</span>
          <span className="text-xs font-semibold text-slate-600 hidden group-open:inline">Hide policy</span>
        </summary>
        <div className="flex items-center justify-end mb-3">
          <button onClick={saveGlobalAccessControls} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2 text-sm font-bold">
            Save Access Policy
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select className="ui-select" value={globalAccessDraft.agents_mode || 'all'} onChange={(e) => setGlobalAccessDraft((p) => ({ ...p, agents_mode: e.target.value as any }))}>
            <option value="all">Agents: All</option>
            <option value="none">Agents: None</option>
            <option value="allowlist">Agents: Allowlist</option>
          </select>
          <select className="ui-select" value={globalAccessDraft.tools_mode || 'all'} onChange={(e) => setGlobalAccessDraft((p) => ({ ...p, tools_mode: e.target.value as any }))}>
            <option value="all">Tools: All</option>
            <option value="none">Tools: None</option>
            <option value="allowlist">Tools: Allowlist</option>
          </select>
          <select className="ui-select" value={globalAccessDraft.mcp_mode || 'all'} onChange={(e) => setGlobalAccessDraft((p) => ({ ...p, mcp_mode: e.target.value as any }))}>
            <option value="all">MCP: All</option>
            <option value="none">MCP: None</option>
            <option value="allowlist">MCP: Allowlist</option>
          </select>
        </div>
        {globalAccessDraft.agents_mode === 'allowlist' && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">Globally Allowed Agents</div>
            <div className="max-h-28 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
              {accessControls.resources.agents.map((a) => (
                <label key={`global-agent-${a.id}`} className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(globalAccessDraft.allowed_agent_ids || []).includes(Number(a.id))}
                    onChange={() => setGlobalAccessDraft((p) => ({ ...p, allowed_agent_ids: toggleId(p.allowed_agent_ids, Number(a.id)) }))}
                  />
                  <span className="truncate">{a.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {globalAccessDraft.tools_mode === 'allowlist' && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">Globally Allowed Tools</div>
            <div className="max-h-28 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
              {accessControls.resources.tools.map((t) => (
                <label key={`global-tool-${t.id}`} className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(globalAccessDraft.allowed_tool_ids || []).includes(Number(t.id))}
                    onChange={() => setGlobalAccessDraft((p) => ({ ...p, allowed_tool_ids: toggleId(p.allowed_tool_ids, Number(t.id)) }))}
                  />
                  <span className="truncate">{t.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {globalAccessDraft.mcp_mode === 'allowlist' && (
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Globally Allowed MCP Tools</div>
              <div className="max-h-24 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                {accessControls.resources.mcp_tools.map((t) => (
                  <label key={`global-mcp-tool-${t.tool_id}`} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(globalAccessDraft.allowed_mcp_tool_ids || []).includes(Number(t.tool_id))}
                      onChange={() => setGlobalAccessDraft((p) => ({ ...p, allowed_mcp_tool_ids: toggleId(p.allowed_mcp_tool_ids, Number(t.tool_id)) }))}
                    />
                    <span className="truncate">{t.tool_name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-1">Globally Allowed MCP Bundles</div>
              <div className="max-h-24 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                {accessControls.resources.mcp_bundles.map((b) => (
                  <label key={`global-mcp-bundle-${b.id}`} className="text-xs flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(globalAccessDraft.allowed_mcp_bundle_ids || []).includes(Number(b.id))}
                      onChange={() => setGlobalAccessDraft((p) => ({ ...p, allowed_mcp_bundle_ids: toggleId(p.allowed_mcp_bundle_ids, Number(b.id)) }))}
                    />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </details>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-amber-600" />
          <h3 className="text-lg font-black text-slate-900">Risk Watchlist</h3>
        </div>
        {riskTenants.length === 0 ? (
          <p className="text-sm text-slate-500">All tenants are currently within healthy utilization thresholds.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {riskTenants.map((tenant) => (
              <div key={tenant.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">{tenant.name}</div>
                  <span className={`text-xs rounded-full px-2 py-1 ${tenant.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{tenant.status}</span>
                </div>
                <div className="text-xs text-slate-600 mt-2">
                  run cap {Math.round(tenant.runUtil * 100)}% • agents {Math.round(tenant.agentUtil * 100)}% • mcp {Math.round(tenant.mcpUtil * 100)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="bg-white border border-slate-200 rounded-2xl p-5 group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900">Learning Insights</h3>
            <p className="text-xs text-slate-500">Inspect lessons learned from feedback, review recent corrections, and clear stale or misleading guidance.</p>
          </div>
          <span className="text-xs font-semibold text-slate-600 group-open:hidden">Show insights</span>
          <span className="text-xs font-semibold text-slate-600 hidden group-open:inline">Hide insights</span>
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Saved Lessons', value: learningInsights.summary.lessons },
              { label: 'Feedback Rows', value: learningInsights.summary.feedback_rows },
              { label: 'User Preferences', value: learningInsights.summary.preferences },
              { label: 'Learning Disabled', value: learningInsights.summary.disabled_counts.agents + learningInsights.summary.disabled_counts.crews + learningInsights.summary.disabled_counts.workflows },
              { label: 'Overrides Tracked', value: learningInsights.settings.length },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{card.label}</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
            <input
              value={learningSearch}
              onChange={(e) => setLearningSearch(e.target.value)}
              className="ui-input"
              placeholder="Search lessons, users, agents, crews, workflows..."
            />
            <select className="ui-select" value={learningScope} onChange={(e) => setLearningScope(e.target.value as any)}>
              <option value="all">All Learning Records</option>
              <option value="agent">Agent Learning Only</option>
              <option value="crew">Crew Learning Only</option>
              <option value="workflow">Workflow Learning Only</option>
            </select>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-black text-slate-900">Recent Learned Lessons</div>
                  <div className="text-xs text-slate-500">Failure avoidance and shortest-path guidance now affecting future runs.</div>
                </div>
                <span className="text-xs text-slate-500">{filteredAgentLessons.length} rows</span>
              </div>
              <div className="space-y-3">
                {filteredAgentLessons.length === 0 ? (
                  <p className="text-sm text-slate-500">No lessons stored yet.</p>
                ) : filteredAgentLessons.slice(0, 6).map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{row.agent_name}</div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{row.lesson_kind.replace(/_/g, ' ')} • weight {row.weight}</div>
                      </div>
                      <button
                        onClick={() => removeLearningItem('agent-lessons', row.id)}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{row.guidance}</div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      user {row.user_id} • {row.task_signature || 'general lesson'} • {new Date(row.updated_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-black text-slate-900">Learning Switches</div>
                  <div className="text-xs text-slate-500">Entity-level overrides applied on top of the default learning behavior.</div>
                </div>
                <span className="text-xs text-slate-500">{learningInsights.settings.length} tracked</span>
              </div>
              <div className="space-y-2">
                {learningInsights.settings.length === 0 ? (
                  <p className="text-sm text-slate-500">No entity-specific learning overrides yet.</p>
                ) : learningInsights.settings.slice(0, 8).map((row) => (
                  <div key={`${row.resource_type}-${row.resource_id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.resource_type} #{row.resource_id}</div>
                      <div className="text-[11px] text-slate-500">{new Date(row.updated_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${Number(row.enabled) === 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {learningStatusText(row.enabled)}
                      </span>
                      <button
                        onClick={() => clearLearningEntity(row.resource_type, row.resource_id)}
                        className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-black text-slate-900">Agent Feedback</div>
                <span className="text-xs text-slate-500">{filteredAgentFeedback.length} rows</span>
              </div>
              <div className="space-y-3">
                {filteredAgentFeedback.length === 0 ? (
                  <p className="text-sm text-slate-500">No agent feedback captured yet.</p>
                ) : filteredAgentFeedback.slice(0, 5).map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{row.agent_name}</div>
                        <div className="text-[11px] text-slate-500">{row.rating} • {Number(row.solved) === 1 ? 'solved' : 'not solved'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => clearLearningEntity('agent', row.agent_id)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">Clear Agent</button>
                        <button onClick={() => removeLearningItem('agent-feedback', row.id)} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Delete</button>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{row.feedback_text || 'No correction text provided.'}</div>
                    <div className="mt-2 text-[11px] text-slate-500">user {row.user_id} • {new Date(row.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-black text-slate-900">Crew Feedback</div>
                <span className="text-xs text-slate-500">{filteredCrewFeedback.length} rows</span>
              </div>
              <div className="space-y-3">
                {filteredCrewFeedback.length === 0 ? (
                  <p className="text-sm text-slate-500">No crew feedback captured yet.</p>
                ) : filteredCrewFeedback.slice(0, 5).map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{row.crew_name}</div>
                        <div className="text-[11px] text-slate-500">{row.rating} • {Number(row.solved) === 1 ? 'solved' : 'not solved'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => clearLearningEntity('crew', row.crew_id)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">Clear Crew</button>
                        <button onClick={() => removeLearningItem('crew-feedback', row.id)} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Delete</button>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{row.feedback_text || 'No correction text provided.'}</div>
                    <div className="mt-2 text-[11px] text-slate-500">user {row.user_id} • {new Date(row.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-sm font-black text-slate-900">Workflow Feedback</div>
                <span className="text-xs text-slate-500">{filteredWorkflowFeedback.length} rows</span>
              </div>
              <div className="space-y-3">
                {filteredWorkflowFeedback.length === 0 ? (
                  <p className="text-sm text-slate-500">No workflow feedback captured yet.</p>
                ) : filteredWorkflowFeedback.slice(0, 5).map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{row.workflow_name}</div>
                        <div className="text-[11px] text-slate-500">{row.rating} • {Number(row.solved) === 1 ? 'solved' : 'not solved'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => clearLearningEntity('workflow', row.workflow_id)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">Clear Workflow</button>
                        <button onClick={() => removeLearningItem('workflow-feedback', row.id)} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Delete</button>
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">{row.feedback_text || 'No correction text provided.'}</div>
                    <div className="mt-2 text-[11px] text-slate-500">user {row.user_id} • {new Date(row.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-black text-slate-900">Recent User Preferences</div>
                <div className="text-xs text-slate-500">Per-user hints the platform now feeds back into later agent runs.</div>
              </div>
              <span className="text-xs text-slate-500">{filteredPreferences.length} rows</span>
            </div>
            {filteredPreferences.length === 0 ? (
              <p className="text-sm text-slate-500">No learned user preferences yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredPreferences.slice(0, 6).map((row) => (
                  <div key={`${row.user_id}-${row.agent_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">{row.agent_name}</div>
                    <div className="mt-1 text-sm text-slate-700">{row.preference_text}</div>
                    <div className="mt-2 text-[11px] text-slate-500">user {row.user_id} • {new Date(row.updated_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 min-h-[560px]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-black text-slate-900">Tenants</h3>
              <p className="text-xs text-slate-500">Status, limits, traces, and plan assignment.</p>
            </div>
            <div className="relative w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
                placeholder="Search org..."
              />
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[
              { key: 'all', label: `All (${tenants.length})` },
              { key: 'active', label: `Active (${tenants.filter((t) => t.status === 'active').length})` },
              { key: 'suspended', label: `Suspended (${tenants.filter((t) => t.status === 'suspended').length})` },
            ].map((chip) => (
              <button
                key={chip.key}
                onClick={() => setTenantStatusFilter(chip.key as typeof tenantStatusFilter)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  tenantStatusFilter === chip.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {chip.label}
              </button>
            ))}
            <button
              onClick={() => { setSearchTerm(''); setTenantStatusFilter('all'); }}
              disabled={!searchTerm.trim() && tenantStatusFilter === 'all'}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>
          <div className="mb-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{filteredTenants.length}</span> visible of <span className="font-semibold text-slate-700">{tenants.length}</span>
          </div>

          <div className="table-shell">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="text-left px-3 py-2">Org</th>
                  <th className="text-left px-3 py-2">Usage</th>
                  <th className="text-left px-3 py-2">Limits</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-3 py-3 text-slate-500">Loading tenants...</td></tr>
                ) : pagedTenants.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-3 text-slate-500">No tenants found.</td></tr>
                ) : pagedTenants.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{t.name}</div>
                      <div className="text-[11px] text-slate-500">{t.id}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 leading-5">
                      users {t.users_count} | projects {t.projects_count} | runs {t.runs_count}
                      <br />
                      agents {t.usage?.agents_count || 0} | crews {t.usage?.crews_count || 0}
                      <br />
                      tools {t.usage?.linked_tools_count || 0} | mcp tools {t.usage?.linked_mcp_tools_count || 0} | mcp bundles {t.usage?.linked_mcp_bundles_count || 0}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 leading-5">
                      plan {t.plan_name || 'None'}
                      <br />
                      cap {t.policy.daily_message_cap ?? 0} | rate {t.policy.rate_limit_per_second ?? 0}/s
                      <br />
                      max agents {t.policy.max_agents ?? 0} | max mcp bundles {t.policy.max_linked_mcp_bundles ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTenantStatus(t)}
                          className={`text-xs px-2 py-1 rounded-full ${t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                        >
                          {t.status}
                        </button>
                        <button
                          onClick={() => openTenantEditor(t)}
                          className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            className="mt-3"
            page={tenantPage}
            pageSize={tenantPageSize}
            total={filteredTenants.length}
            onPageChange={setTenantPage}
            onPageSizeChange={(n) => {
              setTenantPageSize(n);
              setTenantPage(1);
            }}
          />

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="text-sm font-bold text-slate-900 mb-2">Assign Plan</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select className="ui-select" value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)}>
                <option value="">Select tenant...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <select className="ui-select" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                <option value="">Select plan...</option>
                {plans.filter((p) => p.is_active !== false).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button onClick={assignPlan} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2 text-sm font-bold">
                Apply Plan
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="text-sm font-bold text-slate-900 mb-2">Tenant Overrides (Agents/MCP/Session Limits)</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <select
                className="ui-select"
                value={tenantPolicyTenantId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setTenantPolicyTenantId(nextId);
                  hydrateTenantPolicyDraft(nextId);
                }}
              >
                <option value="">Select tenant...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {TENANT_POLICY_FIELDS.slice(0, 3).map((field) => (
                <input
                  key={field.key}
                  type="number"
                  className="ui-input"
                  placeholder={`${field.label} (blank=inherited)`}
                  value={tenantPolicyDraft[field.key] || ''}
                  onChange={(e) => setTenantPolicyDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              {TENANT_POLICY_FIELDS.slice(3).map((field) => (
                <input
                  key={field.key}
                  type="number"
                  className="ui-input"
                  placeholder={`${field.label} (blank=inherited)`}
                  value={tenantPolicyDraft[field.key] || ''}
                  onChange={(e) => setTenantPolicyDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ))}
            </div>
            <button
              onClick={saveTenantPolicy}
              disabled={!tenantPolicyTenantId}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-sm font-bold"
            >
              Save Overrides
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-black text-slate-900 mb-1">Users & Password Resets</h3>
              <p className="text-xs text-slate-500">Reset credentials and inspect active sessions.</p>
            </div>
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
                placeholder="Search user or org..."
              />
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[
              { key: 'all', label: `All (${users.length})` },
              { key: 'active', label: `Active Sessions (${users.filter((u) => Number(u.active_sessions || 0) > 0).length})` },
              { key: 'inactive', label: `No Sessions (${users.filter((u) => Number(u.active_sessions || 0) <= 0).length})` },
            ].map((chip) => (
              <button
                key={chip.key}
                onClick={() => setUserSessionFilter(chip.key as typeof userSessionFilter)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  userSessionFilter === chip.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {chip.label}
              </button>
            ))}
            <button
              onClick={() => { setUserSearch(''); setUserSessionFilter('all'); }}
              disabled={!userSearch.trim() && userSessionFilter === 'all'}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>
          <div className="mb-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{filteredUsers.length}</span> visible of <span className="font-semibold text-slate-700">{users.length}</span>
          </div>
          <div className="table-shell">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Org</th>
                  <th className="text-left px-3 py-2">Sessions</th>
                  <th className="text-left px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-3 py-3 text-slate-500">Loading users...</td></tr>
                ) : pagedUsers.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-3 text-slate-500">No users found.</td></tr>
                ) : pagedUsers.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{u.email}</div>
                      <div className="text-[11px] text-slate-500">{u.last_login_at ? `last login ${new Date(u.last_login_at).toLocaleString()}` : 'never logged in'}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{u.org_name}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{u.active_sessions}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setPasswordModalUser(u)}
                        className="px-3 py-1 rounded-md bg-slate-900 text-white text-xs"
                      >
                        Reset Password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            className="mt-3"
            page={userPage}
            pageSize={userPageSize}
            total={filteredUsers.length}
            onPageChange={setUserPage}
            onPageSizeChange={(n) => {
              setUserPageSize(n);
              setUserPage(1);
            }}
          />
        </div>
      </div>

      {passwordModalUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5">
            <h4 className="text-lg font-black text-slate-900">Reset Password</h4>
            <p className="text-xs text-slate-500 mt-1">{passwordModalUser.email}</p>
            <input
              type="password"
              className="mt-4 w-full px-3 py-2 border border-slate-200 rounded-lg"
              placeholder="Enter new password (min 8 chars)"
              value={newPassword[passwordModalUser.id] || ''}
              onChange={(e) => setNewPassword((prev) => ({ ...prev, [passwordModalUser.id]: e.target.value }))}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPasswordModalUser(null)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">Cancel</button>
              <button
                onClick={async () => {
                  await resetPassword(passwordModalUser.id);
                  setPasswordModalUser(null);
                }}
                className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {tenantEditor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 max-h-[85vh] overflow-auto">
            <h4 className="text-lg font-black text-slate-900">Edit Tenant</h4>
            <p className="text-xs text-slate-500 mt-1">{tenantEditor.name} • {tenantEditor.id}</p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Status</div>
                <button
                  onClick={() => toggleTenantStatus(tenantEditor)}
                  className={`mt-2 text-xs px-2 py-1 rounded-full ${tenantEditor.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}
                >
                  {tenantEditor.status}
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500 mb-2">Assigned Plan</div>
                <select className="ui-select w-full" value={tenantEditorPlanId} onChange={(e) => setTenantEditorPlanId(e.target.value)}>
                  <option value="">Select plan...</option>
                  {plans.filter((p) => p.is_active !== false).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Current Usage</div>
                <div className="text-xs mt-2 text-slate-700 leading-5">
                  agents {tenantEditor.usage?.agents_count || 0} | crews {tenantEditor.usage?.crews_count || 0}
                  <br />
                  tools {tenantEditor.usage?.linked_tools_count || 0} | mcp bundles {tenantEditor.usage?.linked_mcp_bundles_count || 0}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
              {TENANT_POLICY_FIELDS.map((field) => (
                <input
                  key={field.key}
                  type="number"
                  className="ui-input"
                  placeholder={`${field.label} (blank=inherited)`}
                  value={tenantEditorPolicy[field.key] || ''}
                  onChange={(e) => setTenantEditorPolicy((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="text-sm font-bold text-slate-900 mb-2">Tenant Access Controls</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                <select className="ui-select" value={tenantAccessDraft.agents_mode || 'all'} onChange={(e) => setTenantAccessDraft((p) => ({ ...p, agents_mode: e.target.value as any }))}>
                  <option value="all">Agents: All</option>
                  <option value="none">Agents: None</option>
                  <option value="allowlist">Agents: Allowlist</option>
                </select>
                <select className="ui-select" value={tenantAccessDraft.tools_mode || 'all'} onChange={(e) => setTenantAccessDraft((p) => ({ ...p, tools_mode: e.target.value as any }))}>
                  <option value="all">Tools: All</option>
                  <option value="none">Tools: None</option>
                  <option value="allowlist">Tools: Allowlist</option>
                </select>
                <select className="ui-select" value={tenantAccessDraft.mcp_mode || 'all'} onChange={(e) => setTenantAccessDraft((p) => ({ ...p, mcp_mode: e.target.value as any }))}>
                  <option value="all">MCP: All</option>
                  <option value="none">MCP: None</option>
                  <option value="allowlist">MCP: Allowlist</option>
                </select>
              </div>

              {tenantAccessDraft.agents_mode === 'allowlist' && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-700 mb-1">Allowed Agents</div>
                  <div className="max-h-32 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                    {accessControls.resources.agents
                      .filter((a) => !a.org_id || a.org_id === tenantEditor.id)
                      .map((a) => (
                        <label key={`tenant-agent-${a.id}`} className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={(tenantAccessDraft.allowed_agent_ids || []).includes(Number(a.id))}
                            onChange={() => setTenantAccessDraft((p) => ({ ...p, allowed_agent_ids: toggleId(p.allowed_agent_ids, Number(a.id)) }))}
                          />
                          <span className="truncate">{a.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {tenantAccessDraft.tools_mode === 'allowlist' && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-700 mb-1">Allowed Tools</div>
                  <div className="max-h-36 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                    {accessControls.resources.tools.map((t) => (
                      <label key={`tenant-tool-${t.id}`} className="text-xs flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={(tenantAccessDraft.allowed_tool_ids || []).includes(Number(t.id))}
                          onChange={() => setTenantAccessDraft((p) => ({ ...p, allowed_tool_ids: toggleId(p.allowed_tool_ids, Number(t.id)) }))}
                        />
                        <span className="truncate">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {tenantAccessDraft.mcp_mode === 'allowlist' && (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-1">Allowed MCP Tools</div>
                    <div className="max-h-28 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                      {accessControls.resources.mcp_tools.map((t) => (
                        <label key={`tenant-mcp-tool-${t.tool_id}`} className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={(tenantAccessDraft.allowed_mcp_tool_ids || []).includes(Number(t.tool_id))}
                            onChange={() => setTenantAccessDraft((p) => ({ ...p, allowed_mcp_tool_ids: toggleId(p.allowed_mcp_tool_ids, Number(t.tool_id)) }))}
                          />
                          <span className="truncate">{t.tool_name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-1">Allowed MCP Bundles</div>
                    <div className="max-h-28 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
                      {accessControls.resources.mcp_bundles.map((b) => (
                        <label key={`tenant-mcp-bundle-${b.id}`} className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={(tenantAccessDraft.allowed_mcp_bundle_ids || []).includes(Number(b.id))}
                            onChange={() => setTenantAccessDraft((p) => ({ ...p, allowed_mcp_bundle_ids: toggleId(p.allowed_mcp_bundle_ids, Number(b.id)) }))}
                          />
                          <span className="truncate">{b.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setTenantEditor(null)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">Cancel</button>
              <button onClick={saveTenantEditor} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm">Save Tenant</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-lg font-black text-slate-900 mb-1">Plans & Quotas</h3>
        <p className="text-xs text-slate-500 mb-3">Create and manage org plans used for session and usage limits.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
          <input className="ui-input" placeholder="Plan name" value={planForm.name} onChange={(e) => setPlanForm((p) => ({ ...p, name: e.target.value }))} />
          <input className="ui-input" type="number" placeholder="Daily cap" value={planForm.daily_message_cap} onChange={(e) => setPlanForm((p) => ({ ...p, daily_message_cap: Number(e.target.value || 0) }))} />
          <input className="ui-input" type="number" placeholder="Rate/sec" value={planForm.rate_limit_per_second || 0} onChange={(e) => setPlanForm((p) => ({ ...p, rate_limit_per_second: Number(e.target.value || 0) }))} />
          <button onClick={createPlan} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2 text-sm font-bold">Create Plan</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
          <input className="ui-input" type="number" placeholder="Max agents" value={planForm.max_agents || 0} onChange={(e) => setPlanForm((p) => ({ ...p, max_agents: Number(e.target.value || 0) }))} />
          <input className="ui-input" type="number" placeholder="Max crews" value={planForm.max_crews || 0} onChange={(e) => setPlanForm((p) => ({ ...p, max_crews: Number(e.target.value || 0) }))} />
          <input className="ui-input" type="number" placeholder="Max tools" value={planForm.max_linked_tools || 0} onChange={(e) => setPlanForm((p) => ({ ...p, max_linked_tools: Number(e.target.value || 0) }))} />
          <input className="ui-input" type="number" placeholder="Max MCP bundles" value={planForm.max_linked_mcp_bundles || 0} onChange={(e) => setPlanForm((p) => ({ ...p, max_linked_mcp_bundles: Number(e.target.value || 0) }))} />
        </div>
        <div className="table-shell">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="text-left px-3 py-2">Plan</th>
                <th className="text-left px-3 py-2">Daily Cap</th>
                <th className="text-left px-3 py-2">Rate/sec</th>
                <th className="text-left px-3 py-2">Price</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-3 text-slate-500">No plans yet.</td></tr>
              ) : plans.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-900">{p.name}</td>
                  <td className="px-3 py-2">{p.daily_message_cap}</td>
                  <td className="px-3 py-2">{p.rate_limit_per_second || 0}</td>
                  <td className="px-3 py-2">${Number(p.price || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => deletePlan(p.id)} className="px-2 py-1 text-xs rounded-md bg-red-50 text-red-700 border border-red-100">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
