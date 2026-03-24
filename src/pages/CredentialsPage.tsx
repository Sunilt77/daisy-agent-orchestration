import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Key, Save, Trash2, CheckCircle2, Edit, Plus, X, ExternalLink } from 'lucide-react';
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

async function safeJson(res: Response) {
    try {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    provider: '',
    name: '',
    key_name: 'Authorization',
    category: 'general',
    api_key: ''
  });
  const [status, setStatus] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [credPage, setCredPage] = useState(1);
  const [credPageSize, setCredPageSize] = useState(10);

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = () => {
    fetch('/api/credentials')
      .then(res => safeJson(res))
      .then(data => { if (data) setCredentials(data); });
  };

  useEffect(() => {
    setCredPage(1);
  }, [credentials.length]);

  useEffect(() => {
    if (isEditing) return;
    if (showAdvanced) return;
    if (formData.provider.trim()) return;
    if (!formData.name.trim()) return;
    const next = slugifyKey(formData.name);
    if (next) {
      setFormData(prev => ({ ...prev, provider: next }));
    }
  }, [formData.name, formData.provider, isEditing, showAdvanced]);

  const pagedCredentials = useMemo(() => {
    const start = (credPage - 1) * credPageSize;
    return credentials.slice(start, start + credPageSize);
  }, [credentials, credPage, credPageSize]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const provider = formData.provider.trim();
    if (!provider) return;
    await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formData, provider })
    });
    setFormData({ provider: '', name: '', key_name: 'Authorization', category: 'general', api_key: '' });
    setIsEditing(false);
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
    setFormData({
      provider: cred.provider,
      name: cred.name || cred.provider,
      key_name: cred.key_name || 'Authorization',
      category: cred.category || 'general',
      api_key: ''
    });
    setIsEditing(true);
    setShowAdvanced(true);
  };

  const cancelEdit = () => {
    setFormData({ provider: '', name: '', key_name: 'Authorization', category: 'general', api_key: '' });
    setIsEditing(false);
    setShowAdvanced(false);
  };

  const commonCredentialKeys = [
    'google',
    'openai',
    'anthropic',
    'github',
    'slack',
    'notion',
    'stripe',
    'internal_api',
  ];

  return (
    <div>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Credentials</h1>
          <p className="text-slate-500 mt-1">Manage API keys for any service — search, databases, tools, and more</p>
          <p className="text-xs text-slate-400 mt-1">
            For LLM model providers (Google, OpenAI, Anthropic), go to{' '}
            <Link to="/providers" className="text-brand-600 hover:underline font-medium inline-flex items-center gap-1">
              LLM Providers <ExternalLink size={10} />
            </Link>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form */}
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
              <input
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. Facebook Marketing Prod"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Header / Param Key Name</label>
              <input
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                value={formData.key_name}
                onChange={e => setFormData({...formData, key_name: e.target.value})}
                placeholder="Authorization or X-API-Key"
              />
              <p className="text-xs text-slate-500 mt-1">
                Used by API Key auth dropdowns when header key is not manually set.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                value={formData.category}
                onChange={e => setFormData({...formData, category: e.target.value})}
              >
                <option value="general">General</option>
                <option value="http">HTTP Tools</option>
                <option value="mcp">MCP Tools</option>
                <option value="llm">LLM Providers</option>
                <option value="database">Database</option>
              </select>
            </div>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                {showAdvanced ? 'Hide advanced fields' : 'Show advanced fields'}
              </button>
            </div>
            {showAdvanced && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Credential Key (Internal)</label>
                <input
                  required
                  list="credential-key-suggestions"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-mono"
                  value={formData.provider}
                  onChange={e => setFormData({...formData, provider: e.target.value})}
                  disabled={isEditing}
                  placeholder="e.g. github_prod"
                />
                <datalist id="credential-key-suggestions">
                  {commonCredentialKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-500 mt-1">
                  Used as stable internal ID for dropdown selections.
                </p>
                {isEditing && <p className="text-xs text-slate-500 mt-1">Credential key cannot be changed while editing.</p>}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
              <input
                type="password"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                value={formData.api_key}
                onChange={e => setFormData({...formData, api_key: e.target.value})}
                placeholder={isEditing ? "Enter new key to update..." : "sk-..."}
              />
            </div>
            <div className="flex items-center justify-between pt-2">
                {status ? (
                    <span className="text-green-600 text-sm flex items-center gap-1">
                        <CheckCircle2 size={16} /> {status}
                    </span>
                ) : <span></span>}
                <div className="flex gap-2">
                    {isEditing && (
                        <button 
                            type="button"
                            onClick={cancelEdit}
                            className="text-slate-500 px-4 py-2 hover:text-slate-700"
                        >
                            Cancel
                        </button>
                    )}
                    <button 
                        type="submit"
                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                    >
                        <Save size={18} />
                        {isEditing ? 'Update Key' : 'Save Key'}
                    </button>
                </div>
            </div>
          </form>
        </div>

        {/* List */}
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">Configured Credentials</h3>
            {credentials.length === 0 && (
                <div className="text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-center">
                    No credentials saved yet. Add one to get started.
                </div>
            )}
            {pagedCredentials.map(cred => (
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
                                {cred.api_key}
                            </p>
                            <p className="text-[11px] text-slate-500">key: <span className="font-mono">{cred.key_name || 'Authorization'}</span></p>
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
                    total={credentials.length}
                    onPageChange={setCredPage}
                    onPageSizeChange={setCredPageSize}
                />
            </div>
        </div>
      </div>
    </div>
  );
}
