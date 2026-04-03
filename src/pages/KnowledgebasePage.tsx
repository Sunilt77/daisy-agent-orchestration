import React, { useEffect, useMemo, useState } from 'react';
import { Database, FileText, Plus, Search, Trash2, Upload } from 'lucide-react';
import Pagination from '../components/Pagination';

interface Project {
  id: string | number;
  name: string;
}

interface Document {
  id: string;
  name: string;
  description?: string;
  mimeType: string;
  fileSize?: number;
  tags?: string[];
  createdAt: string;
  project: Project;
}

interface KnowledgebaseIndex {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  createdAt: string;
  project: Project;
  stats?: {
    documentCount: number;
    chunkCount: number;
    totalSize: number;
  };
}

export default function KnowledgebasePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [indexes, setIndexes] = useState<KnowledgebaseIndex[]>([]);
  const [activeTab, setActiveTab] = useState<'documents' | 'indexes'>('documents');
  const [showCreateIndex, setShowCreateIndex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'building'>('all');
  const [docPage, setDocPage] = useState(1);
  const [docPageSize, setDocPageSize] = useState(8);
  const [indexPage, setIndexPage] = useState(1);
  const [indexPageSize, setIndexPageSize] = useState(8);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadData();
    } else {
      setDocuments([]);
      setIndexes([]);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setDocPage(1);
    setIndexPage(1);
  }, [search, statusFilter, activeTab, selectedProjectId, documents.length, indexes.length]);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const projs = await response.json();
        setProjects(Array.isArray(projs) ? projs : []);
        if (Array.isArray(projs) && projs.length > 0 && !selectedProjectId) {
          setSelectedProjectId(String(projs[0].id));
        }
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const loadData = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const [docsResponse, indexesResponse] = await Promise.all([
        fetch(`/api/knowledgebase/documents?projectId=${selectedProjectId}`),
        fetch(`/api/knowledgebase/indexes?projectId=${selectedProjectId}`),
      ]);
      if (docsResponse.ok) {
        const docs = await docsResponse.json();
        setDocuments(Array.isArray(docs) ? docs : []);
      } else {
        setDocuments([]);
      }
      if (indexesResponse.ok) {
        const idxs = await indexesResponse.json();
        setIndexes(Array.isArray(idxs) ? idxs : []);
      } else {
        setIndexes([]);
      }
    } catch (error) {
      console.error('Failed to load knowledgebase data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProjectId) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', selectedProjectId);
    formData.append('name', file.name);
    formData.append('description', '');
    try {
      const response = await fetch('/api/knowledgebase/documents', {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        await loadData();
      } else {
        alert('Failed to upload document');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    } finally {
      event.target.value = '';
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      const response = await fetch(`/api/knowledgebase/documents/${id}`, { method: 'DELETE' });
      if (response.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const createIndex = async (name: string, description: string) => {
    if (!selectedProjectId) return;
    try {
      const response = await fetch('/api/knowledgebase/indexes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, name, description }),
      });
      if (response.ok) {
        setShowCreateIndex(false);
        await loadData();
      }
    } catch (error) {
      console.error('Create index error:', error);
    }
  };

  const projectName = useMemo(() => {
    const match = projects.find((project) => String(project.id) === selectedProjectId);
    return match?.name || 'Select project';
  }, [projects, selectedProjectId]);

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (!q) return true;
      const haystack = [doc.name, doc.description || '', doc.mimeType, ...(doc.tags || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [documents, search]);

  const filteredIndexes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return indexes.filter((index) => {
      const status = String(index.status || '').toLowerCase();
      if (statusFilter === 'ready' && status !== 'ready') return false;
      if (statusFilter === 'building' && status === 'ready') return false;
      if (!q) return true;
      const haystack = [index.name, index.slug, index.description || '', index.status || ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [indexes, search, statusFilter]);

  const pagedDocuments = useMemo(() => {
    const start = (docPage - 1) * docPageSize;
    return filteredDocuments.slice(start, start + docPageSize);
  }, [filteredDocuments, docPage, docPageSize]);

  const pagedIndexes = useMemo(() => {
    const start = (indexPage - 1) * indexPageSize;
    return filteredIndexes.slice(start, start + indexPageSize);
  }, [filteredIndexes, indexPage, indexPageSize]);

  const insightTotals = useMemo(() => {
    const totalChunks = indexes.reduce((sum, index) => sum + (index.stats?.chunkCount || 0), 0);
    return {
      documents: documents.length,
      indexes: indexes.length,
      chunks: totalChunks,
      projects: projects.length,
    };
  }, [documents, indexes, projects]);

  return (
    <div>
      <div className="swarm-hero p-6 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">Knowledgebase</h1>
            <p className="text-slate-300 mt-1">Curate project documents and retrieval indexes for reliable agent memory and context.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'documents' && selectedProjectId && (
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-xl hover:bg-white/15 cursor-pointer border border-white/10">
                <Upload size={16} />
                Upload Document
                <input type="file" className="hidden" accept=".txt,.pdf,.md" onChange={handleFileUpload} />
              </label>
            )}
            {activeTab === 'indexes' && selectedProjectId && (
              <button
                onClick={() => setShowCreateIndex(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/25 text-emerald-100 rounded-xl hover:bg-emerald-500/35 border border-emerald-300/30"
              >
                <Plus size={16} />
                Create Index
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mt-6">
          {[
            { label: 'Projects', value: insightTotals.projects },
            { label: 'Documents', value: insightTotals.documents },
            { label: 'Indexes', value: insightTotals.indexes },
            { label: 'Chunks', value: insightTotals.chunks },
          ].map((item) => (
            <div key={item.label} className="telemetry-tile p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
              <div className="mt-2 text-3xl font-black text-white">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Project</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full ui-select"
            >
              <option value="">Select a project...</option>
              {projects.map((project) => (
                <option key={String(project.id)} value={String(project.id)}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Search</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeTab === 'documents' ? 'Search docs, MIME type, tags...' : 'Search index name, slug, status...'}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('documents')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTab === 'documents' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileText size={13} className="inline mr-1" />
            Documents ({documents.length})
          </button>
          <button
            onClick={() => setActiveTab('indexes')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTab === 'indexes' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Database size={13} className="inline mr-1" />
            Indexes ({indexes.length})
          </button>
          {activeTab === 'indexes' && (
            <>
              {[
                { key: 'all', label: 'All Status' },
                { key: 'ready', label: 'Ready' },
                { key: 'building', label: 'Building/Other' },
              ].map((chip) => (
                <button
                  key={chip.key}
                  onClick={() => setStatusFilter(chip.key as typeof statusFilter)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    statusFilter === chip.key ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => { setSearch(''); setStatusFilter('all'); }}
            disabled={!search.trim() && statusFilter === 'all'}
            className="ml-auto rounded-full px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white"
          >
            Reset
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Project: <span className="font-semibold text-slate-700">{projectName}</span>
          {' • '}
          Showing{' '}
          <span className="font-semibold text-slate-700">
            {activeTab === 'documents' ? filteredDocuments.length : filteredIndexes.length}
          </span>
          {' '}of{' '}
          <span className="font-semibold text-slate-700">
            {activeTab === 'documents' ? documents.length : indexes.length}
          </span>
        </div>
      </div>

      {!selectedProjectId ? (
        <div className="text-center py-14 bg-slate-50 rounded-xl border border-dashed border-slate-300">
          <Database size={40} className="mx-auto text-slate-400 mb-3" />
          <p className="text-slate-600 font-medium">Select a project to manage its knowledgebase.</p>
        </div>
      ) : loading ? (
        <div className="text-center py-14 bg-slate-50 rounded-xl border border-dashed border-slate-300">
          <p className="text-slate-500">Loading knowledgebase data...</p>
        </div>
      ) : activeTab === 'documents' ? (
        <div className="space-y-4">
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-14 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <FileText size={40} className="mx-auto text-slate-400 mb-3" />
              <p className="text-slate-600 font-medium">
                {documents.length === 0 ? 'No documents uploaded yet.' : 'No documents match your filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pagedDocuments.map((doc) => (
                  <div key={doc.id} className="bg-white p-5 rounded-xl border border-slate-200 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{doc.name}</h3>
                        <p className="text-sm text-slate-500 mt-1">{doc.description || 'No description'}</p>
                      </div>
                      <button
                        onClick={() => deleteDocument(doc.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete document"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{doc.mimeType}</span>
                      {doc.fileSize ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{(doc.fileSize / 1024).toFixed(1)} KB</span> : null}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{new Date(doc.createdAt).toLocaleDateString()}</span>
                      {(doc.tags || []).slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5">{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Pagination
                page={docPage}
                pageSize={docPageSize}
                total={filteredDocuments.length}
                onPageChange={setDocPage}
                onPageSizeChange={setDocPageSize}
                pageSizeOptions={[4, 8, 12, 20]}
              />
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIndexes.length === 0 ? (
            <div className="text-center py-14 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <Database size={40} className="mx-auto text-slate-400 mb-3" />
              <p className="text-slate-600 font-medium">
                {indexes.length === 0 ? 'No indexes created yet.' : 'No indexes match your filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pagedIndexes.map((index) => (
                  <div key={index.id} className="bg-white p-5 rounded-xl border border-slate-200 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{index.name}</h3>
                        <p className="text-sm text-slate-500 mt-1">{index.description || 'No description'}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        String(index.status).toLowerCase() === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {index.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">Slug: {index.slug}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{new Date(index.createdAt).toLocaleDateString()}</span>
                      <span className="rounded-full bg-cyan-50 text-cyan-700 px-2 py-0.5">{index.stats?.documentCount || 0} docs</span>
                      <span className="rounded-full bg-cyan-50 text-cyan-700 px-2 py-0.5">{index.stats?.chunkCount || 0} chunks</span>
                    </div>
                  </div>
                ))}
              </div>
              <Pagination
                page={indexPage}
                pageSize={indexPageSize}
                total={filteredIndexes.length}
                onPageChange={setIndexPage}
                onPageSizeChange={setIndexPageSize}
                pageSizeOptions={[4, 8, 12, 20]}
              />
            </>
          )}
        </div>
      )}

      {showCreateIndex && (
        <CreateIndexModal
          onClose={() => setShowCreateIndex(false)}
          onCreate={createIndex}
        />
      )}
    </div>
  );
}

function CreateIndexModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onCreate(name.trim(), description.trim());
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xl max-w-md w-full">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Create Knowledgebase Index</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ui-input"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
