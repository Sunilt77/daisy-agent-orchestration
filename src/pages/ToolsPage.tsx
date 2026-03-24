import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Wrench, Code, Globe, Terminal, Server, X, Sparkles, Search, Activity, Link2, Boxes } from 'lucide-react';
import Pagination from '../components/Pagination';
import { loadPersisted, savePersisted } from '../utils/persistence';

interface Tool {
  id: number;
  name: string;
  description: string;
  category: string;
  type: string;
  config: string;
  version?: number;
  updated_at?: string;
  linkages?: {
    agents?: Array<{ id: number; name: string }>;
    agents_count?: number;
    mcp_exposed?: { exposed_name?: string; description?: string; updated_at?: string } | null;
    bundles?: Array<{ id: number; name: string; slug: string }>;
    bundles_count?: number;
  };
}

interface ToolVersion {
  id: number;
  tool_id: number;
  version_number: number;
  name: string;
  description: string;
  category: string;
  type: string;
  config: string;
  change_kind: string;
  created_at: string;
}

interface ToolUsageExecution {
  id: number;
  tool_name: string;
  status: string;
  duration_ms?: number | null;
  created_at: string;
  error?: string | null;
  agent_execution_id?: number | null;
  agent_id?: number | null;
  agent_name?: string | null;
}

interface ToolUsageSummary {
  total_runs: number;
  failed_runs: number;
  completed_runs: number;
  avg_duration_ms?: number | null;
  last_used_at?: string | null;
  recent_executions: ToolUsageExecution[];
}

interface ToolDependencies {
  agents: Array<{ id: number; name: string }>;
  agents_count: number;
  mcp_exposed?: { exposed_name?: string; description?: string; updated_at?: string } | null;
  bundles: Array<{ id: number; name: string; slug: string }>;
  bundles_count: number;
  mcp_agents: Array<{ id: number; name: string }>;
  mcp_agents_count: number;
}

interface Agent {
  id: number;
  name: string;
  role: string;
}

interface CredentialOption {
  id: number;
  provider: string;
  name?: string;
  key_name?: string;
  category?: string;
  api_key?: string;
}

interface HttpHeader {
  key: string;
  value: string;
  isVariable?: boolean;
}

interface HttpAuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'apiKey';
  token: string;
  username: string;
  password: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query';
  credentialId: string;
}

type HttpArgType = 'string' | 'number' | 'boolean' | 'object' | 'array';

function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && !inSingle) {
      escape = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function extractTemplateVars(text: string): string[] {
  const vars: string[] = [];
  for (const match of text.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
    const name = String(match[1] || '').trim().replace(/^args\./, '');
    if (name) vars.push(name);
  }
  return vars;
}

function normalizeArgName(input: string): string {
  return String(input || '')
    .trim()
    .replace(/^args\./, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getDefaultArgValue(type: HttpArgType): any {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return true;
    case 'object': return {};
    case 'array': return [];
    default: return '';
  }
}

function buildArgsTemplate(args: string[], argTypes: Record<string, HttpArgType>) {
  const out: Record<string, any> = {};
  for (const arg of args) {
    const key = normalizeArgName(arg);
    if (!key) continue;
    out[key] = getDefaultArgValue(argTypes[key] || 'string');
  }
  return out;
}

function parseCurlCommand(command: string): {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
  formData: HttpHeader[];
  bodyMode: 'json' | 'form-data';
  requiredArgs: string[];
} {
  const tokens = tokenizeCurl(command.replace(/\\\n/g, ' '));
  if (!tokens.length || tokens[0] !== 'curl') {
    throw new Error('Paste a curl command that starts with "curl".');
  }

  let method = 'GET';
  let url = '';
  const headers: HttpHeader[] = [];
  let body = '';
  const formData: HttpHeader[] = [];
  let bodyMode: 'json' | 'form-data' = 'json';
  const required = new Set<string>();

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') {
      method = (tokens[i + 1] || '').toUpperCase();
      i++;
      continue;
    }
    if (t === '-H' || t === '--header') {
      const header = tokens[i + 1] || '';
      const idx = header.indexOf(':');
      if (idx > -1) {
        const val = header.slice(idx + 1).trim();
        headers.push({ key: header.slice(0, idx).trim(), value: val, isVariable: extractTemplateVars(val).length > 0 });
      }
      i++;
      continue;
    }
    if (t === '--url') {
      url = tokens[i + 1] || '';
      i++;
      continue;
    }
    if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      body = tokens[i + 1] || '';
      if (method === 'GET') method = 'POST';
      i++;
      continue;
    }
    if (t === '-F' || t === '--form') {
      const form = tokens[i + 1] || '';
      const idx = form.indexOf('=');
      if (idx > -1) {
        const key = form.slice(0, idx).trim();
        const value = form.slice(idx + 1).trim();
        const cleanValue = value.startsWith('@') ? value.slice(1) : value;
        formData.push({ key, value: cleanValue, isVariable: extractTemplateVars(cleanValue).length > 0 });
        if (key) required.add(key);
      }
      bodyMode = 'form-data';
      if (method === 'GET') method = 'POST';
      i++;
      continue;
    }
    if (!t.startsWith('-') && !url && (t.startsWith('http://') || t.startsWith('https://'))) {
      url = t;
      continue;
    }
  }

  if (!url) throw new Error('Could not find a URL in the curl command.');
  for (const match of url.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    required.add(match[1].replace(/^args\./, ''));
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((_v, k) => required.add(k));
  } catch {}
  if (body && body.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(body);
      Object.keys(obj || {}).forEach((k) => required.add(k));
    } catch {}
  }
  return {
    method,
    url,
    headers: headers.length ? headers : [{ key: '', value: '', isVariable: false }],
    body,
    formData: formData.length ? formData : [{ key: '', value: '', isVariable: false }],
    bodyMode,
    requiredArgs: Array.from(required),
  };
}

async function safeJson(res: Response) {
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export default function ToolsPage() {
  const TOOLS_UI_KEY = 'tools_ui_state_v1';
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<number | 'new' | null>(null);
  const [toolsPage, setToolsPage] = useState(1);
  const [toolsPageSize, setToolsPageSize] = useState(15);
  const [toolSearch, setToolSearch] = useState('');
  const [toolVersions, setToolVersions] = useState<ToolVersion[]>([]);
  const [toolUsage, setToolUsage] = useState<ToolUsageSummary | null>(null);
  const [toolDependencies, setToolDependencies] = useState<ToolDependencies | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteDependencyError, setDeleteDependencyError] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'General',
    type: 'custom',
    config: '{}'
  });

  const [providers, setProviders] = useState<{id: string, name: string, type: string}[]>([
    { id: 'google', name: 'Google Gemini', type: 'google' },
    { id: 'openai', name: 'OpenAI', type: 'openai' },
    { id: 'anthropic', name: 'Anthropic', type: 'anthropic' }
  ]);
  const [availableModels, setAvailableModels] = useState<{ id: string, name: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [httpCredentials, setHttpCredentials] = useState<CredentialOption[]>([]);
  const [mcpCredentials, setMcpCredentials] = useState<CredentialOption[]>([]);
  const [httpCredentialCategory, setHttpCredentialCategory] = useState('http');
  const [mcpCredentialCategory, setMcpCredentialCategory] = useState('mcp');

  // Auto-build state
  const [showAutoBuild, setShowAutoBuild] = useState(false);
  const [autoBuildGoal, setAutoBuildGoal] = useState('');
  const [autoBuildProvider, setAutoBuildProvider] = useState('google');
  const [autoBuildModel, setAutoBuildModel] = useState('gemini-2.5-flash-latest');
  const [autoBuildAgentIds, setAutoBuildAgentIds] = useState<number[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState('');
  
  // Dynamic config states
  const [pythonCode, setPythonCode] = useState('print("Hello World")');
  const [httpConfig, setHttpConfig] = useState({ method: 'GET', url: '', body: '' });
  const [httpHeaders, setHttpHeaders] = useState<HttpHeader[]>([{ key: '', value: '', isVariable: false }]);
  const [httpFormData, setHttpFormData] = useState<HttpHeader[]>([{ key: '', value: '', isVariable: false }]);
  const [httpBodyMode, setHttpBodyMode] = useState<'json' | 'form-data'>('json');
  const [httpRequiredArgs, setHttpRequiredArgs] = useState<string[]>([]);
  const [httpArgTypes, setHttpArgTypes] = useState<Record<string, HttpArgType>>({});
  const [httpAuth, setHttpAuth] = useState<HttpAuthConfig>({
    type: 'none',
    token: '',
    username: '',
    password: '',
    apiKeyName: 'X-API-Key',
    apiKeyValue: '',
    apiKeyIn: 'header',
    credentialId: '',
  });
  const [curlImportText, setCurlImportText] = useState('');
  const [curlImportError, setCurlImportError] = useState<string | null>(null);
  const [showCurlImportModal, setShowCurlImportModal] = useState(false);
  const [mcpImportText, setMcpImportText] = useState('');
  const [mcpImportError, setMcpImportError] = useState<string | null>(null);
  const [mcpImportLoading, setMcpImportLoading] = useState(false);
  const [mcpImportSuccess, setMcpImportSuccess] = useState<string | null>(null);
  const [httpTestArgs, setHttpTestArgs] = useState('{"query":"example"}');
  const [httpTestResult, setHttpTestResult] = useState<string | null>(null);
  const [httpTestError, setHttpTestError] = useState<string | null>(null);
  const [httpTestLoading, setHttpTestLoading] = useState(false);
  const [mcpConfig, setMcpConfig] = useState({
    serverUrl: '',
    apiKey: '',
    transportType: 'auto' as 'auto' | 'sse' | 'streamable' | 'stdio',
    customHeaders: '', // JSON string of extra headers
    credentialId: ''
  });
  const [mcpTestStatus, setMcpTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [mcpTestMessage, setMcpTestMessage] = useState('');
  const [mcpUrlWarning, setMcpUrlWarning] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [stateReady, setStateReady] = useState(false);

  useEffect(() => {
    const persisted = loadPersisted<any>(TOOLS_UI_KEY, {});
    if (persisted && typeof persisted === 'object') {
      if (persisted.selectedToolId !== undefined) setSelectedToolId(persisted.selectedToolId);
      if (typeof persisted.toolsPage === 'number') setToolsPage(persisted.toolsPage);
      if (typeof persisted.toolsPageSize === 'number') setToolsPageSize(persisted.toolsPageSize);
      if (typeof persisted.toolSearch === 'string') setToolSearch(persisted.toolSearch);
      if (typeof persisted.categoryFilter === 'string') setCategoryFilter(persisted.categoryFilter);
      if (typeof persisted.typeFilter === 'string') setTypeFilter(persisted.typeFilter);
      if (persisted.formData) setFormData((prev) => ({ ...prev, ...persisted.formData }));
      if (typeof persisted.pythonCode === 'string') setPythonCode(persisted.pythonCode);
      if (persisted.httpConfig) setHttpConfig((prev) => ({ ...prev, ...persisted.httpConfig }));
      if (Array.isArray(persisted.httpHeaders)) setHttpHeaders(persisted.httpHeaders);
      if (Array.isArray(persisted.httpFormData)) setHttpFormData(persisted.httpFormData);
      if (persisted.httpBodyMode === 'json' || persisted.httpBodyMode === 'form-data') setHttpBodyMode(persisted.httpBodyMode);
      if (Array.isArray(persisted.httpRequiredArgs)) setHttpRequiredArgs(persisted.httpRequiredArgs);
      if (persisted.httpArgTypes && typeof persisted.httpArgTypes === 'object') setHttpArgTypes(persisted.httpArgTypes);
      if (persisted.httpAuth) setHttpAuth((prev) => ({ ...prev, ...persisted.httpAuth }));
      if (persisted.mcpConfig) setMcpConfig((prev) => ({ ...prev, ...persisted.mcpConfig }));
      if (typeof persisted.httpTestArgs === 'string') setHttpTestArgs(persisted.httpTestArgs);
      if (typeof persisted.curlImportText === 'string') setCurlImportText(persisted.curlImportText);
    }
    setStateReady(true);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    savePersisted(TOOLS_UI_KEY, {
      selectedToolId,
      toolsPage,
      toolsPageSize,
      toolSearch,
      categoryFilter,
      typeFilter,
      formData,
      pythonCode,
      httpConfig,
      httpHeaders,
      httpFormData,
      httpBodyMode,
      httpRequiredArgs,
      httpArgTypes,
      httpAuth,
      mcpConfig,
      httpTestArgs,
      curlImportText,
    });
  }, [stateReady, selectedToolId, toolsPage, toolsPageSize, toolSearch, categoryFilter, typeFilter, formData, pythonCode, httpConfig, httpHeaders, httpFormData, httpBodyMode, httpRequiredArgs, httpArgTypes, httpAuth, mcpConfig, httpTestArgs, curlImportText]);

  useEffect(() => {
    fetchTools();
    fetchProviders();
    fetchAgents();
    fetchCredentials('http', setHttpCredentials);
    fetchCredentials('mcp', setMcpCredentials);
  }, []);

  const fetchCredentials = async (category: string, setter: (rows: CredentialOption[]) => void) => {
    try {
      const query = category ? `?category=${encodeURIComponent(category)}` : '';
      const res = await fetch(`/api/credentials${query}`);
      const data = await safeJson(res);
      if (Array.isArray(data)) setter(data);
      else setter([]);
    } catch {
      setter([]);
    }
  };

  useEffect(() => {
    fetchCredentials(httpCredentialCategory, setHttpCredentials);
  }, [httpCredentialCategory]);

  useEffect(() => {
    fetchCredentials(mcpCredentialCategory, setMcpCredentials);
  }, [mcpCredentialCategory]);

  useEffect(() => {
    if (showAutoBuild) {
      fetchModelsForProvider(autoBuildProvider);
    }
  }, [showAutoBuild, autoBuildProvider]);

  useEffect(() => {
    setToolsPage(1);
  }, [tools.length]);

  useEffect(() => {
    setToolsPage(1);
  }, [toolSearch, categoryFilter, typeFilter]);

  useEffect(() => {
    setHttpArgTypes((prev) => {
      const next: Record<string, HttpArgType> = {};
      for (const arg of httpRequiredArgs) {
        const key = normalizeArgName(arg);
        if (!key) continue;
        next[key] = prev[key] || 'string';
      }
      return next;
    });
  }, [httpRequiredArgs]);

  useEffect(() => {
    if (formData.type !== 'http') return;
    setHttpTestArgs(JSON.stringify(buildArgsTemplate(httpRequiredArgs, httpArgTypes), null, 2));
  }, [formData.type, httpRequiredArgs, httpArgTypes]);

  const categories = useMemo(() => {
    const cats = new Set(tools.map(t => t.category || 'General'));
    return ['All', ...Array.from(cats).sort()];
  }, [tools]);

  const toolTypes = useMemo(() => {
    const types = new Set(tools.map(t => t.type || 'custom'));
    return ['All', ...Array.from(types).sort()];
  }, [tools]);

  const filteredTools = useMemo(() => {
    let list = tools;
    const query = toolSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((t) =>
        [t.name, t.description, t.category, t.type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      );
    }
    if (categoryFilter !== 'All') {
      list = list.filter(t => (t.category || 'General') === categoryFilter);
    }
    if (typeFilter !== 'All') {
      list = list.filter(t => (t.type || 'custom') === typeFilter);
    }
    return [...list].sort((a, b) => {
      const catA = (a.category || 'General').toLowerCase();
      const catB = (b.category || 'General').toLowerCase();
      if (catA < catB) return -1;
      if (catA > catB) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [tools, categoryFilter]);

  const pagedTools = useMemo(() => {
    const start = (toolsPage - 1) * toolsPageSize;
    return filteredTools.slice(start, start + toolsPageSize);
  }, [filteredTools, toolsPage, toolsPageSize]);

  const selectedTool = useMemo(() => {
    if (typeof selectedToolId !== 'number') return null;
    return tools.find((t) => t.id === selectedToolId) || null;
  }, [tools, selectedToolId]);

  useEffect(() => {
    const toolId = typeof selectedToolId === 'number' ? selectedToolId : null;
    if (!toolId) {
      setToolVersions([]);
      setToolUsage(null);
      setToolDependencies(null);
      return;
    }
    const loadToolMeta = async () => {
      const [versionsRes, usageRes, depsRes] = await Promise.all([
        fetch(`/api/tools/${toolId}/versions`),
        fetch(`/api/tools/${toolId}/usage`),
        fetch(`/api/tools/${toolId}/dependencies`),
      ]);
      const versionsData = await safeJson(versionsRes);
      const usageData = await safeJson(usageRes);
      const depsData = await safeJson(depsRes);
      setToolVersions(Array.isArray(versionsData?.versions) ? versionsData.versions : []);
      setToolUsage(usageData?.usage || null);
      setToolDependencies(depsData?.dependencies || null);
    };
    void loadToolMeta();
  }, [selectedToolId]);

  const selectedHttpCredential = useMemo(
    () => httpCredentials.find(c => String(c.id) === httpAuth.credentialId),
    [httpCredentials, httpAuth.credentialId]
  );

  const fetchTools = async () => {
    const res = await fetch('/api/tools');
    const data = await safeJson(res);
    if (data) setTools(data);
    return data as any;
  };

  const refreshSelectedTool = async (toolId: number) => {
    const list = await fetchTools();
    if (Array.isArray(list)) {
      const next = list.find((t: any) => Number(t.id) === Number(toolId));
      if (next) handleSelectTool(next);
    }
  };

  const fetchProviders = () => {
    fetch('/api/providers')
      .then(res => safeJson(res))
      .then(data => {
        const customProviders = data.map((p: any) => ({ id: p.name, name: p.name, type: p.provider }));
        setProviders(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newProviders = customProviders.filter((p: any) => !existingIds.has(p.id));
          return [...prev, ...newProviders];
        });
      });
  };

  const fetchAgents = () => {
    fetch('/api/agents')
      .then(res => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data.map((a: any) => ({ id: a.id, name: a.name, role: a.role })) : [];
        setAgents(list);
      });
  };

  const fetchModelsForProvider = async (provider: string) => {
    try {
      setIsLoadingModels(true);
      const res = await fetch(`/api/providers/${provider}/models`);
      if (res.ok) {
        const models = await res.json();
        setAvailableModels(models);
        if (models.length > 0 && !models.find((m: any) => m.id === autoBuildModel)) {
          setAutoBuildModel(models[0].id);
        }
      } else {
        setAvailableModels([
          { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' }
        ]);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const toggleAutoBuildAgent = (agentId: number) => {
    setAutoBuildAgentIds(prev => prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]);
  };

  const autoBuildTools = async () => {
    if (!autoBuildGoal) return;
    setIsBuilding(true);
    setBuildError('');
    try {
      const res = await fetch('/api/tools/autobuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: autoBuildGoal,
          provider: autoBuildProvider,
          model: autoBuildModel,
          agent_ids: autoBuildAgentIds
        })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(data.error || text || 'Failed to auto-build tools');
      setShowAutoBuild(false);
      setAutoBuildGoal('');
      setAutoBuildAgentIds([]);
      fetchTools();
    } catch (e: any) {
      setBuildError(e.message || 'Failed to auto-build tools');
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSelectTool = (tool: Tool) => {
      setSelectedToolId(tool.id);
      setFormData({
          name: tool.name,
          description: tool.description,
          category: tool.category || 'General',
          type: tool.type,
          config: tool.config
      });
      setJsonError(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      try {
          const cfg = JSON.parse(tool.config);
          if (tool.type === 'python') {
              setPythonCode(cfg.code || '');
          } else if (tool.type === 'http') {
              setHttpConfig({ method: cfg.method || 'GET', url: cfg.url || '', body: cfg.body || '' });
              const formObj = cfg.formData || {};
              const formArray = Object.keys(formObj).map(k => {
                const value = String(formObj[k] ?? '');
                return { key: k, value, isVariable: extractTemplateVars(value).length > 0 };
              });
              setHttpFormData(formArray.length ? formArray : [{ key: '', value: '', isVariable: false }]);
              setHttpBodyMode(cfg.bodyMode === 'form-data' ? 'form-data' : 'json');
              setHttpRequiredArgs(Array.isArray(cfg.requiredArgs) ? cfg.requiredArgs.map((x: any) => String(x)) : []);
              setHttpArgTypes(
                cfg.argSchema && typeof cfg.argSchema === 'object'
                  ? Object.fromEntries(
                      Object.entries(cfg.argSchema)
                        .map(([k, v]) => [normalizeArgName(k), String(v) as HttpArgType])
                        .filter(([k]) => !!k)
                    )
                  : {}
              );
              setHttpAuth({
                  type: cfg.auth?.type || 'none',
                  token: cfg.auth?.token || '',
                  username: cfg.auth?.username || '',
                  password: cfg.auth?.password || '',
                  apiKeyName: cfg.auth?.apiKeyName || 'X-API-Key',
                  apiKeyValue: cfg.auth?.apiKeyValue || '',
                  apiKeyIn: cfg.auth?.apiKeyIn === 'query' ? 'query' : 'header',
                  credentialId: cfg.auth?.credentialId != null ? String(cfg.auth.credentialId) : '',
              });
              
              const headersObj = cfg.headers || {};
              const headersArray = Object.keys(headersObj).map(k => {
                const value = headersObj[k];
                return { key: k, value, isVariable: extractTemplateVars(String(value)).length > 0 };
              });
              if (headersArray.length === 0) headersArray.push({ key: '', value: '', isVariable: false });
              setHttpHeaders(headersArray);
              setCurlImportText('');
              setCurlImportError(null);
              setHttpTestResult(null);
              setHttpTestError(null);
          } else if (tool.type === 'mcp') {
              setMcpConfig({
                  serverUrl: cfg.serverUrl || '',
                  apiKey: cfg.apiKey || '',
                  transportType: cfg.transportType || 'auto',
                  customHeaders: cfg.customHeaders ? JSON.stringify(cfg.customHeaders, null, 2) : '',
                  credentialId: cfg.credentialId != null ? String(cfg.credentialId) : '',
              });
          }
      } catch (e) {
          // Fallback if config is invalid JSON
      }
  };

  const handleCreateNew = () => {
      setSelectedToolId('new');
      setFormData({ name: '', description: '', category: 'General', type: 'custom', config: '{}' });
      setPythonCode('print("Hello World")');
      setHttpConfig({ method: 'GET', url: '', body: '' });
      setHttpHeaders([{ key: '', value: '', isVariable: false }]);
      setHttpFormData([{ key: '', value: '', isVariable: false }]);
      setHttpBodyMode('json');
      setHttpRequiredArgs([]);
      setHttpArgTypes({});
      setHttpAuth({
        type: 'none',
        token: '',
        username: '',
        password: '',
        apiKeyName: 'X-API-Key',
        apiKeyValue: '',
        apiKeyIn: 'header',
        credentialId: '',
      });
      setMcpConfig({ serverUrl: '', apiKey: '', transportType: 'auto', customHeaders: '', credentialId: '' });
      setMcpTestStatus('idle');
      setMcpTestMessage('');
      setJsonError(null);
  };

  const handleAddHeader = () => {
      setHttpHeaders([...httpHeaders, { key: '', value: '', isVariable: false }]);
  };

  const handleRemoveHeader = (index: number) => {
      const newHeaders = [...httpHeaders];
      newHeaders.splice(index, 1);
      if (newHeaders.length === 0) newHeaders.push({ key: '', value: '', isVariable: false });
      setHttpHeaders(newHeaders);
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', val: string) => {
      const newHeaders = [...httpHeaders];
      newHeaders[index][field] = val;
      if (field === 'value' && newHeaders[index].isVariable) {
          const current = String(newHeaders[index].value || '').trim();
          const extracted = extractTemplateVars(current);
          const argName = normalizeArgName(newHeaders[index].key) || extracted[0] || normalizeArgName(current);
          if (argName) {
            newHeaders[index].value = `{{${argName}}}`;
            setHttpRequiredArgs(prev => (prev.includes(argName) ? prev : [...prev, argName]));
          }
      }
      setHttpHeaders(newHeaders);
  };

  const handleAddFormField = () => {
      setHttpFormData([...httpFormData, { key: '', value: '', isVariable: false }]);
  };

  const handleRemoveFormField = (index: number) => {
      const next = [...httpFormData];
      next.splice(index, 1);
      if (next.length === 0) next.push({ key: '', value: '', isVariable: false });
      setHttpFormData(next);
  };

  const handleFormFieldChange = (index: number, field: 'key' | 'value', val: string) => {
      const next = [...httpFormData];
      next[index][field] = val;
      if (field === 'value' && next[index].isVariable) {
          const current = String(next[index].value || '').trim();
          const extracted = extractTemplateVars(current);
          const argName = normalizeArgName(next[index].key) || extracted[0] || normalizeArgName(current);
          if (argName) {
            next[index].value = `{{${argName}}}`;
            setHttpRequiredArgs(prev => (prev.includes(argName) ? prev : [...prev, argName]));
          }
      }
      setHttpFormData(next);
  };

  const applyCurlImport = (command: string) => {
    const parsed = parseCurlCommand(command.trim());
    setHttpConfig({ method: parsed.method, url: parsed.url, body: parsed.body });
    setHttpHeaders(parsed.headers);
    setHttpFormData(parsed.formData);
    setHttpBodyMode(parsed.bodyMode);
    setHttpRequiredArgs(Array.from(new Set(parsed.requiredArgs.map(v => normalizeArgName(v)).filter(Boolean))));
    setHttpArgTypes((prev) => {
      const next: Record<string, HttpArgType> = {};
      for (const arg of parsed.requiredArgs) {
        const key = normalizeArgName(arg);
        if (!key) continue;
        next[key] = prev[key] || 'string';
      }
      return next;
    });
    setCurlImportError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJsonError(null);
    setSaveNotice(null);
    setIsSaving(true);
    
    let finalConfig = {};
    
    try {
        if (formData.type === 'python') {
            finalConfig = { code: pythonCode };
        } else if (formData.type === 'http') {
            const headersObj: Record<string, string> = {};
            httpHeaders.forEach(h => {
                if (h.key.trim()) {
                    const vars = extractTemplateVars(String(h.value || ''));
                    if (h.isVariable && vars.length === 0) {
                      const argName = h.value.trim() || h.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
                      headersObj[h.key.trim()] = `{{${argName}}}`;
                    } else {
                      headersObj[h.key.trim()] = h.value;
                    }
                }
            });
            const formObj: Record<string, string> = {};
            httpFormData.forEach(f => {
                if (f.key.trim()) {
                    const vars = extractTemplateVars(String(f.value || ''));
                    if (f.isVariable && vars.length === 0) {
                      const argName = f.value.trim() || f.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
                      formObj[f.key.trim()] = `{{${argName}}}`;
                    } else {
                      formObj[f.key.trim()] = f.value;
                    }
                }
            });
            const inferredArgs = new Set<string>(httpRequiredArgs.map(x => String(x).trim()).filter(Boolean));
            extractTemplateVars(httpConfig.url || '').forEach(v => inferredArgs.add(v));
            extractTemplateVars(httpConfig.body || '').forEach(v => inferredArgs.add(v));
            httpHeaders.forEach(h => {
              const vars = extractTemplateVars(String(h.value || ''));
              vars.forEach(v => inferredArgs.add(v));
              if (h.isVariable && vars.length === 0 && h.value.trim()) inferredArgs.add(h.value.trim());
            });
            httpFormData.forEach(f => {
              const vars = extractTemplateVars(String(f.value || ''));
              vars.forEach(v => inferredArgs.add(v));
              if (f.isVariable && vars.length === 0 && f.value.trim()) inferredArgs.add(f.value.trim());
            });
            
            finalConfig = {
                method: httpConfig.method,
                url: httpConfig.url,
                headers: headersObj,
                body: httpConfig.body,
                bodyMode: httpBodyMode,
                formData: formObj,
                requiredArgs: Array.from(inferredArgs),
                argSchema: Object.fromEntries(
                  Array.from(inferredArgs)
                    .map((k) => normalizeArgName(k))
                    .filter(Boolean)
                    .map((k) => [k, httpArgTypes[k] || 'string'])
                ),
                auth: {
                  type: httpAuth.type,
                  token: httpAuth.token,
                  username: httpAuth.username,
                  password: httpAuth.password,
                  apiKeyName: httpAuth.apiKeyName,
                  apiKeyValue: httpAuth.apiKeyValue,
                  apiKeyIn: httpAuth.apiKeyIn,
                  credentialId: httpAuth.credentialId ? Number(httpAuth.credentialId) : undefined,
                }
            };
        } else if (formData.type === 'mcp') {
            let extraHeaders = {};
            if (mcpConfig.customHeaders?.trim()) {
                try { extraHeaders = JSON.parse(mcpConfig.customHeaders); } catch { throw new Error('Custom Headers must be valid JSON'); }
            }
            if (mcpConfig.transportType === 'stdio') {
                throw new Error('stdio transport is not supported for MCP tools.');
            }
            finalConfig = {
                serverUrl: mcpConfig.serverUrl,
                apiKey: mcpConfig.apiKey,
                transportType: mcpConfig.transportType,
                customHeaders: extraHeaders,
                credentialId: mcpConfig.credentialId ? Number(mcpConfig.credentialId) : undefined,
            };
        } else {
            finalConfig = JSON.parse(formData.config);
        }

        const url = selectedToolId === 'new' ? '/api/tools' : `/api/tools/${selectedToolId}`;
        const method = selectedToolId === 'new' ? 'POST' : 'PUT';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...formData, config: finalConfig })
        });
        
        if (!res.ok) {
            const errorData = await safeJson(res) as any;
            throw new Error(errorData?.error || 'Failed to save tool');
        }

        const data = await safeJson(res) as any;
        
        fetchTools();
        if (selectedToolId === 'new' && data?.id) {
            setSelectedToolId(data.id);
        }
        setSaveNotice({ type: 'success', message: selectedToolId === 'new' ? 'Tool created successfully.' : 'Tool updated successfully.' });
    } catch (e: any) {
        const msg = e.message || "Invalid JSON config. Please check your syntax.";
        setJsonError(msg);
        setSaveNotice({ type: 'error', message: msg });
    } finally {
        setIsSaving(false);
        setTimeout(() => setSaveNotice(null), 2500);
    }
  };

  const deleteTool = async (id: number, e?: React.MouseEvent, force = false) => {
    if (e) e.stopPropagation();
    try {
        const res = await fetch(`/api/tools/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await safeJson(res) as any;
            if (res.status === 409) {
              setToolDependencies(data?.dependencies || null);
              setDeleteDependencyError(data?.error || 'Tool has active dependencies.');
              setShowDeleteConfirm(true);
              return;
            }
            throw new Error(data?.error || 'Failed to delete tool');
        }
        if (selectedToolId === id) {
            setSelectedToolId(null);
        }
        setShowDeleteConfirm(false);
        setDeleteDependencyError(null);
        fetchTools();
    } catch (e: any) {
        alert(e.message);
    }
  };

  const restoreToolVersion = async (toolId: number, versionId: number) => {
    setRestoringVersionId(versionId);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/tools/${toolId}/restore/${versionId}`, { method: 'POST' });
      const data = await safeJson(res) as any;
      if (!res.ok) throw new Error(data?.error || 'Failed to restore tool version');
      await refreshSelectedTool(toolId);
      setSaveNotice({ type: 'success', message: `Restored tool from version snapshot.` });
    } catch (e: any) {
      setSaveNotice({ type: 'error', message: e.message || 'Failed to restore tool version' });
    } finally {
      setRestoringVersionId(null);
      setTimeout(() => setSaveNotice(null), 2500);
    }
  };

  const importMcpConfig = async () => {
    setMcpImportError(null);
    setMcpImportSuccess(null);
    setMcpImportLoading(true);
    try {
      const parsed = JSON.parse(mcpImportText);
      const servers = parsed?.mcpServers;
      if (!servers || typeof servers !== 'object') throw new Error('mcpServers is missing');

      const entries = Object.entries(servers);
      if (entries.length === 0) throw new Error('No MCP servers found');

      let imported = 0;
      const importedNames: string[] = [];
      for (const [name, cfg] of entries) {
        const args = Array.isArray((cfg as any).args) ? (cfg as any).args : [];
        const urlIdx = args.findIndex((a: any) => String(a) === '--url');
        const serverUrl = urlIdx >= 0 ? args[urlIdx + 1] : '';
        if (!serverUrl) throw new Error(`Missing --url for MCP server: ${name}`);

        await fetch('/api/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: `Imported MCP server: ${name}`,
            type: 'mcp',
            config: {
              serverUrl,
              apiKey: '',
              transportType: 'sse',
              customHeaders: {},
            }
            ,
            skip_validate: true
          })
        });
        imported += 1;
        importedNames.push(name);
      }

      setMcpImportText('');
      setMcpImportSuccess(`Imported ${imported} MCP server(s).`);
      const list = await fetchTools();
      if (importedNames.length > 0 && Array.isArray(list)) {
        const first = list.find((t: any) => t.name === importedNames[0]);
        if (first) handleSelectTool(first);
      }
    } catch (e: any) {
      setMcpImportError(e.message || 'Failed to import MCP config');
    } finally {
      setMcpImportLoading(false);
    }
  };

  const getToolIcon = (type: string) => {
      switch (type) {
          case 'http': return <Globe size={18} />;
          case 'python': return <Terminal size={18} />;
          case 'mcp': return <Server size={18} />;
          default: return <Wrench size={18} />;
      }
  };

  const toolInsights = useMemo(() => {
    const linkedAgents = tools.reduce((sum, tool) => sum + Number(tool.linkages?.agents_count || 0), 0);
    const exposedMcp = tools.filter((tool) => tool.linkages?.mcp_exposed).length;
    const bundleLinks = tools.reduce((sum, tool) => sum + Number(tool.linkages?.bundles_count || 0), 0);
    return {
      total: tools.length,
      linkedAgents,
      exposedMcp,
      bundleLinks,
    };
  }, [tools]);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="swarm-hero p-6 mb-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
            <Sparkles size={12} />
            Capability Layer
          </div>
          <h1 className="text-3xl font-black text-white">Tools</h1>
          <p className="text-slate-300 mt-1">Design, connect, and operationalize the capabilities your agents can call.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowAutoBuild(true); setBuildError(''); }}
            className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2 transition-colors"
          >
            <Sparkles size={18} />
            Auto Build
          </button>
          <button 
            onClick={handleCreateNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus size={18} />
            New Tool
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mt-6">
        {[
          { label: 'Total Tools', value: toolInsights.total, icon: Wrench },
          { label: 'Agent Links', value: toolInsights.linkedAgents, icon: Link2 },
          { label: 'MCP Exposed', value: toolInsights.exposedMcp, icon: Activity },
          { label: 'Bundle Links', value: toolInsights.bundleLinks, icon: Boxes },
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

      <div className="flex-1 flex gap-6 overflow-hidden">
          {/* Left Sidebar - Tool List */}
          <div className="w-1/3 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">Available Tools ({filteredTools.length})</span>
                  </div>
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                      placeholder="Search tools..."
                      className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                      <select 
                        value={categoryFilter} 
                        onChange={(e) => { setCategoryFilter(e.target.value); setToolsPage(1); }}
                        className="text-xs border border-slate-200 rounded px-2 py-2 bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select 
                        value={typeFilter} 
                        onChange={(e) => { setTypeFilter(e.target.value); setToolsPage(1); }}
                        className="text-xs border border-slate-200 rounded px-2 py-2 bg-white outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                          {toolTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {pagedTools.map((tool, idx) => {
                      const prevTool = idx > 0 ? pagedTools[idx - 1] : null;
                      const showHeader = !prevTool || (prevTool.category || 'General') !== (tool.category || 'General');
                      
                      return (
                        <React.Fragment key={tool.id}>
                          {showHeader && (
                            <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 first:mt-0">
                                {tool.category || 'General'}
                            </div>
                          )}
                          <div 
                            onClick={() => handleSelectTool(tool)}
                            className={`p-3 rounded-lg cursor-pointer flex items-center justify-between group transition-colors ${selectedToolId === tool.id ? 'bg-indigo-50 border border-indigo-100' : 'hover:bg-slate-50 border border-transparent'}`}
                          >
                              <div className="flex items-center gap-3 overflow-hidden">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${selectedToolId === tool.id ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                                      {getToolIcon(tool.type)}
                                  </div>
                                  <div className="truncate">
                                      <h4 className={`font-medium truncate ${selectedToolId === tool.id ? 'text-indigo-900' : 'text-slate-700'}`}>{tool.name}</h4>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <p className="text-xs text-slate-400 uppercase tracking-wide">{tool.type}</p>
                                        {(tool.linkages?.agents_count || 0) > 0 && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                                            A:{tool.linkages?.agents_count}
                                          </span>
                                        )}
                                        {tool.linkages?.mcp_exposed && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                            MCP
                                          </span>
                                        )}
                                        {(tool.linkages?.bundles_count || 0) > 0 && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                            B:{tool.linkages?.bundles_count}
                                          </span>
                                        )}
                                      </div>
                                  </div>
                              </div>
                              <button 
                                onClick={(e) => deleteTool(tool.id, e)}
                                className={`p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all ${selectedToolId === tool.id ? 'opacity-100' : ''}`}
                              >
                                  <Trash2 size={16} />
                              </button>
                          </div>
                        </React.Fragment>
                      );
                  })}
                  {filteredTools.length === 0 && (
                      <div className="p-8 text-center text-slate-400 text-sm">
                          {tools.length === 0 ? 'No tools configured yet.' : 'No tools match the current filters.'}
                      </div>
                  )}
              </div>
              <div className="p-3 border-t border-slate-100">
                  <Pagination
                      page={toolsPage}
                      pageSize={toolsPageSize}
                      total={filteredTools.length}
                      onPageChange={setToolsPage}
                      onPageSizeChange={setToolsPageSize}
                  />
              </div>
          </div>

          {/* Right Main Area - Tool Editor */}
          <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
              {selectedToolId === null ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                      <Wrench size={48} className="mb-4 opacity-20" />
                      <h3 className="text-lg font-medium text-slate-600 mb-2">No Tool Selected</h3>
                      <p className="max-w-md">Select a tool from the list to view and edit its configuration, or create a new one to give your agents new capabilities.</p>
                      <button 
                        onClick={handleCreateNew}
                        className="mt-6 text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-2"
                      >
                          <Plus size={18} /> Create New Tool
                      </button>
                  </div>
              ) : (
                  <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                              {selectedToolId === 'new' ? 'Create New Tool' : 'Edit Tool'}
                          </h2>
                          {selectedToolId !== 'new' && (
                              <span className="text-xs font-mono text-slate-400 bg-slate-200 px-2 py-1 rounded">ID: {selectedToolId}</span>
                          )}
                      </div>
                      
                      <div className="flex-1 overflow-y-auto p-6">
                          <form id="tool-form" onSubmit={handleSubmit} className="space-y-6">
                              <div className="grid grid-cols-3 gap-6">
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                      <input
                                          required
                                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                          value={formData.name}
                                          onChange={e => setFormData({...formData, name: e.target.value})}
                                          placeholder="e.g. Weather API"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                                      <input
                                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                          value={formData.category}
                                          onChange={e => setFormData({...formData, category: e.target.value})}
                                          placeholder="e.g. Analysis, Web, etc."
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                                      <select
                                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                          value={formData.type}
                                          onChange={e => setFormData({...formData, type: e.target.value})}
                                      >
                                          <option value="custom">Custom Function</option>
                                          <option value="search">Search</option>
                                          <option value="calculator">Calculator</option>
                                          <option value="python">Python Code</option>
                                          <option value="http">HTTP Request</option>
                                          <option value="mcp">MCP Server</option>
                                      </select>
                                  </div>
                              </div>
                              
                              <div>
                                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                                  <input
                                      required
                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                      value={formData.description}
                                      onChange={e => setFormData({...formData, description: e.target.value})}
                                      placeholder="Explain exactly what this tool does so the LLM knows when to use it"
                                  />
                              </div>

                              {selectedToolId !== 'new' && selectedTool && (
                                <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 space-y-4">
                                  <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">Link Insights</div>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">Linked Agents</div>
                                      <div className="text-base font-bold text-slate-900">{selectedTool.linkages?.agents_count || 0}</div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        {(selectedTool.linkages?.agents || []).slice(0, 2).map(a => a.name).join(', ') || 'None'}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">MCP Exposed</div>
                                      <div className="text-base font-bold text-slate-900">
                                        {selectedTool.linkages?.mcp_exposed ? 'Yes' : 'No'}
                                      </div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        {selectedTool.linkages?.mcp_exposed?.exposed_name || 'Not exposed'}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">MCP Bundles</div>
                                      <div className="text-base font-bold text-slate-900">{selectedTool.linkages?.bundles_count || 0}</div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        {(selectedTool.linkages?.bundles || []).slice(0, 2).map(b => b.name).join(', ') || 'None'}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">Version</div>
                                      <div className="text-base font-bold text-slate-900">v{selectedTool.version || 1}</div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        {selectedTool.updated_at ? new Date(selectedTool.updated_at).toLocaleString() : 'No timestamp'}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">Total Runs</div>
                                      <div className="text-base font-bold text-slate-900">{toolUsage?.total_runs || 0}</div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        {toolUsage?.last_used_at ? `Last used ${new Date(toolUsage.last_used_at).toLocaleString()}` : 'Never executed'}
                                      </div>
                                    </div>
                                    <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                                      <div className="text-[11px] text-slate-500">Delete Risk</div>
                                      <div className="text-base font-bold text-slate-900">
                                        {(toolDependencies?.agents_count || 0) + (toolDependencies?.bundles_count || 0) + (toolDependencies?.mcp_agents_count || 0) + (toolDependencies?.mcp_exposed ? 1 : 0)}
                                      </div>
                                      <div className="text-[11px] text-slate-600 mt-1 truncate">
                                        Linked resources that would be affected
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {selectedToolId !== 'new' && selectedTool && (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                  <div className="border border-slate-200 rounded-xl p-4 bg-white">
                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Version History</div>
                                    <div className="space-y-2 max-h-56 overflow-y-auto">
                                      {toolVersions.map((version) => (
                                        <div key={version.id} className="rounded-lg border border-slate-200 px-3 py-2 bg-slate-50/70">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-semibold text-slate-900">v{version.version_number}</div>
                                            <div className="flex items-center gap-2">
                                              <div className="text-[11px] uppercase tracking-wider text-slate-500">{version.change_kind}</div>
                                              {selectedTool && version.version_number !== Number(selectedTool.version || 1) && (
                                                <button
                                                  type="button"
                                                  onClick={() => void restoreToolVersion(selectedTool.id, version.id)}
                                                  disabled={restoringVersionId === version.id}
                                                  className="text-[11px] px-2 py-1 rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                                                >
                                                  {restoringVersionId === version.id ? 'Restoring...' : 'Rollback'}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-[11px] text-slate-500 mt-1">{new Date(version.created_at).toLocaleString()}</div>
                                          <div className="text-xs text-slate-600 mt-1">{version.name} • {version.type}</div>
                                        </div>
                                      ))}
                                      {toolVersions.length === 0 && <div className="text-sm text-slate-500">No version history yet.</div>}
                                    </div>
                                  </div>
                                  <div className="border border-slate-200 rounded-xl p-4 bg-white">
                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Recent Usage</div>
                                    <div className="space-y-2 max-h-56 overflow-y-auto">
                                      {(toolUsage?.recent_executions || []).map((run) => (
                                        <div key={run.id} className="rounded-lg border border-slate-200 px-3 py-2 bg-slate-50/70">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-semibold text-slate-900">{run.agent_name || run.tool_name}</div>
                                            <div className={`text-[11px] px-2 py-0.5 rounded-full ${
                                              run.status === 'failed' ? 'bg-red-100 text-red-700' : run.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                              {run.status}
                                            </div>
                                          </div>
                                          <div className="text-[11px] text-slate-500 mt-1">
                                            {new Date(run.created_at).toLocaleString()}
                                            {run.duration_ms != null ? ` • ${run.duration_ms}ms` : ''}
                                          </div>
                                          {run.error ? <div className="text-[11px] text-red-600 mt-1 truncate">{run.error}</div> : null}
                                        </div>
                                      ))}
                                      {!(toolUsage?.recent_executions || []).length && <div className="text-sm text-slate-500">No usage history yet.</div>}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Dynamic Config Sections */}
                              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                                  <h4 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                                      <Code size={16} className="text-indigo-500" /> Configuration
                                  </h4>
                                  
                                  {formData.type === 'python' && (
                                      <div>
                                          <label className="block text-sm font-medium text-slate-700 mb-2">Python Script</label>
                                          <div className="rounded-lg overflow-hidden border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-500">
                                              <div className="bg-slate-800 px-4 py-2 flex items-center gap-2">
                                                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                                  <span className="text-xs text-slate-400 ml-2 font-mono">script.py</span>
                                              </div>
                                              <textarea
                                                  className="w-full px-4 py-3 bg-slate-900 text-green-400 outline-none h-64 font-mono text-sm resize-y"
                                                  value={pythonCode}
                                                  onChange={e => setPythonCode(e.target.value)}
                                                  spellCheck={false}
                                              />
                                          </div>
                                          <p className="text-xs text-slate-500 mt-2">The script will be executed in a secure sandbox. Print the final output you want returned to the agent.</p>
                                      </div>
                                  )}

                                  {formData.type === 'http' && (
                                      <div className="space-y-5">
                                          <div>
                                              <label className="block text-sm font-medium text-slate-700 mb-2">Import from curl</label>
                                              <button
                                                  type="button"
                                                  onClick={() => setShowCurlImportModal(true)}
                                                  className="w-full rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 px-4 py-3 text-sm flex items-center justify-center gap-2"
                                              >
                                                  <Terminal size={14} />
                                                  Open cURL Importer
                                              </button>
                                              {curlImportError && <div className="text-xs text-red-600 mt-2">{curlImportError}</div>}
                                          </div>
                                          <div className="flex gap-3">
                                              <div className="w-32">
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
                                                  <select
                                                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-medium"
                                                      value={httpConfig.method}
                                                      onChange={e => setHttpConfig({...httpConfig, method: e.target.value})}
                                                  >
                                                      <option value="GET">GET</option>
                                                      <option value="POST">POST</option>
                                                      <option value="PUT">PUT</option>
                                                      <option value="DELETE">DELETE</option>
                                                  </select>
                                              </div>
                                              <div className="flex-1">
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                                                  <input
                                                      required
                                                      type="url"
                                                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                      value={httpConfig.url}
                                                      onChange={e => setHttpConfig({...httpConfig, url: e.target.value})}
                                                      placeholder="https://api.example.com/v1/data"
                                                  />
                                              </div>
                                          </div>
                                          
                                          <div>
                                              <label className="block text-sm font-medium text-slate-700 mb-2">Authorization</label>
                                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                  <select
                                                      className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                      value={httpAuth.type}
                                                      onChange={e => setHttpAuth({ ...httpAuth, type: e.target.value as HttpAuthConfig['type'] })}
                                                  >
                                                      <option value="none">None</option>
                                                      <option value="bearer">Bearer Token</option>
                                                      <option value="basic">Basic Auth</option>
                                                      <option value="apiKey">API Key</option>
                                                  </select>
                                                  {httpAuth.type === 'bearer' && (
                                                      selectedHttpCredential ? (
                                                        <div className="md:col-span-2 px-3 py-2 border border-emerald-200 bg-emerald-50 rounded-lg text-xs text-emerald-700">
                                                          Using saved credential: <span className="font-semibold">{selectedHttpCredential.name || selectedHttpCredential.provider}</span>
                                                        </div>
                                                      ) : (
                                                        <input
                                                            type="password"
                                                            className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                            placeholder="Bearer token (supports {token} templating)"
                                                            value={httpAuth.token}
                                                            onChange={e => setHttpAuth({ ...httpAuth, token: e.target.value })}
                                                        />
                                                      )
                                                  )}
                                                  {httpAuth.type === 'basic' && (
                                                      <>
                                                          <input
                                                              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder="Username"
                                                              value={httpAuth.username}
                                                              onChange={e => setHttpAuth({ ...httpAuth, username: e.target.value })}
                                                          />
                                                          <input
                                                              type="password"
                                                              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder="Password"
                                                              value={httpAuth.password}
                                                              onChange={e => setHttpAuth({ ...httpAuth, password: e.target.value })}
                                                          />
                                                      </>
                                                  )}
                                                  {httpAuth.type === 'apiKey' && (
                                                      <>
                                                          <input
                                                              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder="Key name (e.g. X-API-Key)"
                                                              value={httpAuth.apiKeyName}
                                                              onChange={e => setHttpAuth({ ...httpAuth, apiKeyName: e.target.value })}
                                                          />
                                                          <input
                                                              type="password"
                                                              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder="API key value"
                                                              value={httpAuth.apiKeyValue}
                                                              onChange={e => setHttpAuth({ ...httpAuth, apiKeyValue: e.target.value })}
                                                              disabled={Boolean(selectedHttpCredential)}
                                                          />
                                                          <select
                                                              className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                              value={httpAuth.apiKeyIn}
                                                              onChange={e => setHttpAuth({ ...httpAuth, apiKeyIn: e.target.value as 'header' | 'query' })}
                                                          >
                                                              <option value="header">Send in Header</option>
                                                              <option value="query">Send in Query</option>
                                                          </select>
                                                      </>
                                                  )}
                                              </div>
                                              {httpAuth.type !== 'none' && (
                                                  <div className="mt-2">
                                                      <label className="block text-xs font-medium text-slate-600 mb-1">Credential Category</label>
                                                      <select
                                                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm mb-2"
                                                          value={httpCredentialCategory}
                                                          onChange={e => {
                                                              setHttpCredentialCategory(e.target.value);
                                                              setHttpAuth(prev => ({ ...prev, credentialId: '' }));
                                                          }}
                                                      >
                                                          <option value="http">HTTP Tools</option>
                                                          <option value="general">General</option>
                                                          <option value="mcp">MCP</option>
                                                          <option value="llm">LLM</option>
                                                          <option value="database">Database</option>
                                                      </select>
                                                      <label className="block text-xs font-medium text-slate-600 mb-1">Saved Credential (Optional)</label>
                                                      <select
                                                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                          value={httpAuth.credentialId}
                                                          onChange={e => {
                                                              const nextId = e.target.value;
                                                              const cred = httpCredentials.find(c => String(c.id) === nextId);
                                                              setHttpAuth(prev => ({
                                                                  ...prev,
                                                                  credentialId: nextId,
                                                                  apiKeyName: (prev.type === 'apiKey' && cred?.key_name && (!prev.apiKeyName || prev.apiKeyName === 'X-API-Key'))
                                                                    ? cred.key_name
                                                                    : prev.apiKeyName
                                                              }));
                                                          }}
                                                      >
                                                          <option value="">Manual value only</option>
                                                          {httpCredentials.map((cred) => (
                                                              <option key={cred.id} value={cred.id}>
                                                                  #{cred.id} {cred.name || cred.provider} ({cred.provider})
                                                              </option>
                                                          ))}
                                                      </select>
                                                  </div>
                                              )}
                                              {selectedHttpCredential && (
                                                  <p className="text-xs text-emerald-700 mt-2">
                                                      Secret value is pulled from saved credential <span className="font-semibold">{selectedHttpCredential.name || selectedHttpCredential.provider}</span>.
                                                  </p>
                                              )}
                                              <p className="text-xs text-slate-500 mt-2">
                                                  n8n-style auth presets for HTTP tools. Values support templating like <code className="bg-slate-100 px-1 py-0.5 rounded">{"{token}"}</code>.
                                              </p>
                                          </div>

                                          <div>
                                              <label className="block text-sm font-medium text-slate-700 mb-2">Headers</label>
                                              <div className="space-y-2">
                                                  {httpHeaders.map((header, index) => (
                                                      <div key={index} className="flex gap-2 items-start">
                                                          <input
                                                              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder="Key (e.g. Authorization)"
                                                              value={header.key}
                                                              onChange={e => handleHeaderChange(index, 'key', e.target.value)}
                                                          />
                                                          <input
                                                              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                              placeholder={header.isVariable ? 'argName or {{argName}}' : 'Static value'}
                                                              value={header.value}
                                                              onChange={e => handleHeaderChange(index, 'value', e.target.value)}
                                                          />
                                                          <label className="flex items-center gap-1 text-xs text-slate-600 mt-2 px-2 py-1 rounded border border-slate-200 bg-white">
                                                              <input
                                                                  type="checkbox"
                                                                  checked={!!header.isVariable}
                                                                  onChange={e => {
                                                                      const next = [...httpHeaders];
                                                                      const checked = e.target.checked;
                                                                      const existingValue = String(next[index].value || '').trim();
                                                                      if (checked) {
                                                                        const extracted = extractTemplateVars(existingValue);
                                                                        const argName = normalizeArgName(next[index].key) || extracted[0] || normalizeArgName(existingValue) || `arg_${index + 1}`;
                                                                        next[index] = { ...next[index], isVariable: true, value: `{{${argName}}}` };
                                                                        setHttpRequiredArgs(prev => (prev.includes(argName) ? prev : [...prev, argName]));
                                                                      } else {
                                                                        const extracted = extractTemplateVars(existingValue);
                                                                        const argName = extracted[0] || '';
                                                                        next[index] = { ...next[index], isVariable: false, value: existingValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, '$1') };
                                                                        if (argName) setHttpRequiredArgs(prev => prev.filter(x => x !== argName));
                                                                      }
                                                                      setHttpHeaders(next);
                                                                  }}
                                                              />
                                                              Variable
                                                          </label>
                                                          <button
                                                              type="button"
                                                              onClick={() => handleRemoveHeader(index)}
                                                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-0.5"
                                                          >
                                                              <X size={18} />
                                                          </button>
                                                      </div>
                                                  ))}
                                              </div>
                                              <button
                                                  type="button"
                                                  onClick={handleAddHeader}
                                                  className="mt-2 text-sm text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1"
                                              >
                                                  <Plus size={14} /> Add Header
                                              </button>
                                          </div>

                                          {!['GET', 'HEAD'].includes(httpConfig.method) && (
                                              <div className="space-y-3">
                                                  <div>
                                                      <label className="block text-sm font-medium text-slate-700 mb-1">Body Type</label>
                                                      <select
                                                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                          value={httpBodyMode}
                                                          onChange={e => setHttpBodyMode(e.target.value as 'json' | 'form-data')}
                                                      >
                                                          <option value="json">JSON</option>
                                                          <option value="form-data">Form Data</option>
                                                      </select>
                                                  </div>
                                                  {httpBodyMode === 'json' ? (
                                                      <div>
                                                          <label className="block text-sm font-medium text-slate-700 mb-1">Body (JSON)</label>
                                                          <textarea
                                                              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-32 font-mono text-sm"
                                                              value={httpConfig.body}
                                                              onChange={e => setHttpConfig({...httpConfig, body: e.target.value})}
                                                              placeholder='{"key": "value"}'
                                                          />
                                                      </div>
                                                  ) : (
                                                      <div>
                                                          <label className="block text-sm font-medium text-slate-700 mb-2">Form Data Fields</label>
                                                          <div className="space-y-2">
                                                              {httpFormData.map((row, idx) => (
                                                                  <div key={idx} className="flex gap-2 items-start">
                                                                      <input
                                                                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                                          placeholder="field_name"
                                                                          value={row.key}
                                                                          onChange={e => handleFormFieldChange(idx, 'key', e.target.value)}
                                                                      />
                                                                      <input
                                                                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                                          placeholder={row.isVariable ? 'argName or {{argName}}' : 'static value'}
                                                                          value={row.value}
                                                                          onChange={e => handleFormFieldChange(idx, 'value', e.target.value)}
                                                                      />
                                                                      <label className="flex items-center gap-1 text-xs text-slate-600 mt-2 px-2 py-1 rounded border border-slate-200 bg-white">
                                                                          <input
                                                                              type="checkbox"
                                                                              checked={!!row.isVariable}
                                                                              onChange={e => {
                                                                                  const next = [...httpFormData];
                                                                                  const checked = e.target.checked;
                                                                                  const existingValue = String(next[idx].value || '').trim();
                                                                                  if (checked) {
                                                                                    const extracted = extractTemplateVars(existingValue);
                                                                                    const argName = normalizeArgName(next[idx].key) || extracted[0] || normalizeArgName(existingValue) || `arg_${idx + 1}`;
                                                                                    next[idx] = { ...next[idx], isVariable: true, value: `{{${argName}}}` };
                                                                                    setHttpRequiredArgs(prev => (prev.includes(argName) ? prev : [...prev, argName]));
                                                                                  } else {
                                                                                    const extracted = extractTemplateVars(existingValue);
                                                                                    const argName = extracted[0] || '';
                                                                                    next[idx] = { ...next[idx], isVariable: false, value: existingValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, '$1') };
                                                                                    if (argName) setHttpRequiredArgs(prev => prev.filter(x => x !== argName));
                                                                                  }
                                                                                  setHttpFormData(next);
                                                                              }}
                                                                          />
                                                                          Variable
                                                                      </label>
                                                                      <button
                                                                          type="button"
                                                                          onClick={() => handleRemoveFormField(idx)}
                                                                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-0.5"
                                                                      >
                                                                          <X size={18} />
                                                                      </button>
                                                                  </div>
                                                              ))}
                                                          </div>
                                                          <button
                                                              type="button"
                                                              onClick={handleAddFormField}
                                                              className="mt-2 text-sm text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1"
                                                          >
                                                              <Plus size={14} /> Add Form Field
                                                          </button>
                                                      </div>
                                                  )}
                                              </div>
                                          )}
                                          <div>
                                              <label className="block text-sm font-medium text-slate-700 mb-1">Required Args For LLM (comma-separated)</label>
                                              <input
                                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                  value={httpRequiredArgs.join(', ')}
                                                  onChange={e => setHttpRequiredArgs(Array.from(new Set(e.target.value.split(',').map(v => normalizeArgName(v)).filter(Boolean))))}
                                                  placeholder="account_id, campaign_id, country_name"
                                              />
                                              <p className="text-xs text-slate-500 mt-1">
                                                Auto-populated from cURL import and used to guide agent tool arguments.
                                              </p>
                                              {!!httpRequiredArgs.length && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                  {httpRequiredArgs.map((arg) => (
                                                    <button
                                                      key={arg}
                                                      type="button"
                                                      className="text-xs px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                                                      onClick={() => setHttpRequiredArgs(prev => prev.filter(x => x !== arg))}
                                                      title="Remove arg"
                                                    >
                                                      {arg} ×
                                                    </button>
                                                  ))}
                                                </div>
                                              )}
                                              {!!httpRequiredArgs.length && (
                                                <div className="mt-3 space-y-2">
                                                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Variable Types</div>
                                                  {httpRequiredArgs.map((arg) => {
                                                    const key = normalizeArgName(arg);
                                                    if (!key) return null;
                                                    return (
                                                      <div key={`arg-type-${key}`} className="flex items-center gap-2">
                                                        <div className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-mono text-slate-700 min-w-[180px]">
                                                          {key}
                                                        </div>
                                                        <select
                                                          className="px-2 py-1 border border-slate-300 rounded text-xs bg-white"
                                                          value={httpArgTypes[key] || 'string'}
                                                          onChange={(e) => setHttpArgTypes(prev => ({ ...prev, [key]: e.target.value as HttpArgType }))}
                                                        >
                                                          <option value="string">string</option>
                                                          <option value="number">number</option>
                                                          <option value="boolean">boolean</option>
                                                          <option value="object">object</option>
                                                          <option value="array">array</option>
                                                        </select>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                          </div>
                                          <div className="border-t border-slate-200 pt-4">
                                              <label className="block text-sm font-medium text-slate-700 mb-1">Test Request (Args JSON)</label>
                                              <textarea
                                                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28 font-mono text-sm"
                                                  value={httpTestArgs}
                                                  onChange={e => setHttpTestArgs(e.target.value)}
                                                  placeholder='{"query": "example"}'
                                              />
                                              <div className="flex items-center justify-between mt-2">
                                                  <button
                                                      type="button"
                                                      className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                                                      onClick={async () => {
                                                          setHttpTestError(null);
                                                          setHttpTestResult(null);
                                                          let args: any = {};
                                                          try {
                                                              args = httpTestArgs.trim() ? JSON.parse(httpTestArgs) : {};
                                                          } catch (e: any) {
                                                              setHttpTestError('Invalid JSON in args.');
                                                              return;
                                                          }
                                                          setHttpTestLoading(true);
                                                          try {
                                                              const headers: Record<string, string> = {};
                                                              httpHeaders.forEach(h => {
                                                                  if (h.key && h.value) headers[h.key] = h.value;
                                                              });
                                                              const res = await fetch('/api/tools/http-test', {
                                                                  method: 'POST',
                                                                  headers: { 'Content-Type': 'application/json' },
                                                                  body: JSON.stringify({
                                                                      config: {
                                                                          method: httpConfig.method,
                                                                          url: httpConfig.url,
                                                                          headers,
                                                                          body: httpConfig.body,
                                                                          bodyMode: httpBodyMode,
                                                                          formData: Object.fromEntries(httpFormData.filter(f => f.key.trim()).map(f => [f.key.trim(), f.value])),
                                                                          requiredArgs: httpRequiredArgs,
                                                                          argSchema: Object.fromEntries(
                                                                            httpRequiredArgs
                                                                              .map((k) => normalizeArgName(k))
                                                                              .filter(Boolean)
                                                                              .map((k) => [k, httpArgTypes[k] || 'string'])
                                                                          ),
                                                                          auth: {
                                                                              type: httpAuth.type,
                                                                              token: httpAuth.token,
                                                                              username: httpAuth.username,
                                                                              password: httpAuth.password,
                                                                              apiKeyName: httpAuth.apiKeyName,
                                                                              apiKeyValue: httpAuth.apiKeyValue,
                                                                              apiKeyIn: httpAuth.apiKeyIn,
                                                                              credentialId: httpAuth.credentialId ? Number(httpAuth.credentialId) : undefined,
                                                                          }
                                                                      },
                                                                      args
                                                                  })
                                                              });
                                                              const text = await res.text();
                                                              let data: any = {};
                                                              try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
                                                              if (!res.ok) throw new Error(data.error || text || 'Test failed');
                                                              setHttpTestResult(data.result || '');
                                                          } catch (e: any) {
                                                              setHttpTestError(e.message || 'Test failed');
                                                          } finally {
                                                              setHttpTestLoading(false);
                                                          }
                                                      }}
                                                      disabled={!httpConfig.url || httpTestLoading}
                                                  >
                                                      {httpTestLoading ? 'Testing...' : 'Run Test'}
                                                  </button>
                                                  {httpTestError && (
                                                      <span className="text-xs text-red-600">{httpTestError}</span>
                                                  )}
                                              </div>
                                              {httpTestResult && (
                                                  <pre className="mt-3 text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                                                      {httpTestResult}
                                                  </pre>
                                              )}
                                          </div>
                                          <p className="text-xs text-slate-500">
                                              LLM inputs are passed as tool args. Reference them in URL/headers/body using <code className="bg-slate-100 px-1 py-0.5 rounded">{"{variable}"}</code>.
                                              If body is empty for POST/PUT, the args object is sent as JSON by default.
                                          </p>
                                      </div>
                                  )}

                                  {formData.type === 'mcp' && (
                                      <div className="space-y-4">
                                          <div>
                                              <label className="block text-sm font-medium text-slate-700 mb-1">Import from MCP Config (claude_desktop_config.json)</label>
                                              <textarea
                                                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24 font-mono text-xs"
                                                  value={mcpImportText}
                                                  onChange={e => setMcpImportText(e.target.value)}
                                                  placeholder={`{\n  \"mcpServers\": {\n    \"tool_currentdatetimetool\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-sse\", \"--url\", \"http://localhost:3000/mcp/sse\"]\n    }\n  }\n}`}
                                              />
                                              <div className="flex items-center justify-between mt-2">
                                                  <button
                                                      type="button"
                                                      className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                                                      onClick={importMcpConfig}
                                                      disabled={!mcpImportText.trim() || mcpImportLoading}
                                                  >
                                                      {mcpImportLoading ? 'Importing...' : 'Import MCP Config'}
                                                  </button>
                                                  {mcpImportError && (
                                                      <span className="text-xs text-red-600">{mcpImportError}</span>
                                                  )}
                                                  {mcpImportSuccess && (
                                                      <span className="text-xs text-emerald-600">{mcpImportSuccess}</span>
                                                  )}
                                              </div>
                                              <p className="text-xs text-slate-500 mt-2">This will create MCP tools for each entry in <code className="bg-slate-100 px-1 rounded">mcpServers</code>.</p>
                                          </div>
                                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                                              <strong>MCP (Model Context Protocol)</strong> — connects your agent to an external tool server.
                                              The <code className="font-mono bg-blue-100 px-1 rounded">serverUrl</code> should point to the MCP endpoint.
                                              For SSE transport use <code className="font-mono bg-blue-100 px-1 rounded">.../sse</code>.
                                              For Streamable HTTP use the base MCP route (e.g. <code className="font-mono bg-blue-100 px-1 rounded">http://localhost:8000/mcp</code>).
                                              A <strong>400 error</strong> usually means the URL is wrong or auth is missing.
                                          </div>

                                          <div className="grid grid-cols-2 gap-4">
                                              <div className="col-span-2">
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">MCP Server URL</label>
                                                  <input
                                                      required
                                                      type="url"
                                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                      value={mcpConfig.serverUrl}
                                                      onChange={e => {
                                                          const next = e.target.value;
                                                          setMcpConfig({...mcpConfig, serverUrl: next});
                                                          if (next.includes('/mcp/manifest') || next.includes('/mcp/call')) {
                                                              setMcpUrlWarning('This is a local manifest/call endpoint, not an MCP server. Use the MCPs page to expose tools instead.');
                                                          } else {
                                                              setMcpUrlWarning('');
                                                          }
                                                      }}
                                                      placeholder="http://localhost:8000/mcp"
                                                  />
                                                  <p className="text-xs text-slate-500 mt-1">
                                                    {mcpConfig.transportType === 'streamable'
                                                      ? <>For Streamable HTTP, use the MCP base route (e.g. <code className="font-mono bg-slate-100 px-1 rounded">http://localhost:8000/mcp</code>).</>
                                                      : mcpConfig.transportType === 'sse'
                                                        ? <>For SSE transport, use the <code className="font-mono bg-slate-100 px-1 rounded">/sse</code> path of your MCP server.</>
                                                        : <>Auto Detect will try Streamable HTTP first for <code className="font-mono bg-slate-100 px-1 rounded">/mcp</code> URLs, otherwise SSE.</>
                                                    }
                                                  </p>
                                                  {mcpUrlWarning && (
                                                      <p className="text-xs text-amber-600 mt-1">{mcpUrlWarning}</p>
                                                  )}
                                              </div>

                                              <div>
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">Transport Type</label>
                                                  <select
                                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                      value={mcpConfig.transportType}
                                                      onChange={e => setMcpConfig({...mcpConfig, transportType: e.target.value as 'auto' | 'sse' | 'streamable' | 'stdio'})}
                                                  >
                                                      <option value="auto">Auto Detect</option>
                                                      <option value="sse">SSE (HTTP Stream)</option>
                                                      <option value="streamable">Streamable HTTP (session-based)</option>
                                                      <option value="stdio" disabled>stdio (Local Process) — not supported</option>
                                                  </select>
                                              </div>

                                              <div>
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">API Key / Bearer Token (Optional)</label>
                                                  <div className="relative">
                                                      <input
                                                          type="password"
                                                          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                                                          value={mcpConfig.apiKey}
                                                          onChange={e => setMcpConfig({...mcpConfig, apiKey: e.target.value})}
                                                          placeholder="Secret key / Bearer token"
                                                      />
                                                  </div>
                                                  <p className="text-xs text-slate-500 mt-1">Sent as both <code className="font-mono bg-slate-100 px-1 rounded">Authorization: Bearer ...</code> and <code className="font-mono bg-slate-100 px-1 rounded">X-API-Key: ...</code>.</p>
                                              </div>

                                              <div>
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">Credential Category</label>
                                                  <select
                                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm mb-2"
                                                      value={mcpCredentialCategory}
                                                      onChange={e => {
                                                          setMcpCredentialCategory(e.target.value);
                                                          setMcpConfig(prev => ({ ...prev, credentialId: '' }));
                                                      }}
                                                  >
                                                      <option value="mcp">MCP</option>
                                                      <option value="general">General</option>
                                                      <option value="http">HTTP Tools</option>
                                                      <option value="llm">LLM</option>
                                                      <option value="database">Database</option>
                                                  </select>
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">Saved Credential (Optional)</label>
                                                  <select
                                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                                                      value={mcpConfig.credentialId}
                                                      onChange={e => setMcpConfig({...mcpConfig, credentialId: e.target.value})}
                                                  >
                                                      <option value="">None</option>
                                                      {mcpCredentials.map((cred) => (
                                                          <option key={cred.id} value={cred.id}>
                                                              #{cred.id} {cred.name || cred.provider} ({cred.provider})
                                                          </option>
                                                      ))}
                                                  </select>
                                                  <p className="text-xs text-slate-500 mt-1">If selected, this credential key can be used as MCP auth token.</p>
                                              </div>

                                              <div className="col-span-2">
                                                  <label className="block text-sm font-medium text-slate-700 mb-1">Custom Headers (JSON, Optional)</label>
                                                  <textarea
                                                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm h-24"
                                                      value={mcpConfig.customHeaders}
                                                      onChange={e => setMcpConfig({...mcpConfig, customHeaders: e.target.value})}
                                                      placeholder='{"X-Custom-Header": "value"}'
                                                  />
                                              </div>
                                          </div>

                                          {/* Test Connection */}
                                          <div className="border-t border-slate-200 pt-4">
                                              <div className="flex items-center gap-3">
                                                  <button
                                                      type="button"
                                                      disabled={!mcpConfig.serverUrl || mcpTestStatus === 'testing' || !!mcpUrlWarning}
                                                      onClick={async () => {
                                                          setMcpTestStatus('testing');
                                                          setMcpTestMessage('');
                                                          try {
                                                              if (mcpUrlWarning) throw new Error(mcpUrlWarning);
                                                              let extraHeaders: any = {};
                                                              if (mcpConfig.customHeaders?.trim()) {
                                                                  try { extraHeaders = JSON.parse(mcpConfig.customHeaders); } catch { throw new Error('Custom Headers must be valid JSON'); }
                                                              }
                                                              const res = await fetch('/api/tools/mcp-test', {
                                                                  method: 'POST',
                                                                  headers: { 'Content-Type': 'application/json' },
                                                                  body: JSON.stringify({
                                                                      serverUrl: mcpConfig.serverUrl,
                                                                      apiKey: mcpConfig.apiKey,
                                                                      transportType: mcpConfig.transportType,
                                                                      customHeaders: extraHeaders,
                                                                      credentialId: mcpConfig.credentialId ? Number(mcpConfig.credentialId) : undefined,
                                                                  })
                                                              });
                                                              const data = await safeJson(res) as any;
                                                              if (!res.ok) throw new Error(data?.error || 'Connection failed');
                                                              setMcpTestStatus('ok');
                                                              setMcpTestMessage(`✓ Connected — found ${data?.toolCount || 0} tools: ${data?.tools?.join(', ') || ''}`);
                                                          } catch (e: any) {
                                                              setMcpTestStatus('error');
                                                              setMcpTestMessage(e.message);
                                                          }
                                                      }}
                                                      className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
                                                  >
                                                      {mcpTestStatus === 'testing' && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
                                                      Test Connection
                                                  </button>
                                                  {mcpTestMessage && (
                                                      <span className={`text-xs font-medium ${mcpTestStatus === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                                                          {mcpTestMessage}
                                                      </span>
                                                  )}
                                              </div>
                                          </div>
                                      </div>
                                  )}

                                  {['custom', 'search', 'calculator'].includes(formData.type) && (
                                      <div>
                                          <label className="block text-sm font-medium text-slate-700 mb-1">Raw JSON Config</label>
                                          <textarea
                                              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-32 font-mono text-sm ${jsonError ? 'border-red-500' : 'border-slate-300'}`}
                                              value={formData.config}
                                              onChange={e => {
                                                  setFormData({...formData, config: e.target.value});
                                                  setJsonError(null);
                                              }}
                                              placeholder="{}"
                                          />
                                          {jsonError && <p className="text-xs text-red-500 mt-2">{jsonError}</p>}
                                      </div>
                                  )}
                              </div>
                          </form>
                      </div>
                      
                      <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                          {saveNotice && (
                            <div className={`mr-auto px-3 py-2 rounded-lg text-sm border ${
                              saveNotice.type === 'success'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}>
                              {saveNotice.message}
                            </div>
                          )}
                          <button 
                              type="button"
                              onClick={() => setSelectedToolId(null)}
                              className="text-slate-600 px-4 py-2 hover:bg-slate-200 rounded-lg transition-colors font-medium"
                          >
                              Cancel
                          </button>
                          <button 
                              form="tool-form"
                              type="submit"
                              disabled={isSaving}
                              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-70"
                          >
                              {isSaving ? 'Saving...' : (selectedToolId === 'new' ? 'Create Tool' : 'Save Changes')}
                          </button>
                      </div>
                  </div>
              )}
          </div>
      </div>

      {showCurlImportModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-[min(94vw,980px)] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="text-base font-semibold text-slate-900">Import HTTP Tool From cURL</div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setShowCurlImportModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-52 font-mono text-xs"
                value={curlImportText}
                onChange={e => setCurlImportText(e.target.value)}
                placeholder={`curl -X POST https://api.example.com/v1/items \\\n  -H "Authorization: Bearer TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"test"}'`}
              />
              {curlImportError && <div className="text-xs text-red-600">{curlImportError}</div>}
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCurlImportModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!curlImportText.trim()}
                onClick={() => {
                  try {
                    applyCurlImport(curlImportText);
                    setShowCurlImportModal(false);
                  } catch (e: any) {
                    setCurlImportError(e.message || 'Failed to parse curl command.');
                  }
                }}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Import & Fill
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoBuild && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600" /> Auto Build Tools
              </div>
              <button
                onClick={() => setShowAutoBuild(false)}
                className="text-slate-500 hover:text-slate-700 text-sm"
              >
                Close
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Objective</label>
                <textarea
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-28"
                  placeholder="Describe what you want the tools to enable."
                  value={autoBuildGoal}
                  onChange={(e) => setAutoBuildGoal(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    value={autoBuildProvider}
                    onChange={(e) => setAutoBuildProvider(e.target.value)}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    value={autoBuildModel}
                    onChange={(e) => setAutoBuildModel(e.target.value)}
                    disabled={isLoadingModels}
                  >
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">Attach To Agents (optional)</div>
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                  {agents.length === 0 ? (
                    <div className="text-sm text-slate-500">No agents available.</div>
                  ) : (
                    agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={autoBuildAgentIds.includes(agent.id)}
                          onChange={() => toggleAutoBuildAgent(agent.id)}
                        />
                        <span>{agent.name} <span className="text-slate-400">({agent.role})</span></span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">If none selected, tools are created unassigned.</p>
              </div>

              {buildError && (
                <div className="text-sm text-red-600">{buildError}</div>
              )}
            </div>
            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setShowAutoBuild(false)}
                className="px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={autoBuildTools}
                disabled={isBuilding || !autoBuildGoal}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {isBuilding ? 'Building...' : 'Build Tools'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && selectedTool && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-[min(94vw,720px)] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="text-base font-semibold text-slate-900">Delete Tool Safely</div>
              <button type="button" className="text-slate-500 hover:text-slate-700" onClick={() => setShowDeleteConfirm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm text-slate-700">
                {deleteDependencyError || `This tool is still linked to active resources. Review dependencies before forcing deletion.`}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Agents</div>
                  <div className="text-lg font-bold text-slate-900">{toolDependencies?.agents_count || 0}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">MCP Exposure</div>
                  <div className="text-lg font-bold text-slate-900">{toolDependencies?.mcp_exposed ? 1 : 0}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">Bundles</div>
                  <div className="text-lg font-bold text-slate-900">{toolDependencies?.bundles_count || 0}</div>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Force delete will remove the tool, its version history, and direct link records.
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteTool(selectedTool.id, undefined, true)}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Force Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
