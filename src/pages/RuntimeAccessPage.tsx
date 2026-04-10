import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Copy, Lightbulb, Link2, Rocket, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';

type AppRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  token_issuer: string;
  token_audience: string;
  base_url?: string | null;
};

type GatewayRow = {
  id: string;
  application_id: string;
  name: string;
  endpoint_url: string;
  auth_mode: string;
  status: string;
  timeout_ms: number;
};

type PolicyRow = {
  id: string;
  application_id: string;
  agent_id?: number | null;
  tool_name: string;
  gateway_id: string;
  required_scopes: string[];
  enabled: boolean;
};

type AgentRow = {
  id: number;
  name: string;
};

function normalizeScopesCsv(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeBaseUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '/mcp/gateway/tool-call';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

const SCOPE_SUGGESTIONS = ['crm.leads:read', 'crm.leads:write', 'crm.campaigns:read', 'crm.campaigns:write'];
const TOOL_NAME_SUGGESTIONS = ['meta_graph_query', 'meta_create_campaign', 'meta_pause_campaign', 'meta_update_budget'];

export default function RuntimeAccessPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [gateways, setGateways] = useState<GatewayRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [newApp, setNewApp] = useState({
    name: '',
    slug: '',
    token_issuer: '',
    token_audience: 'agentic-orchestrator',
    base_url: '',
  });

  const [newGateway, setNewGateway] = useState({
    name: '',
    endpoint_url: '',
    auth_mode: 'signed_jwt',
    timeout_ms: '15000',
  });

  const [newPolicy, setNewPolicy] = useState({
    tool_name: '',
    gateway_id: '',
    agent_id: '',
    required_scopes_csv: '',
    enabled: true,
  });
  const [wizard, setWizard] = useState({
    app_name: '',
    app_domain: '',
    gateway_path: '/mcp/gateway/tool-call',
    policy_tool_name: 'meta_graph_query',
    policy_scopes_csv: 'crm.leads:read',
    policy_agent_id: '',
  });
  const [wizardBusy, setWizardBusy] = useState(false);

  const selectedApp = useMemo(
    () => apps.find((row) => String(row.id) === String(selectedAppId)) || null,
    [apps, selectedAppId],
  );
  const setupProgress = useMemo(() => {
    const checks = [apps.length > 0, gateways.length > 0, policies.length > 0];
    const done = checks.filter(Boolean).length;
    return { done, total: checks.length, percent: Math.round((done / checks.length) * 100) };
  }, [apps.length, gateways.length, policies.length]);
  const wizardDerived = useMemo(() => {
    const normalizedDomain = normalizeBaseUrl(wizard.app_domain);
    const appSlug = slugify(wizard.app_name);
    const endpointUrl = normalizedDomain ? `${normalizedDomain}${normalizePath(wizard.gateway_path)}` : '';
    const gatewayName = wizard.app_name.trim() ? `${wizard.app_name.trim()} Gateway` : 'Application Gateway';
    return {
      appSlug,
      tokenIssuer: normalizedDomain || '',
      baseUrl: normalizedDomain || '',
      endpointUrl,
      gatewayName,
    };
  }, [wizard]);
  const selectedAppGateway = useMemo(
    () => gateways.find((gateway) => gateway.status === 'active') || gateways[0] || null,
    [gateways],
  );
  const backendEnvSnippet = useMemo(() => {
    if (!selectedApp) return '';
    return [
      `ORCHESTRATOR_BASE_URL=${window.location.origin}`,
      'ORCHESTRATOR_API_KEY=<server-side-project-api-key>',
      `CONNECTED_APPLICATION_ID=${selectedApp.id}`,
      'DEFAULT_AGENT_ID=<agent-id>',
    ].join('\n');
  }, [selectedApp]);
  const gatewayCurlSnippet = useMemo(() => {
    if (!selectedApp || !selectedAppGateway) return '';
    return [
      `curl -X POST ${window.location.origin}/api/v2/mcp/gateways/${selectedAppGateway.id}`,
      '  -H "Authorization: Bearer <admin-session-or-api>"',
      '  -H "Content-Type: application/json"',
      "  -d '{\"status\":\"active\"}'",
    ].join('\n');
  }, [selectedApp, selectedAppGateway]);

  const requestJson = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  };
  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ type: 'ok', text: `${label} copied.` });
    } catch {
      setNotice({ type: 'err', text: `Failed to copy ${label}.` });
    }
  };

  const loadApps = async () => {
    const rows = await requestJson('/api/v2/applications');
    const next = Array.isArray(rows) ? rows : [];
    setApps(next);
    if (!selectedAppId && next[0]?.id) setSelectedAppId(String(next[0].id));
    if (selectedAppId && !next.some((row: AppRow) => String(row.id) === String(selectedAppId))) {
      setSelectedAppId(next[0]?.id ? String(next[0].id) : '');
    }
  };

  const loadAgents = async () => {
    const rows = await requestJson('/api/agents');
    setAgents(Array.isArray(rows) ? rows.map((row: any) => ({ id: Number(row.id), name: String(row.name || `Agent ${row.id}`) })) : []);
  };

  const loadGateways = async (applicationId: string) => {
    if (!applicationId) {
      setGateways([]);
      return;
    }
    const rows = await requestJson(`/api/v2/mcp/gateways?application_id=${encodeURIComponent(applicationId)}`);
    setGateways(Array.isArray(rows) ? rows : []);
  };

  const loadPolicies = async (applicationId: string) => {
    if (!applicationId) {
      setPolicies([]);
      return;
    }
    const rows = await requestJson(`/api/v2/mcp/tool-policies?application_id=${encodeURIComponent(applicationId)}`);
    setPolicies(Array.isArray(rows) ? rows : []);
  };

  const refreshForSelectedApp = async (applicationId: string) => {
    await Promise.all([loadGateways(applicationId), loadPolicies(applicationId)]);
  };

  const bootstrap = async () => {
    setLoading(true);
    try {
      await Promise.all([loadApps(), loadAgents()]);
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to load runtime access data') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedAppId) {
      setGateways([]);
      setPolicies([]);
      return;
    }
    refreshForSelectedApp(selectedAppId).catch((error: any) => {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to load app runtime settings') });
    });
  }, [selectedAppId]);

  const createApplication = async () => {
    try {
      const name = newApp.name.trim();
      const slug = (newApp.slug.trim() || slugify(name)).trim();
      if (!name) throw new Error('Application name is required.');
      if (!slug) throw new Error('Application slug is required.');
      if (!newApp.token_issuer.trim()) throw new Error('Token issuer is required.');
      if (!newApp.token_audience.trim()) throw new Error('Token audience is required.');
      await requestJson('/api/v2/applications', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug,
          token_issuer: newApp.token_issuer.trim(),
          token_audience: newApp.token_audience.trim(),
          base_url: newApp.base_url.trim() || undefined,
        }),
      });
      setNewApp({ name: '', slug: '', token_issuer: '', token_audience: 'agentic-orchestrator', base_url: '' });
      await loadApps();
      setNotice({ type: 'ok', text: 'Application created.' });
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to create application') });
    }
  };
  const runConnectWizard = async () => {
    try {
      const appName = wizard.app_name.trim();
      const appSlug = wizardDerived.appSlug;
      const tokenIssuer = wizardDerived.tokenIssuer;
      const baseUrl = wizardDerived.baseUrl;
      const endpointUrl = wizardDerived.endpointUrl;
      const toolName = wizard.policy_tool_name.trim();
      if (!appName) throw new Error('App name is required.');
      if (!appSlug) throw new Error('App slug could not be generated.');
      if (!tokenIssuer) throw new Error('App domain is required.');
      if (!endpointUrl) throw new Error('Gateway endpoint URL is required.');
      if (!toolName) throw new Error('Policy tool name is required.');

      setWizardBusy(true);
      const createdApp = await requestJson('/api/v2/applications', {
        method: 'POST',
        body: JSON.stringify({
          name: appName,
          slug: appSlug,
          token_issuer: tokenIssuer,
          token_audience: 'agentic-orchestrator',
          base_url: baseUrl || undefined,
        }),
      });
      const appId = String(createdApp?.id || '');
      if (!appId) throw new Error('Application creation failed to return an id.');

      const createdGateway = await requestJson('/api/v2/mcp/gateways', {
        method: 'POST',
        body: JSON.stringify({
          application_id: appId,
          name: wizardDerived.gatewayName,
          endpoint_url: endpointUrl,
          auth_mode: 'signed_jwt',
          timeout_ms: 15000,
        }),
      });
      const gatewayId = String(createdGateway?.id || '');
      if (!gatewayId) throw new Error('Gateway creation failed to return an id.');

      await requestJson('/api/v2/mcp/tool-policies', {
        method: 'POST',
        body: JSON.stringify({
          application_id: appId,
          tool_name: toolName,
          gateway_id: gatewayId,
          agent_id: wizard.policy_agent_id ? Number(wizard.policy_agent_id) : null,
          required_scopes: normalizeScopesCsv(wizard.policy_scopes_csv),
          enabled: true,
        }),
      });

      setSelectedAppId(appId);
      await loadApps();
      await refreshForSelectedApp(appId);
      setWizard({
        app_name: '',
        app_domain: '',
        gateway_path: '/mcp/gateway/tool-call',
        policy_tool_name: 'meta_graph_query',
        policy_scopes_csv: 'crm.leads:read',
        policy_agent_id: '',
      });
      setNotice({ type: 'ok', text: 'Connected app setup complete: application, gateway, and policy created.' });
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to run connect wizard') });
    } finally {
      setWizardBusy(false);
    }
  };

  const createGateway = async () => {
    if (!selectedAppId) return;
    try {
      await requestJson('/api/v2/mcp/gateways', {
        method: 'POST',
        body: JSON.stringify({
          application_id: selectedAppId,
          name: newGateway.name.trim(),
          endpoint_url: newGateway.endpoint_url.trim(),
          auth_mode: newGateway.auth_mode,
          timeout_ms: Number(newGateway.timeout_ms) || 15000,
        }),
      });
      setNewGateway({ name: '', endpoint_url: '', auth_mode: 'signed_jwt', timeout_ms: '15000' });
      await loadGateways(selectedAppId);
      setNotice({ type: 'ok', text: 'Gateway created.' });
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to create gateway') });
    }
  };

  const createPolicy = async () => {
    if (!selectedAppId) return;
    try {
      await requestJson('/api/v2/mcp/tool-policies', {
        method: 'POST',
        body: JSON.stringify({
          application_id: selectedAppId,
          tool_name: newPolicy.tool_name.trim(),
          gateway_id: newPolicy.gateway_id.trim(),
          agent_id: newPolicy.agent_id ? Number(newPolicy.agent_id) : null,
          required_scopes: normalizeScopesCsv(newPolicy.required_scopes_csv),
          enabled: Boolean(newPolicy.enabled),
        }),
      });
      setNewPolicy({ tool_name: '', gateway_id: '', agent_id: '', required_scopes_csv: '', enabled: true });
      await loadPolicies(selectedAppId);
      setNotice({ type: 'ok', text: 'Tool policy created.' });
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to create tool policy') });
    }
  };

  const updateGatewayStatus = async (row: GatewayRow, status: string) => {
    try {
      await requestJson(`/api/v2/mcp/gateways/${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadGateways(selectedAppId);
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to update gateway') });
    }
  };

  const deleteGateway = async (id: string) => {
    try {
      await requestJson(`/api/v2/mcp/gateways/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadGateways(selectedAppId);
      await loadPolicies(selectedAppId);
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to delete gateway') });
    }
  };

  const updatePolicyEnabled = async (row: PolicyRow, enabled: boolean) => {
    try {
      await requestJson(`/api/v2/mcp/tool-policies/${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      await loadPolicies(selectedAppId);
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to update policy') });
    }
  };

  const deletePolicy = async (id: string) => {
    try {
      await requestJson(`/api/v2/mcp/tool-policies/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadPolicies(selectedAppId);
    } catch (error: any) {
      setNotice({ type: 'err', text: String(error?.message || 'Failed to delete policy') });
    }
  };

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <h1 className="text-3xl font-black text-white">Runtime Access</h1>
        <p className="text-slate-300 mt-1">Manage connected applications, MCP gateways, and tool policies.</p>
        <div className="mt-4 rounded-xl bg-white/10 border border-white/20 p-3 text-sm text-slate-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold">
              <Sparkles size={15} /> Quick Setup Progress
            </div>
            <div>{setupProgress.done}/{setupProgress.total} steps complete</div>
          </div>
          <div className="mt-2 h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-cyan-300" style={{ width: `${setupProgress.percent}%` }} />
          </div>
          <div className="mt-2 text-xs text-slate-200">
            1) Create Application {'->'} 2) Add Gateway {'->'} 3) Add Tool Policy
          </div>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      <div className="panel-chrome rounded-2xl p-4 space-y-4 border-2 border-cyan-200/70">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <Rocket size={16} /> One-Click Connect Wizard
        </div>
        <div className="text-sm text-slate-600">
          Fill these 5 fields, then click once. We create application, gateway, and first policy automatically.
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
          <input
            className="px-3 py-2 border rounded-lg bg-white"
            placeholder="Website/App name"
            value={wizard.app_name}
            onChange={(e) => setWizard((v) => ({ ...v, app_name: e.target.value }))}
          />
          <input
            className="px-3 py-2 border rounded-lg bg-white"
            placeholder="App domain (ex: https://app.example.com)"
            value={wizard.app_domain}
            onChange={(e) => setWizard((v) => ({ ...v, app_domain: e.target.value }))}
          />
          <input
            className="px-3 py-2 border rounded-lg bg-white"
            placeholder="Gateway path"
            value={wizard.gateway_path}
            onChange={(e) => setWizard((v) => ({ ...v, gateway_path: e.target.value }))}
          />
          <input
            className="px-3 py-2 border rounded-lg bg-white"
            placeholder="First tool name"
            value={wizard.policy_tool_name}
            onChange={(e) => setWizard((v) => ({ ...v, policy_tool_name: e.target.value }))}
          />
          <input
            className="px-3 py-2 border rounded-lg bg-white"
            placeholder="Required scopes (comma separated)"
            value={wizard.policy_scopes_csv}
            onChange={(e) => setWizard((v) => ({ ...v, policy_scopes_csv: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <select
            className="px-3 py-2 border rounded-lg bg-white"
            value={wizard.policy_agent_id}
            onChange={(e) => setWizard((v) => ({ ...v, policy_agent_id: e.target.value }))}
          >
            <option value="">Policy applies to all agents</option>
            {agents.map((row) => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
          </select>
          <div className="px-3 py-2 rounded-lg border bg-slate-50 text-sm text-slate-700 truncate">
            Slug: <span className="font-mono">{wizardDerived.appSlug || '-'}</span>
          </div>
          <div className="px-3 py-2 rounded-lg border bg-slate-50 text-sm text-slate-700 truncate">
            Endpoint: <span className="font-mono">{wizardDerived.endpointUrl || '-'}</span>
          </div>
        </div>
        <button
          onClick={runConnectWizard}
          disabled={wizardBusy}
          className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-60"
        >
          {wizardBusy ? 'Creating...' : 'Connect App in One Click'}
        </button>
      </div>

      <div className="panel-chrome rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <Building2 size={16} /> Connected Applications
        </div>
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 flex items-start gap-2">
          <Lightbulb size={14} className="mt-0.5" />
          <div>
            Tip: use your app domain as <span className="font-mono">token_issuer</span> and keep
            <span className="font-mono"> token_audience</span> as <span className="font-mono">agentic-orchestrator</span>.
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
          <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Name" value={newApp.name} onChange={(e) => setNewApp((v) => ({ ...v, name: e.target.value }))} />
          <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Slug" value={newApp.slug} onChange={(e) => setNewApp((v) => ({ ...v, slug: e.target.value }))} />
          <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Token issuer" value={newApp.token_issuer} onChange={(e) => setNewApp((v) => ({ ...v, token_issuer: e.target.value }))} />
          <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Token audience" value={newApp.token_audience} onChange={(e) => setNewApp((v) => ({ ...v, token_audience: e.target.value }))} />
          <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Base URL (optional)" value={newApp.base_url} onChange={(e) => setNewApp((v) => ({ ...v, base_url: e.target.value }))} />
        </div>
        <button
          onClick={createApplication}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
        >
          Create Application
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-2.5 py-1 rounded border text-xs bg-white hover:bg-slate-50"
            onClick={() => setNewApp((prev) => ({ ...prev, slug: prev.slug || slugify(prev.name) }))}
          >
            Autofill slug from name
          </button>
          <button
            type="button"
            className="px-2.5 py-1 rounded border text-xs bg-white hover:bg-slate-50"
            onClick={() =>
              setNewApp((prev) => ({
                ...prev,
                token_issuer: prev.token_issuer || window.location.origin,
                base_url: prev.base_url || window.location.origin,
              }))
            }
          >
            Use current host for issuer/base URL
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Slug</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Issuer</th>
                <th className="px-2 py-2">Audience</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t cursor-pointer ${String(row.id) === String(selectedAppId) ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                  onClick={() => setSelectedAppId(String(row.id))}
                >
                  <td className="px-2 py-2 font-medium">{row.name}</td>
                  <td className="px-2 py-2">{row.slug}</td>
                  <td className="px-2 py-2">{row.status}</td>
                  <td className="px-2 py-2 font-mono text-xs">{row.token_issuer}</td>
                  <td className="px-2 py-2">{row.token_audience}</td>
                </tr>
              ))}
              {!loading && apps.length === 0 && (
                <tr><td className="px-2 py-4 text-slate-500" colSpan={5}>No applications yet. Start by creating one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="panel-chrome rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <Link2 size={16} /> MCP Gateways {selectedApp ? `for ${selectedApp.name}` : ''}
          </div>
          {!selectedApp && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Select an application first to create gateways.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Gateway name" value={newGateway.name} onChange={(e) => setNewGateway((v) => ({ ...v, name: e.target.value }))} />
            <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Endpoint URL" value={newGateway.endpoint_url} onChange={(e) => setNewGateway((v) => ({ ...v, endpoint_url: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <select className="px-3 py-2 border rounded-lg bg-white" value={newGateway.auth_mode} onChange={(e) => setNewGateway((v) => ({ ...v, auth_mode: e.target.value }))}>
                <option value="signed_jwt">signed_jwt</option>
                <option value="none">none</option>
              </select>
              <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Timeout ms" value={newGateway.timeout_ms} onChange={(e) => setNewGateway((v) => ({ ...v, timeout_ms: e.target.value }))} />
            </div>
          </div>
          <button
            disabled={!selectedAppId}
            onClick={createGateway}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            Add Gateway
          </button>
          <div className="space-y-2">
            {gateways.map((row) => (
              <div key={row.id} className="rounded-xl border bg-white p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{row.name}</div>
                  <div className="text-xs font-mono text-slate-500 break-all">{row.endpoint_url}</div>
                  <div className="text-xs text-slate-500 mt-1">auth: {row.auth_mode} · timeout: {row.timeout_ms}ms · status: {row.status}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {row.status}
                  </span>
                  <button onClick={() => updateGatewayStatus(row, row.status === 'active' ? 'inactive' : 'active')} className="px-2 py-1 rounded border text-xs">
                    {row.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => deleteGateway(row.id)} className="p-1.5 rounded border text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {!loading && gateways.length === 0 && <div className="text-sm text-slate-500">No gateways yet. Add one endpoint that receives delegated tool calls.</div>}
          </div>
        </div>

        <div className="panel-chrome rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <ShieldCheck size={16} /> Tool Policies {selectedApp ? `for ${selectedApp.name}` : ''}
          </div>
          {!selectedApp && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Select an application first to create tool policies.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Tool name" value={newPolicy.tool_name} onChange={(e) => setNewPolicy((v) => ({ ...v, tool_name: e.target.value }))} />
            <select className="px-3 py-2 border rounded-lg bg-white" value={newPolicy.gateway_id} onChange={(e) => setNewPolicy((v) => ({ ...v, gateway_id: e.target.value }))}>
              <option value="">Select gateway</option>
              {gateways.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select className="px-3 py-2 border rounded-lg bg-white" value={newPolicy.agent_id} onChange={(e) => setNewPolicy((v) => ({ ...v, agent_id: e.target.value }))}>
              <option value="">All agents</option>
              {agents.map((row) => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
            </select>
            <input className="px-3 py-2 border rounded-lg bg-white" placeholder="Required scopes (comma separated)" value={newPolicy.required_scopes_csv} onChange={(e) => setNewPolicy((v) => ({ ...v, required_scopes_csv: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Suggested tool names</div>
            <div className="flex flex-wrap gap-2">
              {TOOL_NAME_SUGGESTIONS.map((toolName) => (
                <button
                  key={toolName}
                  type="button"
                  className="px-2 py-1 rounded border bg-white text-xs hover:bg-slate-50"
                  onClick={() => setNewPolicy((prev) => ({ ...prev, tool_name: toolName }))}
                >
                  {toolName}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500">Suggested scopes</div>
            <div className="flex flex-wrap gap-2">
              {SCOPE_SUGGESTIONS.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className="px-2 py-1 rounded border bg-white text-xs hover:bg-slate-50"
                  onClick={() =>
                    setNewPolicy((prev) => {
                      const current = normalizeScopesCsv(prev.required_scopes_csv);
                      if (current.includes(scope)) return prev;
                      return { ...prev, required_scopes_csv: [...current, scope].join(', ') };
                    })
                  }
                >
                  + {scope}
                </button>
              ))}
            </div>
          </div>
          <button
            disabled={!selectedAppId || !newPolicy.gateway_id}
            onClick={createPolicy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            Add Policy
          </button>
          <div className="space-y-2">
            {policies.map((row) => (
              <div key={row.id} className="rounded-xl border bg-white p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{row.tool_name}</div>
                  <div className="text-xs text-slate-500">
                    gateway: {row.gateway_id} · agent: {row.agent_id ?? 'all'} · scopes: {(row.required_scopes || []).join(', ') || 'none'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${row.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {row.enabled ? 'enabled' : 'disabled'}
                  </span>
                  <button onClick={() => updatePolicyEnabled(row, !row.enabled)} className="px-2 py-1 rounded border text-xs">
                    {row.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deletePolicy(row.id)} className="p-1.5 rounded border text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {!loading && policies.length === 0 && <div className="text-sm text-slate-500">No policies yet. Add policies to control which tools each agent can invoke.</div>}
          </div>
        </div>
      </div>

      <div className="panel-chrome rounded-2xl p-4">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <Copy size={16} /> Integration Values
        </div>
        {!selectedApp && (
          <div className="mt-3 text-sm text-slate-500">Select an application to copy connector values for your website backend.</div>
        )}
        {selectedApp && (
          <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Backend Env Snippet</div>
                <button
                  type="button"
                  className="px-2 py-1 rounded border text-xs bg-white hover:bg-slate-50"
                  onClick={() => copyText(backendEnvSnippet, 'Backend env snippet')}
                >
                  Copy
                </button>
              </div>
              <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{backendEnvSnippet}</pre>
            </div>
            <div className="rounded-xl border bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Selected Gateway</div>
                <button
                  type="button"
                  className="px-2 py-1 rounded border text-xs bg-white hover:bg-slate-50 disabled:opacity-50"
                  disabled={!selectedAppGateway}
                  onClick={() => copyText(String(selectedAppGateway?.endpoint_url || ''), 'Gateway endpoint URL')}
                >
                  Copy URL
                </button>
              </div>
              <div className="text-sm text-slate-700">{selectedAppGateway?.name || 'No gateway yet'}</div>
              <div className="text-xs font-mono text-slate-600 break-all">{selectedAppGateway?.endpoint_url || '-'}</div>
              <div className="text-xs text-slate-500">Audience: <span className="font-mono">{selectedApp.token_audience}</span></div>
              {gatewayCurlSnippet && (
                <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">{gatewayCurlSnippet}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="panel-chrome rounded-2xl p-4">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <CheckCircle2 size={16} /> Suggested Setup Order
        </div>
        <ol className="mt-3 text-sm text-slate-700 list-decimal pl-5 space-y-1">
          <li>Create one connected application per product/app domain.</li>
          <li>Add at least one active gateway for that application.</li>
          <li>Create tool policies mapping tool names to gateway and scopes.</li>
          <li>Run agent chat with execution context token from your app backend.</li>
        </ol>
      </div>
    </div>
  );
}
