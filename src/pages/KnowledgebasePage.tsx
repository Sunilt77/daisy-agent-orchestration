import React, { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, Database, Upload, Search } from 'lucide-react';

interface Project {
  id: string;
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

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadData();
    }
  }, [selectedProjectId]);

  const loadProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const projs = await response.json();
        setProjects(projs);
        if (projs.length > 0 && !selectedProjectId) {
          setSelectedProjectId(projs[0].id);
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
      // Load documents
      const docsResponse = await fetch(`/api/knowledgebase/documents?projectId=${selectedProjectId}`);
      if (docsResponse.ok) {
        const docs = await docsResponse.json();
        setDocuments(docs);
      }

      // Load indexes
      const indexesResponse = await fetch(`/api/knowledgebase/indexes?projectId=${selectedProjectId}`);
      if (indexesResponse.ok) {
        const idxs = await indexesResponse.json();
        setIndexes(idxs);
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
        body: formData
      });

      if (response.ok) {
        loadData();
      } else {
        alert('Failed to upload document');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      const response = await fetch(`/api/knowledgebase/documents/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        loadData();
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
        body: JSON.stringify({ projectId: selectedProjectId, name, description })
      });

      if (response.ok) {
        setShowCreateIndex(false);
        loadData();
      }
    } catch (error) {
      console.error('Create index error:', error);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledgebase</h1>
          <p className="text-gray-600">Manage documents and search indexes for AI agents</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'documents' && selectedProjectId && (
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
              <Upload size={16} />
              Upload Document
              <input
                type="file"
                className="hidden"
                accept=".txt,.pdf,.md"
                onChange={handleFileUpload}
              />
            </label>
          )}
          {activeTab === 'indexes' && selectedProjectId && (
            <button
              onClick={() => setShowCreateIndex(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Plus size={16} />
              Create Index
            </button>
          )}
        </div>
      </div>

      {/* Project Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Project</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a project...</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'documents'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText size={16} className="inline mr-2" />
          Documents ({documents.length})
        </button>
        <button
          onClick={() => setActiveTab('indexes')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'indexes'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Database size={16} className="inline mr-2" />
          Indexes ({indexes.length})
        </button>
      </div>

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{doc.name}</h3>
                  <p className="text-sm text-gray-600">{doc.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span>{doc.mimeType}</span>
                    {doc.fileSize && <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>}
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => deleteDocument(doc.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {documents.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>No documents uploaded yet</p>
              <p className="text-sm">Upload your first document to get started</p>
            </div>
          )}
        </div>
      )}

      {/* Indexes Tab */}
      {activeTab === 'indexes' && (
        <div className="grid gap-4">
          {indexes.map((index) => (
            <div key={index.id} className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">{index.name}</h3>
                  <p className="text-sm text-gray-600">{index.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span>Slug: {index.slug}</span>
                    <span>Status: {index.status}</span>
                    {index.stats && (
                      <>
                        <span>{index.stats.documentCount} docs</span>
                        <span>{index.stats.chunkCount} chunks</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-2 text-blue-600 hover:bg-blue-50 rounded">
                    <Search size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {indexes.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500">
              <Database size={48} className="mx-auto mb-4 opacity-50" />
              <p>No knowledgebase indexes created yet</p>
              <p className="text-sm">Create an index to enable semantic search</p>
            </div>
          )}
        </div>
      )}

      {/* Create Index Modal */}
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
  onCreate
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim(), description.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Create Knowledgebase Index</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}