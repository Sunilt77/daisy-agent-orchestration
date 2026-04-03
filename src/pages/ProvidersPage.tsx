import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit, Key, Server, Check, X, Shield, ExternalLink, Search } from 'lucide-react';
import Pagination from '../components/Pagination';

interface Provider {
  id: number;
  name: string;
  provider: string;
  api_base?: string;
  api_key: string; // masked
  is_default: boolean;
}

async function safeJson(res: Response) {
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [providersPage, setProvidersPage] = useState(1);
  const [providersPageSize, setProvidersPageSize] = useState(9);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error' | 'testing', message: string } | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    provider: 'openai',
    api_base: '',
    api_key: '',
    is_default: false
  });

  const providerTypes = [
    { id: 'google', name: 'Google Gemini' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai-compatible', name: 'OpenAI Compatible (e.g. Ollama, vLLM)' },
    { id: 'litellm', name: 'LiteLLM Proxy / Enterprise' }
  ];

  useEffect(() => {
    fetchProviders();
  }, []);

  useEffect(() => {
    setProvidersPage(1);
  }, [providers.length, search, providerFilter]);

  const fetchProviders = () => {
    fetch('/api/providers')
      .then(res => safeJson(res))
      .then(data => { if (data) setProviders(data); });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const url = editingId ? `/api/providers/${editingId}` : '/api/providers';
    const method = editingId ? 'PUT' : 'POST';

    // If editing and api_key is empty, don't send it (keep existing)
    const body: any = { ...formData };
    if (editingId && !body.api_key) {
        delete body.api_key;
    }

    await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    resetForm();
    fetchProviders();
  };

  const resetForm = () => {
    setFormData({ name: '', provider: 'openai', api_base: '', api_key: '', is_default: false });
    setIsCreating(false);
    setEditingId(null);
    setTestStatus(null);
  };

  const startEdit = (provider: Provider) => {
      setFormData({
          name: provider.name,
          provider: provider.provider,
          api_base: provider.api_base || '',
          api_key: '', // Don't show existing key
          is_default: provider.is_default
      });
      setEditingId(provider.id);
      setIsCreating(true);
      setTestStatus(null);
  };

  const handleTestConnection = async () => {
    if (!formData.api_key && !editingId) {
        setTestStatus({ type: 'error', message: 'API Key is required to test connection.' });
        return;
    }
    
    if (formData.api_base?.endsWith('/chat/completions') || formData.api_base?.endsWith('/models')) {
        setTestStatus({ type: 'error', message: 'Warning: API Base should usually end in /v1, not a specific endpoint path like /chat/completions.' });
        return;
    }

    setTestStatus({ type: 'testing', message: 'Testing connection...' });
    try {
        if (editingId && !formData.api_key) {
            setTestStatus({ type: 'error', message: 'Please temporarily re-enter your API key to test the connection.' });
            return;
        }

        const res = await fetch('/api/providers/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const data = await safeJson(res) || {};
        if (res.ok) {
            setTestStatus({ type: 'success', message: data.message || 'Connection successful!' });
        } else {
            setTestStatus({ type: 'error', message: data.error || 'Connection failed.' });
        }
    } catch (e: any) {
        setTestStatus({ type: 'error', message: e.message || 'Network error occurred.' });
    }
  };

  const deleteProvider = async (id: number) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;
    
    try {
        const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        fetchProviders();
    } catch (e: any) {
        alert(e.message);
    }
  };

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providers.filter((provider) => {
      if (providerFilter === 'defaults' && !provider.is_default) return false;
      if (providerFilter !== 'all' && providerFilter !== 'defaults' && provider.provider !== providerFilter) return false;
      if (!query) return true;
      const haystack = [provider.name, provider.provider, provider.api_base || ''].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [providers, search, providerFilter]);

  const pagedProviders = useMemo(() => {
    const start = (providersPage - 1) * providersPageSize;
    return filteredProviders.slice(start, start + providersPageSize);
  }, [filteredProviders, providersPage, providersPageSize]);

  const providerInsights = useMemo(() => ({
    totalProviders: providers.length,
    defaultProviders: providers.filter((provider) => provider.is_default).length,
    openAiCompatible: providers.filter((provider) => provider.provider === 'openai-compatible').length,
    managedKeys: providers.length,
  }), [providers]);

  return (
    <div>
      <div className="swarm-hero p-6 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">LLM Providers</h1>
            <p className="text-slate-300 mt-1">Maintain the model backends your agents can route through, test them, and keep defaults explicit.</p>
            <p className="text-xs text-slate-400 mt-2">
              For non-LLM API keys, go to{' '}
              <Link to="/credentials" className="text-cyan-200 hover:text-white font-medium inline-flex items-center gap-1">
                Credentials <ExternalLink size={10} />
              </Link>
            </p>
          </div>
          <button
            onClick={() => setIsCreating((prev) => !prev)}
            className="bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors border border-white/10"
          >
            <Plus size={18} />
            {isCreating ? 'Close Builder' : 'New Provider'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mt-6">
          {[
            { label: 'Providers', value: providerInsights.totalProviders },
            { label: 'Defaults', value: providerInsights.defaultProviders },
            { label: 'Compat Runtimes', value: providerInsights.openAiCompatible },
            { label: 'Managed Keys', value: providerInsights.managedKeys },
          ].map((item) => (
            <div key={item.label} className="telemetry-tile p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
              <div className="mt-2 text-3xl font-black text-white">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Search providers by name, type, or API base..."
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{filteredProviders.length}</span>
            <span>visible of</span>
            <span className="font-medium text-slate-700">{providers.length}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { key: 'all', label: 'All' },
            { key: 'defaults', label: 'Defaults' },
            ...providerTypes.map((type) => ({ key: type.id, label: type.name })),
          ].map((chip) => (
            <button
              key={chip.key}
              onClick={() => setProviderFilter(chip.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                providerFilter === chip.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <button
            onClick={() => { setProviderFilter('all'); setSearch(''); }}
            disabled={providerFilter === 'all' && !search.trim()}
            className="ml-auto rounded-full px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
          >
            Reset
          </button>
        </div>
      </div>

      {isCreating && (
        <div className="mb-8 bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-4">
          <h3 className="text-lg font-semibold mb-4">{editingId ? 'Edit Provider' : 'Add New Provider'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. My Local Ollama"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Provider Type</label>
                <select
                  required
                  className="w-full ui-select"
                  value={formData.provider}
                  onChange={e => setFormData({...formData, provider: e.target.value})}
                >
                  {providerTypes.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Base URL (Optional)</label>
              <div className="relative">
                  <Server size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                    value={formData.api_base}
                    onChange={e => setFormData({...formData, api_base: e.target.value})}
                    placeholder="e.g. http://localhost:11434/v1"
                  />
              </div>
              <p className="text-xs text-slate-500 mt-1">Required for OpenAI-compatible providers (like Ollama).</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
              <div className="relative">
                  <Key size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="password"
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                    value={formData.api_key}
                    onChange={e => setFormData({...formData, api_key: e.target.value})}
                    placeholder={editingId ? "Leave blank to keep existing key" : "sk-..."}
                    required={!editingId}
                  />
              </div>
            </div>

            <div>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                        checked={formData.is_default}
                        onChange={e => setFormData({...formData, is_default: e.target.checked})}
                    />
                    <span className="text-sm font-medium text-slate-700">Set as Default for this Provider Type</span>
                </label>
                <p className="text-xs text-slate-500 mt-1 ml-6">
                    If checked, this configuration will be used when an agent selects '{providerTypes.find(p => p.id === formData.provider)?.name}' without a specific configuration.
                </p>
            </div>

            <div className="flex justify-end gap-3 pt-2 items-center">
              {testStatus && (
                <div className={`mr-auto px-3 py-1.5 rounded-lg text-xs font-medium ${
                    testStatus.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                    testStatus.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                    'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                }`}>
                    {testStatus.type === 'testing' ? 'Testing...' : testStatus.message}
                </div>
              )}
              
              <button 
                type="button"
                onClick={handleTestConnection}
                disabled={testStatus?.type === 'testing'}
                className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-200 disabled:opacity-50"
              >
                Test Connection
              </button>
              <button 
                type="button"
                onClick={resetForm}
                className="text-slate-500 px-4 py-2 hover:text-slate-700"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
              >
                {editingId ? 'Update Provider' : 'Add Provider'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pagedProviders.map(provider => (
          <div key={provider.id} className="bg-white p-6 rounded-xl border border-slate-200 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600">
                  <Shield size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{provider.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {providerTypes.find(p => p.id === provider.provider)?.name || provider.provider}
                    </span>
                    {provider.is_default && (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-700 rounded-full uppercase tracking-wide">
                            Default
                        </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button 
                    onClick={() => startEdit(provider)}
                    className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
                    title="Edit"
                >
                    <Edit size={18} />
                </button>
                <button 
                    onClick={() => deleteProvider(provider.id)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete"
                >
                    <Trash2 size={18} />
                </button>
              </div>
            </div>
            
            <div className="space-y-3 text-sm border-t border-slate-100 pt-4 mt-2">
              {provider.api_base && (
                  <div className="flex gap-2 items-center text-slate-600">
                    <Server size={14} className="text-slate-400 shrink-0" />
                    <span className="font-mono text-xs truncate" title={provider.api_base}>{provider.api_base}</span>
                  </div>
              )}
              <div className="flex gap-2 items-center text-slate-600">
                <Key size={14} className="text-slate-400 shrink-0" />
                <span className="font-mono text-xs">••••••••••••••••</span>
              </div>
            </div>
          </div>
        ))}
        
        {providers.length === 0 && !isCreating && (
          <div className="col-span-full text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">No providers configured yet.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus size={16} />
              Add Provider
            </button>
          </div>
        )}
        {providers.length > 0 && filteredProviders.length === 0 && (
          <div className="col-span-full text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">No providers match the current filters.</p>
            <button
              onClick={() => { setProviderFilter('all'); setSearch(''); }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>
      <div className="mt-6">
        <Pagination
          page={providersPage}
          pageSize={providersPageSize}
          total={filteredProviders.length}
          onPageChange={setProvidersPage}
          onPageSizeChange={setProvidersPageSize}
          pageSizeOptions={[6, 9, 12, 18]}
        />
      </div>
    </div>
  );
}
