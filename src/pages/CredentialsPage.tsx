import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AudioLines,
  Bot,
  CheckCircle2,
  Database,
  Edit,
  ExternalLink,
  Globe,
  Key,
  Plus,
  Save,
  Search,
  Trash2,
  X,
  PlugZap,
} from 'lucide-react';
import Pagination from '../components/Pagination';

function slugifyKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

interface Credential {
  id: number;
  provider: string;
  name?: string;
  key_name?: string;
  category?: string;
  api_key: string;
}

type CredentialPreset = {
  key: string;
  label: string;
  category: string;
  key_name: string;
  note: string;
};

const credentialPresets: CredentialPreset[] = [
  { key: 'google', label: 'Google', category: 'llm', key_name: 'Authorization', note: 'General Google or Gemini-adjacent API access.' },
  { key: 'openai', label: 'OpenAI', category: 'llm', key_name: 'Authorization', note: 'OpenAI-compatible API key storage.' },
  { key: 'anthropic', label: 'Anthropic', category: 'llm', key_name: 'x-api-key', note: 'Anthropic API key.' },
  { key: 'github', label: 'GitHub', category: 'general', key_name: 'Authorization', note: 'GitHub tokens for tooling or automations.' },
  { key: 'slack', label: 'Slack', category: 'general', key_name: 'Authorization', note: 'Slack bots, workspace automations, and app tokens.' },
  { key: 'notion', label: 'Notion', category: 'general', key_name: 'Authorization', note: 'Notion integrations and content access.' },
  { key: 'stripe', label: 'Stripe', category: 'general', key_name: 'Authorization', note: 'Payments, subscriptions, and marketplace billing.' },
  { key: 'internal_api', label: 'Internal API', category: 'http', key_name: 'X-API-Key', note: 'Internal services, partner APIs, and custom HTTP tools.' },
  { key: 'elevenlabs_voice', label: 'ElevenLabs Voice', category: 'voice', key_name: 'xi-api-key', note: 'Required by the Voice Console and ElevenLabs speech runtime.' },
];

async function safeJson(res: Response) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function maskSecret(value: string) {
  if (!value) return '••••••••';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    provider: '',
    name: '',
    key_name: 'Authorization',
    category: 'general',
    api_key: '',
  });
  const [status, setStatus] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<'custom' | string>('custom');
  const [search, setSearch] = useState('');
  const [credPage, setCredPage] = useState(1);
  const [credPageSize, setCredPageSize] = useState(10);

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = () => {
    fetch('/api/credentials')
      .then((res) => safeJson(res))
      .then((data) => { if (data) setCredentials(data); });
  };

  useEffect(() => {
    setCredPage(1);
  }, [credentials.length, search]);

  useEffect(() => {
    if (isEditing) return;
    if (formData.provider.trim()) return;
    if (!formData.name.trim()) return;
    const next = slugifyKey(formData.name);
    if (next) setFormData((prev) => ({ ...prev, provider: next }));
  }, [formData.name, formData.provider, isEditing]);

  useEffect(() => {
    if (selectedPresetKey === 'custom') return;
    const preset = credentialPresets.find((item) => item.key === selectedPresetKey);
    if (!preset) return;
    setFormData((prev) => ({
      ...prev,
      provider: preset.key,
      name: prev.name.trim() ? prev.name : preset.label,
      key_name: preset.key_name,
      category: preset.category,
    }));
  }, [selectedPresetKey]);

  const filteredCredentials = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return credentials;
    return credentials.filter((cred) => {
      const haystack = [
        cred.provider,
        cred.name || '',
        cred.key_name || '',
        cred.category || '',
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [credentials, search]);

  const pagedCredentials = useMemo(() => {
    const start = (credPage - 1) * credPageSize;
    return filteredCredentials.slice(start, start + credPageSize);
  }, [filteredCredentials, credPage, credPageSize]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const provider = formData.provider.trim();
    if (!provider) return;
    await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formData, provider }),
    });
    setFormData({ provider: '', name: '', key_name: 'Authorization', category: 'general', api_key: '' });
    setIsEditing(false);
    setShowAdvanced(false);
    setSelectedPresetKey('custom');
    setStatus('Saved successfully!');
    setTimeout(() => setStatus(null), 3000);
    fetchCredentials();
  };

  const deleteCredential = async (id: number) => {
    if (!confirm('Are you sure?')) return;
    await fetch(`/api/credentials/${id}`, { method: 'DELETE' });
    fetchCredentials();
  };

  const startEdit = (cred: Credential) => {
    const preset = credentialPresets.find((item) => item.key === cred.provider);
    setFormData({
      provider: cred.provider,
      name: cred.name || cred.provider,
      key_name: cred.key_name || 'Authorization',
      category: cred.category || 'general',
      api_key: '',
    });
    setIsEditing(true);
    setShowAdvanced(true);
    setSelectedPresetKey(preset?.key || 'custom');
  };

  const cancelEdit = () => {
    setFormData({ provider: '', name: '', key_name: 'Authorization', category: 'general', api_key: '' });
    setIsEditing(false);
    setShowAdvanced(false);
    setSelectedPresetKey('custom');
  };

  const selectedPreset = credentialPresets.find((item) => item.key === selectedPresetKey) || null;
  const internalKeyWarning =
    formData.category === 'voice' &&
    formData.provider.trim() !== '' &&
    !['elevenlabs_voice', 'elevenlabs'].includes(formData.provider.trim());

  return (
    <div>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Credentials</h1>
          <p className="text-slate-500 mt-1">Manage API keys for any service: HTTP tools, MCP runtimes, voice providers, databases, and internal integrations.</p>
          <p className="text-xs text-slate-400 mt-1">
            For LLM model providers (Google, OpenAI, Anthropic), go to{' '}
            <Link to="/providers" className="text-brand-600 hover:underline font-medium inline-flex items-center gap-1">
              LLM Providers <ExternalLink size={10} />
            </Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-fit">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {isEditing ? <Edit size={20} className="text-indigo-600" /> : <Plus size={20} className="text-indigo-600" />}
              {isEditing ? 'Update Credential' : 'Add New Credential'}
            </h3>
            {isEditing && (
              <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Credential Preset</label>
              <select
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                value={selectedPresetKey}
                onChange={(e) => setSelectedPresetKey(e.target.value)}
              >
                <option value="custom">Custom / Generic</option>
                {credentialPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-2">
                {selectedPreset?.note || 'Use a preset for common services, or keep this generic for any custom API, database, webhook, MCP integration, or internal backend.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
              <input
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Facebook Marketing Prod"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Credential Key (Internal)</label>
              <input
                required
                list="credential-key-suggestions"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-mono"
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                disabled={isEditing}
                placeholder="e.g. github_prod or elevenlabs_voice"
              />
              <datalist id="credential-key-suggestions">
                {credentialPresets.map((preset) => (
                  <option key={preset.key} value={preset.key} />
                ))}
              </datalist>
              <p className="text-xs text-slate-500 mt-1">
                This is the actual lookup key used by tools, MCP runtimes, agent workflows, and voice services.
              </p>
              {isEditing && <p className="text-xs text-slate-500 mt-1">Credential key cannot be changed while editing.</p>}
              {internalKeyWarning && (
                <p className="text-xs text-amber-700 mt-1">
                  Voice runtime expects internal key `elevenlabs_voice` or `elevenlabs`. A different key will not be found automatically.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Header / Param Key Name</label>
              <input
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                value={formData.key_name}
                onChange={(e) => setFormData({ ...formData, key_name: e.target.value })}
                placeholder="Authorization or X-API-Key"
              />
              <p className="text-xs text-slate-500 mt-1">
                Useful for generic HTTP-style auth dropdowns. It does not replace the internal credential key.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                <option value="general">General</option>
                <option value="http">HTTP Tools</option>
                <option value="mcp">MCP Tools</option>
                <option value="llm">LLM Providers</option>
                <option value="voice">Voice / Audio</option>
                <option value="database">Database</option>
              </select>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                {showAdvanced ? 'Hide advanced notes' : 'Show advanced notes'}
              </button>
            </div>

            {showAdvanced && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-700 mb-2">Advanced Notes</div>
                <div className="space-y-2 text-xs text-slate-500">
                  <p>Generic credentials can represent API keys, bearer tokens, MCP secrets, database secrets, webhook tokens, and voice-provider keys.</p>
                  <p>The internal key is the stable runtime identifier. The display name is just for humans.</p>
                  <p>For special runtimes like ElevenLabs voice, matching the expected internal key matters more than the display label.</p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
              <input
                type="password"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                placeholder={isEditing ? 'Enter new key to update...' : 'sk-...'}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {status ? (
                <span className="text-green-600 text-sm flex items-center gap-1">
                  <CheckCircle2 size={16} /> {status}
                </span>
              ) : <span />}
              <div className="flex gap-2">
                {isEditing && (
                  <button type="button" onClick={cancelEdit} className="text-slate-500 px-4 py-2 hover:text-slate-700">
                    Cancel
                  </button>
                )}
                <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2">
                  <Save size={18} />
                  {isEditing ? 'Update Key' : 'Save Key'}
                </button>
              </div>
            </div>
          </form>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold text-slate-800">Configured Credentials</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><PlugZap size={15} className="text-indigo-600" /> Generic</div>
                <p className="mt-1 text-xs text-slate-500">Use for internal APIs, webhooks, partner services, and custom integrations.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Globe size={15} className="text-cyan-600" /> HTTP</div>
                <p className="mt-1 text-xs text-slate-500">Header keys like `Authorization` or `X-API-Key` help generic HTTP tools.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Bot size={15} className="text-violet-600" /> LLM</div>
                <p className="mt-1 text-xs text-slate-500">General LLM secrets live here, while model providers have their own page.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AudioLines size={15} className="text-emerald-600" /> Voice</div>
                <p className="mt-1 text-xs text-slate-500">For ElevenLabs, use internal key `elevenlabs_voice`.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Database size={15} className="text-amber-600" /> Data</div>
                <p className="mt-1 text-xs text-slate-500">Store database or backend connector secrets with a stable internal key.</p>
              </div>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search credentials by name, internal key, category, or header key..."
              />
            </div>
          </div>

          {filteredCredentials.length === 0 && (
            <div className="text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-center">
              {credentials.length === 0 ? 'No credentials saved yet. Add one to get started.' : 'No credentials match your search yet.'}
            </div>
          )}

          {pagedCredentials.map((cred) => (
            <div key={cred.id} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-600">
                  {cred.provider.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="font-medium text-slate-900">{cred.name || cred.provider}</h4>
                  <p className="text-[11px] text-slate-500 font-mono">{cred.provider}</p>
                  <p className="text-xs text-slate-500 font-mono flex items-center gap-1">
                    <Key size={10} />
                    {maskSecret(cred.api_key)}
                  </p>
                  <p className="text-[11px] text-slate-500">header: <span className="font-mono">{cred.key_name || 'Authorization'}</span></p>
                  <p className="text-[11px] text-slate-500">category: <span className="font-mono">{cred.category || 'general'}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEdit(cred)}
                  className="text-slate-400 hover:text-indigo-600 transition-colors p-2 rounded-full hover:bg-indigo-50"
                  title="Edit"
                >
                  <Edit size={18} />
                </button>
                <button
                  onClick={() => deleteCredential(cred.id)}
                  className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50"
                  title="Delete"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}

          <div className="pt-2">
            <Pagination
              page={credPage}
              pageSize={credPageSize}
              total={filteredCredentials.length}
              onPageChange={setCredPage}
              onPageSizeChange={setCredPageSize}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
