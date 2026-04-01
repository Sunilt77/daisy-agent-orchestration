import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Key, Plug, Save, Trash2, X, Search, Sparkles, Activity, Boxes, RotateCcw } from 'lucide-react';
import Pagination from '../components/Pagination';

interface ExposedToolRow {
  tool_id: number;
  tool_name: string;
  tool_description?: string;
  category?: string;
  tool_type?: string;
  exposed_name?: string | null;
  exposed_description?: string | null;
}

interface McpBundle {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  is_exposed: boolean;
  tool_count: number;
  tools: Array<{
    tool_id: number;
    tool_name: string;
    tool_description?: string;
    exposed_name?: string | null;
  }>;
}

interface McpBundleVersion {
  id: number;
  bundle_id: number;
  version_number: number;
  name: string;
  slug: string;
  description?: string | null;
  tool_ids?: string;
  change_kind: string;
  created_at: string;
}

interface ExposedToolVersion {
  id: number;
  tool_id: number;
  version_number: number;
  exposed_name?: string | null;
  description?: string | null;
  is_exposed: number;
  change_kind: string;
  created_at: string;
}

interface CredentialOption {
  id: number;
  provider: string;
  name?: string;
  key_name?: string;
  category?: string;
}

interface McpTestTool {
  tool_id: number;
  tool_name: string;
  exposed_name?: string | null;
  description?: string;
  tool_type?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

interface BundleTestPayload {
  bundle: {
    id: number;
    name: string;
    slug: string;
    description?: string;
  };
  tools: McpTestTool[];
}

interface LocalMcpRuntime {
  runtime_key: string;
  package_name: string;
  runtime_label: string;
  transport: string;
  runtime_mode: string;
  raw_command: string;
  raw_args: string[];
  env_keys: string[];
  timeout_ms: number;
  tool_count: number;
  exposed_tool_count: number;
  bundle_count: number;
  attached_agent_count: number;
  recommended_endpoint?: string | null;
  updated_at?: string | null;
  tools: Array<{
    id: number;
    name: string;
    description?: string;
    mcp_tool_name?: string;
    exposed_name?: string | null;
    is_exposed: boolean;
  }>;
  bundles: Array<{
    id: number;
    name: string;
    slug: string;
    description?: string | null;
    is_exposed: boolean;
  }>;
  agent_links: Array<{
    id: number;
    name: string;
  }>;
}

interface ResourceAccessPayload {
  owner?: {
    owner_user_id?: string;
    owner_org_id?: string | null;
    visibility?: 'private' | 'org';
  } | null;
  shares?: Array<{
    id: number;
    shared_with_user_id?: string | null;
    shared_with_org_id?: string | null;
    created_at?: string;
  }>;
}

async function safeJson(res: Response) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function slugify(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_');
}

function compactToolAlias(input: string, fallback = 'tool') {
  const normalized = slugify(input)
    .replace(/^tool_+/, '')
    .replace(/^mcp_+/, '')
    .replace(/_mcp_server$/i, '')
    .replace(/_mcp$/i, '')
    .replace(/_server$/i, '');
  return normalized || slugify(fallback) || 'tool';
}

function compactBundleSlug(input: string, fallback = 'mcp bundle') {
  const normalized = slugify(input)
    .replace(/^bundle_+/, '')
    .replace(/^mcp_bundle_+/, '')
    .replace(/_bundle$/i, '');
  const base = normalized || slugify(fallback).replace(/^bundle_+/, '').replace(/^mcp_bundle_+/, '').replace(/_bundle$/i, '') || 'mcp';
  return `${base}_bundle`;
}

function humanizeCompactName(input: string) {
  const compact = compactToolAlias(input, input);
  return compact
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stringifyTestValue(type: string | undefined, raw: string) {
  const value = raw.trim();
  if (value === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received "${raw}"`);
    return parsed;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Expected true or false, received "${raw}"`);
  }
  if (type === 'object' || type === 'array') {
    return JSON.parse(value);
  }
  return raw;
}

function formatDisplayedMcpToolName(name?: string | null) {
  const value = String(name || '').trim();
  if (!value) return '';
  return `tool_${compactToolAlias(value, value)}`;
}

export default function McpPage() {
  const [rows, setRows] = useState<ExposedToolRow[]>([]);
  const [bundles, setBundles] = useState<McpBundle[]>([]);
  const [localRuntimes, setLocalRuntimes] = useState<LocalMcpRuntime[]>([]);
  const [authToken, setAuthToken] = useState<string>('');
  const [tokenSaved, setTokenSaved] = useState<boolean>(false);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);
  const [credentialCategory, setCredentialCategory] = useState<string>('mcp');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('');
  const [copied, setCopied] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkPrefix, setBulkPrefix] = useState<string>('');
  const [bundleName, setBundleName] = useState<string>('Selected Tools Bundle');
  const [bundleSlug, setBundleSlug] = useState<string>('selected_tools_bundle');
  const [bundleDescription, setBundleDescription] = useState<string>('A grouped MCP exposure of selected tools.');
  const [bundleStatus, setBundleStatus] = useState<string>('');
  const [loadError, setLoadError] = useState<string>('');
  const [serverTestStatus, setServerTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [serverTestMessage, setServerTestMessage] = useState<string>('');
  const [connectBundle, setConnectBundle] = useState<McpBundle | null>(null);
  const [isNameManual, setIsNameManual] = useState(false);
  const [isSlugManual, setIsSlugManual] = useState(false);
  const [isDescriptionManual, setIsDescriptionManual] = useState(false);
  const [bundlesPage, setBundlesPage] = useState(1);
  const [bundlesPageSize, setBundlesPageSize] = useState(5);
  const [toolsPage, setToolsPage] = useState(1);
  const [toolsPageSize, setToolsPageSize] = useState(12);
  const [bundleSearch, setBundleSearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [toolCategoryFilter, setToolCategoryFilter] = useState('all');
  const [toolTypeFilter, setToolTypeFilter] = useState('all');
  const [toolExposureFilter, setToolExposureFilter] = useState<'all' | 'exposed' | 'available'>('all');
  const [toolSelectionFilter, setToolSelectionFilter] = useState<'all' | 'selected'>('all');
  const [showVersionsModal, setShowVersionsModal] = useState<null | { type: 'bundle' | 'tool'; id: number; name: string }>(null);
  const [bundleVersions, setBundleVersions] = useState<McpBundleVersion[]>([]);
  const [exposedToolVersions, setExposedToolVersions] = useState<ExposedToolVersion[]>([]);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null);
  const [bundleDeleteState, setBundleDeleteState] = useState<null | { bundle: McpBundle; message?: string }>(null);
  const [expandedBundleIds, setExpandedBundleIds] = useState<number[]>([]);
  const [bundleTestState, setBundleTestState] = useState<BundleTestPayload | null>(null);
  const [bundleTestLoading, setBundleTestLoading] = useState(false);
  const [bundleTestLoadingId, setBundleTestLoadingId] = useState<number | null>(null);
  const [bundleTestSelectedToolId, setBundleTestSelectedToolId] = useState<string>('');
  const [bundleTestValues, setBundleTestValues] = useState<Record<string, string>>({});
  const [bundleTestError, setBundleTestError] = useState<string>('');
  const [bundleTestResult, setBundleTestResult] = useState<string>('');
  const [bundleTestRunning, setBundleTestRunning] = useState(false);
  const [bundleAccessState, setBundleAccessState] = useState<null | {
    bundle: McpBundle;
    data: ResourceAccessPayload | null;
    loading: boolean;
    saving: boolean;
    error: string;
    visibility: 'private' | 'org';
    sharedUserIdsText: string;
    sharedOrgIdsText: string;
  }>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const streamableUrl = `${origin}/mcp`;
  const sseUrl = `${origin}/mcp/sse`;

  const load = async () => {
    setLoadError('');
    try {
      const [toolsRes, cfgRes, bundlesRes, runtimesRes] = await Promise.all([
        fetch('/api/mcp/exposed-tools'),
        fetch('/api/mcp/config'),
        fetch('/api/mcp/bundles'),
        fetch('/api/mcp/local-packages'),
      ]);
      const credRes = await fetch(`/api/credentials?category=${encodeURIComponent(credentialCategory)}`).catch(() => null);
      const tools = await toolsRes.json().catch(() => []);
      const cfg = await cfgRes.json().catch(() => ({}));
      const bundleRows = await bundlesRes.json().catch(() => []);
      const runtimeRows = await runtimesRes.json().catch(() => []);
      setRows(Array.isArray(tools) ? tools : []);
      setBundles(Array.isArray(bundleRows) ? bundleRows : []);
      setLocalRuntimes(Array.isArray(runtimeRows) ? runtimeRows : []);
      if (credRes) {
        const creds = await credRes.json().catch(() => []);
        setCredentials(Array.isArray(creds) ? creds : []);
      } else {
        setCredentials([]);
      }
      setAuthToken(cfg?.auth_token || '');
      setSelectedIds([]);
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load MCP data');
    }
  };

  const openBundleAccess = async (bundle: McpBundle) => {
    setBundleAccessState({
      bundle,
      data: null,
      loading: true,
      saving: false,
      error: '',
      visibility: 'private',
      sharedUserIdsText: '',
      sharedOrgIdsText: '',
    });
    try {
      const res = await fetch(`/api/resource-access/mcp_bundle/${bundle.id}`);
      const data = await safeJson(res) as ResourceAccessPayload | { error?: string } | null;
      if (!res.ok) throw new Error((data as any)?.error || 'Failed to load access');
      const payload = (data || {}) as ResourceAccessPayload;
      setBundleAccessState({
        bundle,
        data: payload,
        loading: false,
        saving: false,
        error: '',
        visibility: payload.owner?.visibility === 'org' ? 'org' : 'private',
        sharedUserIdsText: (payload.shares || []).map((row) => String(row.shared_with_user_id || '').trim()).filter(Boolean).join(', '),
        sharedOrgIdsText: (payload.shares || []).map((row) => String(row.shared_with_org_id || '').trim()).filter(Boolean).join(', '),
      });
    } catch (e: any) {
      setBundleAccessState({
        bundle,
        data: null,
        loading: false,
        saving: false,
        error: e.message || 'Failed to load access',
        visibility: 'private',
        sharedUserIdsText: '',
        sharedOrgIdsText: '',
      });
    }
  };

  const saveBundleAccess = async () => {
    if (!bundleAccessState) return;
    setBundleAccessState((prev) => prev ? { ...prev, saving: true, error: '' } : prev);
    try {
      const res = await fetch(`/api/resource-access/mcp_bundle/${bundleAccessState.bundle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: bundleAccessState.visibility,
          shared_user_ids: bundleAccessState.sharedUserIdsText.split(',').map((value) => value.trim()).filter(Boolean),
          shared_org_ids: bundleAccessState.sharedOrgIdsText.split(',').map((value) => value.trim()).filter(Boolean),
        }),
      });
      const data = await safeJson(res) as ResourceAccessPayload | { error?: string } | null;
      if (!res.ok) throw new Error((data as any)?.error || 'Failed to save access');
      const payload = (data || {}) as ResourceAccessPayload;
      setBundleAccessState((prev) => prev ? {
        ...prev,
        data: payload,
        saving: false,
        error: '',
      } : prev);
    } catch (e: any) {
      setBundleAccessState((prev) => prev ? { ...prev, saving: false, error: e.message || 'Failed to save access' } : prev);
    }
  };

  useEffect(() => {
    load();
  }, [credentialCategory]);

  useEffect(() => setBundlesPage(1), [bundles.length]);
  useEffect(() => setToolsPage(1), [rows.length]);
  useEffect(() => setBundlesPage(1), [bundleSearch]);
  useEffect(() => setToolsPage(1), [toolSearch]);
  useEffect(() => setToolsPage(1), [toolCategoryFilter, toolTypeFilter, toolExposureFilter, toolSelectionFilter]);

  useEffect(() => {
    if (bundleName.trim() && !isSlugManual) {
      setBundleSlug(compactBundleSlug(bundleName, bundleName));
    }
  }, [bundleName, isSlugManual]);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    const selectedTools = rows.filter(r => selectedIds.includes(r.tool_id));
    if (selectedTools.length === 0) return;

    if (!isNameManual) {
      const primaryLabel = selectedTools[0].exposed_name || selectedTools[0].tool_name;
      const suggestedName = selectedTools.length === 1 
        ? `${humanizeCompactName(primaryLabel)} Bundle`
        : `${selectedTools.length} Tools Bundle`;
      setBundleName(suggestedName);
    }

    if (!isDescriptionManual) {
      const toolNames = selectedTools.map(t => t.tool_name).join(', ');
      setBundleDescription(`An MCP bundle exposing tools: ${toolNames}`);
    }
  }, [selectedIds, rows, isNameManual, isDescriptionManual]);

  const updateRow = (toolId: number, patch: Partial<ExposedToolRow>) => {
    setRows(prev => prev.map(r => (r.tool_id === toolId ? { ...r, ...patch } : r)));
  };

  const saveExposure = async (row: ExposedToolRow, exposed: boolean) => {
    await fetch(`/api/mcp/exposed-tools/${row.tool_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exposed,
        exposed_name: row.exposed_name,
        description: row.exposed_description,
      })
    });
    await load();
  };

  const saveAuthToken = async () => {
    await fetch('/api/mcp/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: authToken || null })
    });
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 1500);
  };

  const copy = async (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    }
    setCopied(value);
    setTimeout(() => setCopied(''), 1200);
  };

  const selectAll = () => setSelectedIds(rows.map(r => r.tool_id));
  const clearSelection = () => {
    setSelectedIds([]);
    setIsNameManual(false);
    setIsSlugManual(false);
    setIsDescriptionManual(false);
    setBundleName('Selected Tools Bundle');
    setBundleDescription('A grouped MCP exposure of selected tools.');
    setBundleSlug('selected_tools_bundle');
  };

  const toggleSelect = (toolId: number) => {
    setSelectedIds(prev => (prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId]));
  };

  const selectFilteredTools = (toolIds: number[]) => {
    setSelectedIds((prev) => Array.from(new Set([...prev, ...toolIds])));
  };

  const clearFilteredSelection = (toolIds: number[]) => {
    const hidden = new Set(toolIds);
    setSelectedIds((prev) => prev.filter((id) => !hidden.has(id)));
  };

  const bulkExpose = async () => {
    const targets = rows.filter(r => selectedIds.includes(r.tool_id));
    for (const row of targets) {
      const prefix = compactToolAlias(bulkPrefix || '', '');
      const toolBase = compactToolAlias(row.exposed_name || row.tool_name, row.tool_name);
      const exposedName = prefix ? `${prefix}_${toolBase}` : toolBase;
      await fetch(`/api/mcp/exposed-tools/${row.tool_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exposed: true,
          exposed_name: exposedName,
          description: row.tool_description || '',
        })
      });
    }
    await load();
  };

  const createBundleFromSelection = async () => {
    if (!selectedIds.length) return;
    setBundleStatus('Saving bundle...');
    try {
      const res = await fetch('/api/mcp/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bundleName.trim() || 'MCP Bundle',
          slug: compactBundleSlug(bundleSlug || bundleName || 'mcp bundle', bundleName || 'mcp bundle'),
          description: bundleDescription.trim() || null,
          tool_ids: selectedIds,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save bundle');
      setBundleStatus('Bundle saved');
      setIsNameManual(false);
      setIsSlugManual(false);
      setIsDescriptionManual(false);
      await load();
    } catch (e: any) {
      setBundleStatus(e.message || 'Failed to save bundle');
    }
  };

  const runServerTest = async () => {
    setServerTestStatus('testing');
    setServerTestMessage('');
    try {
      const res = await fetch('/api/tools/mcp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: streamableUrl,
          transportType: 'streamable',
          apiKey: authToken || undefined,
          credentialId: selectedCredentialId ? Number(selectedCredentialId) : undefined,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'MCP server test failed');
      setServerTestStatus('ok');
      setServerTestMessage(`Connected: ${data?.toolCount || 0} tools`);
    } catch (e: any) {
      setServerTestStatus('error');
      setServerTestMessage(e.message || 'MCP server test failed');
    }
  };

  const exposedTools = useMemo(() => rows.filter(r => r.exposed_name), [rows]);
  const availableTools = useMemo(() => rows.filter(r => !r.exposed_name), [rows]);

  function getDisplayCategory(row: ExposedToolRow) {
    const explicit = String(row.category || '').trim();
    if (explicit && !['general', 'mcp'].includes(explicit.toLowerCase())) return explicit;
    const haystack = `${row.tool_name} ${row.tool_description || ''} ${row.exposed_name || ''}`.toLowerCase();
    if (/(facebook|meta|instagram)/.test(haystack)) return 'FB';
    if (/(google|youtube|adwords)/.test(haystack)) return 'Google';
    return explicit || 'General';
  }

  function getDisplayType(row: ExposedToolRow) {
    const raw = String(row.tool_type || 'custom').toLowerCase();
    if (raw === 'mcp' || raw === 'mcp_stdio_proxy') return 'MCP';
    if (raw === 'http') return 'HTTP';
    if (raw === 'python') return 'Python';
    if (raw === 'search') return 'Search';
    if (raw === 'calculator') return 'Calculator';
    return 'Custom';
  }

  const sortedTools = useMemo(() => {
    return [...rows].sort((a, b) => {
      const catA = getDisplayCategory(a).toLowerCase();
      const catB = getDisplayCategory(b).toLowerCase();
      if (catA < catB) return -1;
      if (catA > catB) return 1;
      return a.tool_name.localeCompare(b.tool_name);
    });
  }, [rows]);

  const toolTypes = useMemo(() => {
    return Array.from(new Set(rows.map((row) => getDisplayType(row)))).sort();
  }, [rows]);

  const toolCategories = useMemo(() => {
    return Array.from(new Set(rows.map((row) => getDisplayCategory(row)))).sort();
  }, [rows]);

  const filteredTools = useMemo(() => {
    return sortedTools.filter((row) => {
      const displayCategory = getDisplayCategory(row);
      const displayType = getDisplayType(row);
      const matchesSearch = !toolSearch.trim() || `${row.tool_name} ${row.tool_description || ''} ${row.exposed_name || ''} ${displayCategory} ${displayType}`.toLowerCase().includes(toolSearch.trim().toLowerCase());
      const matchesCategory = toolCategoryFilter === 'all' || displayCategory === toolCategoryFilter;
      const matchesType = toolTypeFilter === 'all' || displayType === toolTypeFilter;
      const isExposed = Boolean(row.exposed_name);
      const matchesExposure = toolExposureFilter === 'all'
        || (toolExposureFilter === 'exposed' && isExposed)
        || (toolExposureFilter === 'available' && !isExposed);
      const isSelected = selectedIds.includes(row.tool_id);
      const matchesSelection = toolSelectionFilter === 'all' || isSelected;
      return matchesSearch && matchesCategory && matchesType && matchesExposure && matchesSelection;
    });
  }, [selectedIds, sortedTools, toolCategoryFilter, toolExposureFilter, toolSearch, toolSelectionFilter, toolTypeFilter]);

  const pagedBundles = useMemo(() => {
    const start = (bundlesPage - 1) * bundlesPageSize;
    return bundles
      .filter((bundle) => !bundleSearch.trim() || `${bundle.name} ${bundle.slug} ${bundle.description || ''}`.toLowerCase().includes(bundleSearch.trim().toLowerCase()))
      .slice(start, start + bundlesPageSize);
  }, [bundles, bundlesPage, bundlesPageSize, bundleSearch]);

  const pagedTools = useMemo(() => {
    const start = (toolsPage - 1) * toolsPageSize;
    return filteredTools.slice(start, start + toolsPageSize);
  }, [filteredTools, toolsPage, toolsPageSize]);

  const groupedRows = useMemo(() => {
    const groups: { [key: string]: ExposedToolRow[] } = {};
    pagedTools.forEach(row => {
      const cat = getDisplayCategory(row);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(row);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [pagedTools]);

  const visibleToolIds = useMemo(() => filteredTools.map((row) => row.tool_id), [filteredTools]);
  const selectedVisibleCount = useMemo(() => filteredTools.filter((row) => selectedIds.includes(row.tool_id)).length, [filteredTools, selectedIds]);

  const mcpInsights = useMemo(() => ({
    bundles: bundles.length,
    exposedTools: exposedTools.length,
    availableTools: availableTools.length,
    selected: selectedIds.length,
  }), [bundles.length, exposedTools.length, availableTools.length, selectedIds.length]);

  const openVersionHistory = async (type: 'bundle' | 'tool', id: number, name: string) => {
    setShowVersionsModal({ type, id, name });
    setBundleVersions([]);
    setExposedToolVersions([]);
    if (type === 'bundle') {
      const res = await fetch(`/api/mcp/bundles/${id}/versions`);
      const data = await res.json().catch(() => ({}));
      setBundleVersions(Array.isArray(data?.versions) ? data.versions : []);
    } else {
      const res = await fetch(`/api/mcp/exposed-tools/${id}/versions`);
      const data = await res.json().catch(() => ({}));
      setExposedToolVersions(Array.isArray(data?.versions) ? data.versions : []);
    }
  };

  const toggleBundleExposure = async (bundleId: number, exposed: boolean) => {
    try {
      const res = await fetch(`/api/mcp/bundles/${bundleId}/exposure`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_exposed: exposed })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to update exposure status');
      }
      await load();
    } catch (e: any) {
      setLoadError(e.message || 'Failed to update bundle exposure');
    }
  };

  const restoreMcpVersion = async (type: 'bundle' | 'tool', entityId: number, versionId: number) => {
    setRestoringVersionId(versionId);
    try {
      const endpoint = type === 'bundle'
        ? `/api/mcp/bundles/${entityId}/restore/${versionId}`
        : `/api/mcp/exposed-tools/${entityId}/restore/${versionId}`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to restore version');
      await load();
      await openVersionHistory(type, entityId, showVersionsModal?.name || '');
    } catch (e: any) {
      setLoadError(e.message || 'Failed to restore version');
    } finally {
      setRestoringVersionId(null);
    }
  };

  const deleteBundle = async (id: number, force = false) => {
    const res = await fetch(`/api/mcp/bundles/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409) {
        const bundle = bundles.find((b) => b.id === id);
        if (bundle) setBundleDeleteState({ bundle, message: data?.error || 'Bundle has dependencies.' });
        return;
      }
      throw new Error(data?.error || 'Failed to delete bundle');
    }
    setBundleDeleteState(null);
    await load();
  };

  const toggleBundleExpanded = (bundleId: number) => {
    setExpandedBundleIds((prev) => (
      prev.includes(bundleId) ? prev.filter((id) => id !== bundleId) : [...prev, bundleId]
    ));
  };

  const openBundleTester = async (bundle: McpBundle) => {
    setBundleTestLoading(true);
    setBundleTestLoadingId(bundle.id);
    setBundleTestError('');
    setBundleTestResult('');
    setBundleTestValues({});
    setBundleTestSelectedToolId('');
    try {
      const res = await fetch(`/api/mcp/bundles/${bundle.id}/test-tools`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to load bundle tools');
      setBundleTestState(data);
      if (Array.isArray(data?.tools) && data.tools.length > 0) {
        setBundleTestSelectedToolId(String(data.tools[0].tool_id));
      }
    } catch (e: any) {
      setLoadError(e.message || 'Failed to open bundle tester');
    } finally {
      setBundleTestLoading(false);
      setBundleTestLoadingId(null);
    }
  };

  const selectedBundleTestTool = useMemo(() => {
    if (!bundleTestState) return null;
    return bundleTestState.tools.find((tool) => String(tool.tool_id) === bundleTestSelectedToolId) || null;
  }, [bundleTestState, bundleTestSelectedToolId]);

  const runBundleToolTest = async () => {
    if (!bundleTestState || !selectedBundleTestTool) return;
    setBundleTestError('');
    setBundleTestResult('');
    setBundleTestRunning(true);
    try {
      const schema = selectedBundleTestTool.inputSchema || { properties: {}, required: [] };
      const properties = schema.properties || {};
      const required = new Set((schema.required || []).map((key) => String(key)));
      const args: Record<string, any> = {};
      for (const [key, property] of Object.entries(properties) as Array<[string, { type?: string; description?: string }]>) {
        const rawValue = bundleTestValues[key] ?? '';
        if (!rawValue.trim()) {
          if (required.has(key)) throw new Error(`"${key}" is required`);
          continue;
        }
        args[key] = stringifyTestValue(property?.type, rawValue);
      }

      const res = await fetch(`/api/mcp/bundles/${bundleTestState.bundle.id}/test-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_id: selectedBundleTestTool.tool_id,
          args,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to execute bundle tool');
      setBundleTestResult(String(data?.result || ''));
    } catch (e: any) {
      setBundleTestError(e.message || 'Failed to execute bundle tool');
    } finally {
      setBundleTestRunning(false);
    }
  };

  const getBundleVersionToolIds = (toolIds?: string) => {
    if (!toolIds) return [];
    try {
      const parsed = JSON.parse(toolIds);
      return Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : [];
    } catch {
      return [];
    }
  };

  const getBundleVersionDelta = (versions: McpBundleVersion[], index: number) => {
    const current = new Set(getBundleVersionToolIds(versions[index]?.tool_ids));
    const previous = new Set(getBundleVersionToolIds(versions[index + 1]?.tool_ids));
    if (!versions[index + 1]) return null;
    let added = 0;
    let removed = 0;
    current.forEach((id) => {
      if (!previous.has(id)) added += 1;
    });
    previous.forEach((id) => {
      if (!current.has(id)) removed += 1;
    });
    return { added, removed };
  };

  return (
    <div>
      <div className="swarm-hero p-6 mb-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
            <Sparkles size={12} />
            MCP Surface
          </div>
          <h1 className="text-3xl font-black text-white">MCPs</h1>
          <p className="text-slate-300 mt-1">Expose tools as stable MCP contracts, group them into bundles, and manage the endpoint lifecycle safely.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mt-6">
        {[
          { label: 'Bundles', value: mcpInsights.bundles, icon: Boxes },
          { label: 'Exposed Tools', value: mcpInsights.exposedTools, icon: Activity },
          { label: 'Available Tools', value: mcpInsights.availableTools, icon: Plug },
          { label: 'Selected', value: mcpInsights.selected, icon: Check },
        ].map((item) => (
          <div key={item.label} className="telemetry-tile p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
              <item.icon size={16} className="text-brand-200" />
            </div>
            <div className="mt-2 text-3xl font-black text-white">{item.value}</div>
          </div>
        ))}
      </div>
      </div>

      {loadError && (
        <div className="mb-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{loadError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <Activity size={18} /> Local MCP Runtimes ({localRuntimes.length})
              </div>
              <div className="text-xs text-slate-500">Registry first. Open runtime details only when you need diagnostics, env keys, or bundle wiring.</div>
            </div>

            {localRuntimes.length === 0 && (
              <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-4">
                No local npm MCP runtimes discovered yet. Import one from the Tools page to run it on this platform.
              </div>
            )}

            <div className="space-y-3">
              {localRuntimes.map((runtime) => {
                const primaryBundle = runtime.bundles[0] || null;
                const endpoint = runtime.recommended_endpoint ? `${origin}${runtime.recommended_endpoint}` : '';
                return (
                  <div key={runtime.runtime_key} className="border border-emerald-200 rounded-xl p-4 bg-emerald-50/40 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{runtime.runtime_label}</div>
                        <div className="text-xs text-slate-600 mt-1">{runtime.runtime_mode}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="rounded-full bg-white/90 px-2 py-1 border border-emerald-100">{runtime.tool_count} tools</span>
                          <span className="rounded-full bg-white/90 px-2 py-1 border border-emerald-100">{runtime.exposed_tool_count} exposed tools</span>
                          <span className="rounded-full bg-white/90 px-2 py-1 border border-emerald-100">{runtime.bundle_count} bundles</span>
                          <span className="rounded-full bg-white/90 px-2 py-1 border border-emerald-100">{runtime.attached_agent_count} agents</span>
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Runtime Command</div>
                            <code className="mt-2 block whitespace-pre-wrap break-all text-slate-700">
                              {[runtime.raw_command, ...runtime.raw_args].filter(Boolean).join(' ')}
                            </code>
                          </div>
                          <div className="rounded-lg border border-white/80 bg-white/80 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Platform Exposure</div>
                            <div className="mt-2 text-slate-700">
                              {primaryBundle ? `Primary bundle: ${primaryBundle.name}` : 'No bundle created yet'}
                            </div>
                            {endpoint && (
                              <code className="mt-2 block whitespace-pre-wrap break-all text-slate-700">{endpoint}</code>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <details className="mt-4 group rounded-xl border border-white/80 bg-white/70 open:bg-white/80">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Runtime Details</div>
                          <div className="mt-1 text-xs text-slate-500">Env keys, bundles, attached agents, and the full runtime tool list.</div>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 group-open:hidden">Show details</span>
                        <span className="text-xs font-semibold text-emerald-700 hidden group-open:inline">Hide details</span>
                      </summary>
                      <div className="grid grid-cols-1 gap-3 border-t border-white/90 p-3 xl:grid-cols-3">
                        <div className="rounded-xl border border-white/80 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Env Keys</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runtime.env_keys.length > 0 ? runtime.env_keys.map((key) => (
                              <span key={key} className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700">{key}</span>
                            )) : (
                              <span className="text-xs text-slate-500">No env vars configured</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/80 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Bundles</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runtime.bundles.length > 0 ? runtime.bundles.map((bundle) => (
                              <span key={bundle.id} className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700">
                                {bundle.name}{bundle.is_exposed ? ' · exposed' : ' · hidden'}
                              </span>
                            )) : (
                              <span className="text-xs text-slate-500">Not bundled yet</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/80 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attached Agents</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runtime.agent_links.length > 0 ? runtime.agent_links.map((agent) => (
                              <span key={agent.id} className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700">{agent.name}</span>
                            )) : (
                              <span className="text-xs text-slate-500">Not attached yet</span>
                            )}
                          </div>
                        </div>
                        <div className="xl:col-span-3 rounded-xl border border-white/80 bg-white/80 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Runtime Tools</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runtime.tools.map((tool) => (
                              <span key={tool.id} className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700">
                                {formatDisplayedMcpToolName(tool.exposed_name || tool.mcp_tool_name || tool.name)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <Plug size={18} /> MCP Bundles ({bundles.length})
              </div>
              <div className="text-xs text-slate-500">Treat this like a published registry: inspect, connect, test, then open deeper details only when needed.</div>
            </div>
            <div className="relative mb-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={bundleSearch}
                onChange={(e) => setBundleSearch(e.target.value)}
                placeholder="Search bundles..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {bundles.length === 0 && (
              <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-4">
                No bundles yet. Select tools below and create your first bundle.
              </div>
            )}

            <div className="space-y-3">
              {pagedBundles.map((bundle) => {
                const streamable = `${origin}/mcp/bundle/${encodeURIComponent(bundle.slug)}`;
                const isExpanded = expandedBundleIds.includes(bundle.id);
                const visibleTools = isExpanded ? bundle.tools : bundle.tools.slice(0, 6);
                const hiddenCount = Math.max(bundle.tools.length - visibleTools.length, 0);
                return (
                  <div key={bundle.id} className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/30 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{bundle.name}</div>
                        <div className="text-xs text-slate-500">{bundle.description || 'No description'}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="rounded-full bg-white/80 px-2 py-1 border border-indigo-100">{bundle.tool_count} tools</span>
                          <span>•</span>
                          <span className={`rounded-full px-2 py-1 border ${bundle.is_exposed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                            {bundle.is_exposed ? 'Exposed' : 'Not Exposed'}
                          </span>
                          <span>•</span>
                          <code className="max-w-full truncate bg-white border border-indigo-200 px-2 py-0.5 rounded font-mono">{streamable}</code>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => openVersionHistory('bundle', bundle.id, bundle.name)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200"
                        >
                          Versions
                        </button>
                        <button
                          onClick={() => setConnectBundle(bundle)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200"
                        >
                          Connect
                        </button>
                        <button
                          onClick={() => void openBundleTester(bundle)}
                          disabled={bundleTestLoading && bundleTestLoadingId === bundle.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200"
                        >
                          {bundleTestLoading && bundleTestLoadingId === bundle.id ? 'Loading...' : 'Test Tools'}
                        </button>
                        <button
                          onClick={() => void openBundleAccess(bundle)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200"
                        >
                          Access
                        </button>
                        <button
                          onClick={() => toggleBundleExposure(bundle.id, !bundle.is_exposed)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${bundle.is_exposed ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}
                        >
                          {bundle.is_exposed ? 'Hide' : 'Expose'}
                        </button>
                        <button
                          onClick={() => void deleteBundle(bundle.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 border border-red-200 inline-flex items-center gap-1"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                    <details className="mt-4 group rounded-xl border border-white/70 bg-white/70 open:bg-white/85">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Included Tools</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {bundle.tools.length} exposed mappings inside this endpoint.
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-indigo-700 group-open:hidden">
                          {bundle.tools.length > 6 ? `Preview ${visibleTools.length} of ${bundle.tools.length}` : 'Show tools'}
                        </span>
                        <span className="text-xs font-semibold text-indigo-700 hidden group-open:inline">Hide tools</span>
                      </summary>
                      <div className="border-t border-white/90 px-3 pb-3 pt-1">
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(isExpanded ? bundle.tools : visibleTools).map((t) => (
                            <span key={t.tool_id} className="text-[11px] px-2 py-1 rounded bg-white border border-slate-200 text-slate-700">
                              {formatDisplayedMcpToolName(t.exposed_name || t.tool_name)}
                            </span>
                          ))}
                          {!isExpanded && hiddenCount > 0 && (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                toggleBundleExpanded(bundle.id);
                              }}
                              className="text-[11px] px-2 py-1 rounded border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700"
                            >
                              +{hiddenCount} more
                            </button>
                          )}
                        </div>
                        {bundle.tools.length > 6 && (
                          <div className="mt-3">
                            <button
                              onClick={() => toggleBundleExpanded(bundle.id)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              {isExpanded ? 'Show compact preview' : `Expand full tool list (${bundle.tools.length})`}
                            </button>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <Pagination
                page={bundlesPage}
                pageSize={bundlesPageSize}
                total={bundles.length}
                onPageChange={setBundlesPage}
                onPageSizeChange={setBundlesPageSize}
                pageSizeOptions={[5, 10, 20]}
              />
            </div>
          </div>

          <details className="bg-white rounded-xl border border-slate-200 p-6 group" open={selectedIds.length > 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-slate-800 font-semibold">Create Bundle From Selection</div>
                <div className="text-xs text-slate-500 mt-1">Select tools first, then open this builder to package and expose them together.</div>
              </div>
              <div className="text-xs font-semibold text-indigo-700">{selectedIds.length} selected</div>
            </summary>

            <div className="flex flex-wrap items-end gap-3 mb-6">
              <div className="flex gap-2">
                <button onClick={selectAll} className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">Select All</button>
                <button onClick={clearSelection} className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">Clear Selection</button>
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Expose Prefix</label>
                <input
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono border border-slate-300 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  value={bulkPrefix}
                  onChange={(e) => setBulkPrefix(e.target.value)}
                  placeholder="meta_ads"
                />
              </div>
              <button onClick={bulkExpose} disabled={selectedIds.length === 0} className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-50 shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all whitespace-nowrap">
                Expose names for selection
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Bundle Name</label>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  value={bundleName}
                  onChange={(e) => {
                    setBundleName(e.target.value);
                    setIsNameManual(true);
                  }}
                  placeholder="e.g. Finance Tools"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Bundle Slug</label>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  value={bundleSlug}
                  onChange={(e) => {
                    setBundleSlug(e.target.value);
                    setIsSlugManual(true);
                  }}
                  placeholder="finance_tools"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Description</label>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  value={bundleDescription}
                  onChange={(e) => {
                    setBundleDescription(e.target.value);
                    setIsDescriptionManual(true);
                  }}
                  placeholder="Briefly describe this bundle"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={createBundleFromSelection}
                disabled={selectedIds.length === 0}
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-60"
              >
                <Save size={14} /> Create Single MCP Bundle
              </button>
              {bundleStatus && <span className="text-xs text-slate-600">{bundleStatus}</span>}
            </div>
          </details>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-slate-800">Tools</div>
              <div className="text-xs text-slate-500">
                {filteredTools.length} visible • {selectedVisibleCount} selected in view
              </div>
            </div>
            <div className="relative mb-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Search exposed tools..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <select
                value={toolCategoryFilter}
                onChange={(e) => setToolCategoryFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All categories</option>
                {toolCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={toolTypeFilter}
                onChange={(e) => setToolTypeFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All types</option>
                {toolTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <select
                value={toolExposureFilter}
                onChange={(e) => setToolExposureFilter(e.target.value as 'all' | 'exposed' | 'available')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All exposure states</option>
                <option value="exposed">Exposed only</option>
                <option value="available">Not exposed yet</option>
              </select>
              <select
                value={toolSelectionFilter}
                onChange={(e) => setToolSelectionFilter(e.target.value as 'all' | 'selected')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All tools</option>
                <option value="selected">Selected only</option>
              </select>
            </div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => selectFilteredTools(visibleToolIds)}
                disabled={visibleToolIds.length === 0}
                className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Select filtered
              </button>
              <button
                onClick={() => clearFilteredSelection(visibleToolIds)}
                disabled={visibleToolIds.length === 0}
                className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Clear filtered
              </button>
              <button
                onClick={() => {
                  setToolCategoryFilter('all');
                  setToolTypeFilter('all');
                  setToolExposureFilter('all');
                  setToolSelectionFilter('all');
                  setToolSearch('');
                }}
                className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                Reset filters
              </button>
            </div>
            <div className="space-y-6">
              {filteredTools.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  No tools match the current filters. Adjust the type, exposure, or selection view.
                </div>
              )}
              {groupedRows.map(([category, groupTools]) => (
                <div key={category} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <div className="h-px flex-1 bg-slate-200"></div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{category}</span>
                    <div className="h-px flex-1 bg-slate-200"></div>
                  </div>
                  <div className="space-y-3">
                    {groupTools.map((row) => (
                      <div key={row.tool_id} className="p-4 rounded-xl border border-slate-200 hover:border-indigo-200 hover:shadow-sm transition-all bg-slate-50/30">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="font-semibold text-slate-900 truncate">{row.tool_name}</div>
                              <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
                                {getDisplayCategory(row)}
                              </span>
                              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {getDisplayType(row)}
                              </span>
                              {row.exposed_name && (
                                <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                  Exposed
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 line-clamp-1">{row.tool_description}</div>
                          </div>
                          <label className="text-xs text-slate-500 flex items-center gap-2 cursor-pointer bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedIds.includes(row.tool_id)}
                              onChange={() => toggleSelect(row.tool_id)}
                            />
                            Select
                          </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <input
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                              value={row.exposed_name || ''}
                              onChange={(e) => updateRow(row.tool_id, { exposed_name: e.target.value })}
                              placeholder={compactToolAlias(row.tool_name, row.tool_name)}
                            />
                          <div className="flex items-center gap-2">
                            <input
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                              value={row.exposed_description || ''}
                              onChange={(e) => updateRow(row.tool_id, { exposed_description: e.target.value })}
                              placeholder={row.tool_description || 'Optional description'}
                            />
                            <button
                              onClick={() => saveExposure(row, true)}
                              className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all whitespace-nowrap"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => openVersionHistory('tool', row.tool_id, row.tool_name)}
                              className="px-3 py-2 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Versions
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Pagination
                page={toolsPage}
                pageSize={toolsPageSize}
                total={filteredTools.length}
                onPageChange={setToolsPage}
                onPageSizeChange={setToolsPageSize}
                pageSizeOptions={[12, 24, 36, 60]}
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          <div>
            <div className="text-slate-800 font-semibold mb-1">MCP Control Center</div>
            <p className="text-xs text-slate-500">Keep auth and base endpoints handy here. Open deeper controls only when you are publishing or validating the surface.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-slate-800 font-semibold mb-2"><Key size={18} /> Auth (Optional)</div>
            <p className="text-xs text-slate-500 mb-3">If set, clients must send this token as Bearer or X-API-Key.</p>
            <div className="mb-2">
              <label className="block text-[11px] text-slate-600 mb-1">Credential Category</label>
              <select
                className="w-full ui-select mb-2"
                value={credentialCategory}
                onChange={(e) => {
                  setCredentialCategory(e.target.value);
                  setSelectedCredentialId('');
                }}
              >
                <option value="mcp">MCP</option>
                <option value="general">General</option>
                <option value="http">HTTP Tools</option>
                <option value="llm">LLM</option>
                <option value="database">Database</option>
              </select>
              <label className="block text-[11px] text-slate-600 mb-1">Saved Credential (Optional)</label>
              <select
                className="w-full ui-select"
                value={selectedCredentialId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedCredentialId(next);
                }}
              >
                <option value="">None</option>
                {credentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    #{cred.id} {cred.name || cred.provider} ({cred.provider})
                  </option>
                ))}
              </select>
            </div>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Leave empty to disable auth"
            />
            <button onClick={saveAuthToken} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white">
              <Save size={14} /> Save Auth
            </button>
            {tokenSaved && <div className="mt-2 text-xs text-emerald-700">Saved</div>}
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <div className="text-slate-800 font-semibold">Connection & Validation</div>
                <div className="text-xs text-slate-500 mt-1">Base endpoints and a quick MCP server validation path.</div>
              </div>
              <span className="text-xs font-semibold text-slate-600 group-open:hidden">Show</span>
              <span className="text-xs font-semibold text-slate-600 hidden group-open:inline">Hide</span>
            </summary>
            <div className="pt-4 space-y-5">
              <div>
                <div className="text-slate-800 font-semibold mb-2">Base Endpoints</div>
                <div className="text-xs text-slate-500 mb-2">Global Streamable</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-slate-100 px-2 py-1 rounded w-full truncate">{streamableUrl}</code>
                  <button onClick={() => copy(streamableUrl)} className="text-slate-500 hover:text-slate-700">{copied === streamableUrl ? <Check size={14} /> : <Copy size={14} />}</button>
                </div>
                <div className="text-xs text-slate-500 mt-3 mb-2">Global SSE</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-slate-100 px-2 py-1 rounded w-full truncate">{sseUrl}</code>
                  <button onClick={() => copy(sseUrl)} className="text-slate-500 hover:text-slate-700">{copied === sseUrl ? <Check size={14} /> : <Copy size={14} />}</button>
                </div>
              </div>

              <div>
                <button
                  onClick={runServerTest}
                  disabled={serverTestStatus === 'testing'}
                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-60"
                >
                  {serverTestStatus === 'testing' ? 'Testing...' : 'Test MCP Server'}
                </button>
                {serverTestMessage && (
                  <div className={`mt-2 text-xs ${serverTestStatus === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {serverTestMessage}
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>
      </div>

      {connectBundle && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Connect to {connectBundle.name}</div>
                <div className="text-xs text-slate-500">{connectBundle.tool_count} tools exposed in one MCP endpoint</div>
              </div>
              <button onClick={() => setConnectBundle(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5 text-sm">
              {(() => {
                const serverKey = slugify(connectBundle.slug || connectBundle.name || 'mcp_bundle');
                const scopedStreamableUrl = `${origin}/mcp/bundle/${encodeURIComponent(connectBundle.slug)}`;
                const scopedSseUrl = `${origin}/mcp/bundle/${encodeURIComponent(connectBundle.slug)}/sse`;
                const config = `{\n  \"mcpServers\": {\n    \"${serverKey}\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-sse\", \"--url\", \"${scopedSseUrl}\"]\n    }\n  }\n}`;
                return (
                  <>
                    <div>
                      <div className="text-xs text-slate-500 mb-2">Streamable HTTP (recommended)</div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded w-full truncate">{scopedStreamableUrl}</code>
                        <button onClick={() => copy(scopedStreamableUrl)} className="text-slate-500 hover:text-slate-700">{copied === scopedStreamableUrl ? <Check size={14} /> : <Copy size={14} />}</button>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-2">claude_desktop_config.json</div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-slate-500">Copy config</div>
                        <button onClick={() => copy(config)} className="text-slate-500 hover:text-slate-700 text-xs inline-flex items-center gap-1">
                          {copied.includes('mcpServers') ? <Check size={14} /> : <Copy size={14} />} Copy
                        </button>
                      </div>
                      <pre className="text-[11px] bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{config}</pre>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-2">Included Tools</div>
                      <div className="flex flex-wrap gap-2">
                        {connectBundle.tools.map((tool) => (
                          <span key={tool.tool_id} className="text-[11px] px-2 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700">
                            {formatDisplayedMcpToolName(tool.exposed_name || tool.tool_name)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {bundleAccessState && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Bundle Access</div>
                <div className="text-xs text-slate-500">{bundleAccessState.bundle.name}</div>
              </div>
              <button onClick={() => setBundleAccessState(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Owner User</div>
                  <div className="text-sm font-semibold text-slate-900 mt-1">{bundleAccessState.data?.owner?.owner_user_id || 'Unknown'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Owner Org</div>
                  <div className="text-sm font-semibold text-slate-900 mt-1">{bundleAccessState.data?.owner?.owner_org_id || 'None'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Visibility</div>
                  <select
                    value={bundleAccessState.visibility}
                    onChange={(e) => setBundleAccessState((prev) => prev ? { ...prev, visibility: e.target.value === 'org' ? 'org' : 'private' } : prev)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="private">Private</option>
                    <option value="org">Organization</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Shared User IDs</label>
                  <textarea
                    value={bundleAccessState.sharedUserIdsText}
                    onChange={(e) => setBundleAccessState((prev) => prev ? { ...prev, sharedUserIdsText: e.target.value } : prev)}
                    placeholder="user_123, user_456"
                    className="w-full min-h-[84px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Shared Org IDs</label>
                  <textarea
                    value={bundleAccessState.sharedOrgIdsText}
                    onChange={(e) => setBundleAccessState((prev) => prev ? { ...prev, sharedOrgIdsText: e.target.value } : prev)}
                    placeholder="org_123, org_456"
                    className="w-full min-h-[84px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              {bundleAccessState.loading && <div className="text-sm text-slate-500">Loading access…</div>}
              {bundleAccessState.error && <div className="text-sm text-red-600">{bundleAccessState.error}</div>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setBundleAccessState(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Close</button>
                <button
                  onClick={() => void saveBundleAccess()}
                  disabled={bundleAccessState.loading || bundleAccessState.saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {bundleAccessState.saving ? 'Saving…' : 'Save Access'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVersionsModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Version History</div>
                <div className="text-xs text-slate-500">{showVersionsModal.name}</div>
              </div>
              <button onClick={() => setShowVersionsModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              {showVersionsModal.type === 'bundle' ? bundleVersions.map((version, index) => {
                const toolCount = getBundleVersionToolIds(version.tool_ids).length;
                const delta = getBundleVersionDelta(bundleVersions, index);
                return (
                <div key={version.id} className="rounded-xl border border-slate-200 p-4 bg-slate-50/70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">v{version.version_number} • {version.change_kind}</div>
                      <div className="text-xs text-slate-500 mt-1">{new Date(version.created_at).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => void restoreMcpVersion('bundle', showVersionsModal.id, version.id)}
                      disabled={restoringVersionId === version.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white disabled:opacity-60"
                    >
                      <RotateCcw size={12} />
                      {restoringVersionId === version.id ? 'Restoring...' : 'Rollback'}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>{version.name} • {version.slug}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{toolCount} tools</span>
                    {delta && (delta.added > 0 || delta.removed > 0) && (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                        {delta.added > 0 ? `+${delta.added}` : '+0'} / {delta.removed > 0 ? `-${delta.removed}` : '-0'}
                      </span>
                    )}
                  </div>
                </div>
                );
              }) : exposedToolVersions.map((version, index) => {
                const previous = exposedToolVersions[index + 1];
                const stateChanged = previous ? previous.is_exposed !== version.is_exposed : false;
                const nameChanged = previous ? (previous.exposed_name || '') !== (version.exposed_name || '') : false;
                return (
                <div key={version.id} className="rounded-xl border border-slate-200 p-4 bg-slate-50/70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">v{version.version_number} • {version.change_kind}</div>
                      <div className="text-xs text-slate-500 mt-1">{new Date(version.created_at).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => void restoreMcpVersion('tool', showVersionsModal.id, version.id)}
                      disabled={restoringVersionId === version.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white disabled:opacity-60"
                    >
                      <RotateCcw size={12} />
                      {restoringVersionId === version.id ? 'Restoring...' : 'Rollback'}
                    </button>
                  </div>
                  <div className="text-xs text-slate-600 mt-2">
                    {version.is_exposed ? (version.exposed_name || 'Exposed') : 'Disabled'}{version.description ? ` • ${version.description}` : ''}
                  </div>
                  {(stateChanged || nameChanged) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      {stateChanged && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Exposure changed</span>}
                      {nameChanged && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">Name changed</span>}
                    </div>
                  )}
                </div>
                );
              })}
              {showVersionsModal.type === 'bundle' && bundleVersions.length === 0 && <div className="text-sm text-slate-500">No bundle versions yet.</div>}
              {showVersionsModal.type === 'tool' && exposedToolVersions.length === 0 && <div className="text-sm text-slate-500">No exposure versions yet.</div>}
            </div>
          </div>
        </div>
      )}

      {bundleDeleteState && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">Delete Bundle Safely</div>
              <button onClick={() => setBundleDeleteState(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-slate-700">{bundleDeleteState.message || 'This bundle is still linked to agents.'}</div>
              <div className="text-xs text-slate-500">
                Force delete will remove the bundle and unlink it from attached agents.
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setBundleDeleteState(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={() => void deleteBundle(bundleDeleteState.bundle.id, true)} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Force Delete</button>
            </div>
          </div>
        </div>
      )}

      {bundleTestState && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-4xl rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Test Bundle Tools</div>
                <div className="text-xs text-slate-500">{bundleTestState.bundle.name} · {bundleTestState.bundle.slug}</div>
              </div>
              <button onClick={() => setBundleTestState(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-5 max-h-[75vh] overflow-y-auto">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Tools</div>
                {bundleTestState.tools.map((tool) => (
                  <button
                    key={tool.tool_id}
                    onClick={() => {
                      setBundleTestSelectedToolId(String(tool.tool_id));
                      setBundleTestValues({});
                      setBundleTestError('');
                      setBundleTestResult('');
                    }}
                    className={`w-full text-left rounded-xl border px-3 py-3 ${bundleTestSelectedToolId === String(tool.tool_id) ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="text-sm font-semibold text-slate-900">{tool.exposed_name || tool.tool_name}</div>
                    <div className="text-xs text-slate-500 mt-1">{tool.description || 'No description'}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                {selectedBundleTestTool ? (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold text-slate-900">{selectedBundleTestTool.exposed_name || selectedBundleTestTool.tool_name}</div>
                      <div className="text-xs text-slate-500 mt-1">{selectedBundleTestTool.description || 'No description'}</div>
                    </div>

                    {Object.entries(selectedBundleTestTool.inputSchema?.properties || {}).length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(Object.entries(selectedBundleTestTool.inputSchema?.properties || {}) as Array<[string, { type?: string; description?: string }]>).map(([key, property]) => {
                          const isRequired = (selectedBundleTestTool.inputSchema?.required || []).includes(key);
                          return (
                            <div key={key}>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                {key} {isRequired && <span className="text-red-500">*</span>}
                              </label>
                              <input
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-cyan-500"
                                value={bundleTestValues[key] || ''}
                                onChange={(e) => setBundleTestValues((prev) => ({ ...prev, [key]: e.target.value }))}
                                placeholder={
                                  property?.type === 'object' ? '{"key":"value"}'
                                  : property?.type === 'array' ? '["item"]'
                                  : property?.type === 'boolean' ? 'true'
                                  : property?.type === 'number' || property?.type === 'integer' ? '123'
                                  : `Enter ${key}`
                                }
                              />
                              <div className="mt-1 text-xs text-slate-500">
                                {(property?.type || 'string')}{property?.description ? ` · ${property.description}` : ''}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg p-4">
                        This tool does not declare structured inputs. Run it directly if it accepts empty args.
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => void runBundleToolTest()}
                        disabled={bundleTestRunning}
                        className="px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-60 text-sm font-semibold"
                      >
                        {bundleTestRunning ? 'Running...' : 'Run Tool Test'}
                      </button>
                      {bundleTestError && <div className="text-sm text-red-600">{bundleTestError}</div>}
                    </div>

                    {bundleTestResult && (
                      <pre className="rounded-xl bg-slate-950 text-slate-100 p-4 text-xs overflow-auto whitespace-pre-wrap">
                        {bundleTestResult}
                      </pre>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-slate-500">Select a tool to start testing.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
