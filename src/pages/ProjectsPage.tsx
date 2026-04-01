import React, { useState, useEffect, useMemo } from 'react';
import { Folder, Plus, Trash2, DollarSign, Layers, Users, Link2, Loader2, ExternalLink, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import Pagination from '../components/Pagination';

interface Project {
  id: number;
  name: string;
  description: string;
  crews_count: number;
  agents_count: number;
  total_cost: number;
}

type PlatformProject = { id: string; name: string; createdAt: string };

async function readJsonOrText(res: Response) {
  const text = await res.text();
  if (!text) return { data: null as any, text: '' };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null as any, text };
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [platformProjects, setPlatformProjects] = useState<PlatformProject[]>([]);
  const [platformLinks, setPlatformLinks] = useState<Record<number, string>>({});
  const [ingestProjectId, setIngestProjectId] = useState<string | null>(null);
  const [linkingProject, setLinkingProject] = useState<Project | null>(null);
  const [platformProjectId, setPlatformProjectId] = useState<string>('');
  const [isLinking, setIsLinking] = useState(false);
  const [newPlatformProjectName, setNewPlatformProjectName] = useState('');
  const [isCreatingPlatformProject, setIsCreatingPlatformProject] = useState(false);
  const [projectsPage, setProjectsPage] = useState(1);
  const [projectsPageSize, setProjectsPageSize] = useState(8);

  useEffect(() => {
    fetchProjects();
    loadPlatformLinks();
    loadIngestionSelection();
  }, []);

  useEffect(() => {
    setProjectsPage(1);
  }, [projects.length]);

  const pagedProjects = useMemo(() => {
    const start = (projectsPage - 1) * projectsPageSize;
    return projects.slice(start, start + projectsPageSize);
  }, [projects, projectsPage, projectsPageSize]);

  const projectInsights = useMemo(() => {
    return {
      totalProjects: projects.length,
      totalCrews: projects.reduce((sum, project) => sum + project.crews_count, 0),
      totalAgents: projects.reduce((sum, project) => sum + project.agents_count, 0),
      totalCost: projects.reduce((sum, project) => sum + project.total_cost, 0),
    };
  }, [projects]);

  const fetchProjects = () => {
    fetch('/api/projects', { cache: 'no-store' })
      .then(res => {
          if (!res.ok) throw new Error('Failed to fetch projects');
          return res.json();
      })
      .then(setProjects)
      .catch(err => console.error(err));
  };

  const loadPlatformLinks = async () => {
    const res = await fetch('/api/projects/platform-links');
    if (!res.ok) return;
    const { data } = await readJsonOrText(res);
    setPlatformLinks(data?.links || {});
  };

  const loadIngestionSelection = async () => {
    const res = await fetch('/api/platform/ingestion');
    if (!res.ok) return;
    const { data } = await readJsonOrText(res);
    setIngestProjectId(data?.projectId ?? null);
  };

  const loadPlatformProjects = async () => {
    const res = await fetch('/api/v1/projects');
    if (!res.ok) return;
    const { data } = await readJsonOrText(res);
    setPlatformProjects(Array.isArray(data) ? data : []);
  };

  const openLinkModal = async (project: Project) => {
    setLinkingProject(project);
    setPlatformProjectId('');
    await loadPlatformProjects();
    const res = await fetch(`/api/projects/${project.id}/platform-link`);
    if (res.ok) {
      const { data } = await readJsonOrText(res);
      setPlatformProjectId(data.platformProjectId || '');
    }
  };

  const saveLink = async () => {
    if (!linkingProject) return;
    setIsLinking(true);
    try {
      const latest = await fetch('/api/projects', { cache: 'no-store' });
      const { data: latestProjects } = await readJsonOrText(latest);
      const latestList = Array.isArray(latestProjects) ? latestProjects as Project[] : [];
      const byId = latestList.find((p) => p.id === linkingProject.id);
      const byName = latestList.find((p) => p.name === linkingProject.name);
      const effectiveId = byId?.id ?? byName?.id;
      if (!effectiveId) throw new Error('Local project not found. Refresh the Projects page and try again.');

      const res = await fetch(`/api/projects/${effectiveId}/platform-link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformProjectId: platformProjectId || null, localProjectName: linkingProject.name }),
      });
      const { data, text } = await readJsonOrText(res);
      if (!res.ok) throw new Error(data?.error || text || 'Failed to update link');
      setLinkingProject(null);
      await loadPlatformLinks();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsLinking(false);
    }
  };

  const createPlatformProject = async () => {
    const name = newPlatformProjectName.trim();
    if (!name) return;
    setIsCreatingPlatformProject(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const { data, text } = await readJsonOrText(res);
      if (!res.ok) throw new Error(data?.error || text || 'Failed to create platform project');
      setNewPlatformProjectName('');
      await loadPlatformProjects();
      setPlatformProjectId(data.id);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsCreatingPlatformProject(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    setFormData({ name: '', description: '' });
    setIsCreating(false);
    fetchProjects();
  };

  const deleteProject = async (id: number) => {
    try {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete project');
        }
        fetchProjects();
        loadPlatformLinks();
    } catch (e: any) {
        alert(e.message);
    }
  };

  return (
    <div>
      <div className="swarm-hero p-6 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-white">Projects</h1>
            <p className="text-slate-300 mt-1">Group agents, crews, traces, and platform links into clear project spaces.</p>
          </div>
          <button
            onClick={() => setIsCreating((prev) => !prev)}
            className="bg-white/10 hover:bg-white/15 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-colors border border-white/10"
          >
            <Plus size={18} />
            {isCreating ? 'Close Builder' : 'New Project'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mt-6">
          {[
            { label: 'Projects', value: projectInsights.totalProjects },
            { label: 'Crews', value: projectInsights.totalCrews },
            { label: 'Agents', value: projectInsights.totalAgents },
            { label: 'Tracked Cost', value: `$${projectInsights.totalCost.toFixed(2)}` },
          ].map((item) => (
            <div key={item.label} className="telemetry-tile p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
              <div className="mt-2 text-3xl font-black text-white">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {isCreating && (
        <div className="mb-8 bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-4">
          <h3 className="text-lg font-semibold mb-4">Create New Project</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Project Name</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. Marketing Campaign Q1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
                placeholder="Optional description..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button 
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-slate-500 px-4 py-2 hover:text-slate-700"
              >
                Cancel
              </button>
              <button 
                type="submit"
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pagedProjects.map(project => {
          const linkedPlatformId = platformLinks[project.id];
          const isSelectedForIngest = !!linkedPlatformId && !!ingestProjectId && linkedPlatformId === ingestProjectId;
          return (
          <div key={project.id} className="bg-white p-6 rounded-xl border border-slate-200 hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <Folder size={24} />
              </div>
              <div className="flex items-center gap-2">
                <Link 
                  to={`/projects/${project.id}/traces`}
                  className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                >
                  View Traces
                </Link>
                <button
                  onClick={() => openLinkModal(project)}
                  className="text-xs font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded hover:bg-slate-100 transition-colors inline-flex items-center gap-1"
                  title="Link this project to a Platform project (used for project-wise runs/events)"
                >
                  <Link2 size={14} /> Link
                </button>
                <button 
                  onClick={() => deleteProject(project.id)}
                  className="text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            
            <h3 className="text-xl font-semibold text-slate-900 mb-1">{project.name}</h3>
            <p className="text-sm text-slate-500 mb-4 line-clamp-2 h-10">{project.description || "No description."}</p>
            
            <div className="flex items-center gap-4 text-sm text-slate-600 mb-4 bg-slate-50 p-3 rounded-lg">
                <div className="flex items-center gap-1.5" title="Crews">
                    <Layers size={16} className="text-slate-400" />
                    <span className="font-medium">{project.crews_count}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Agents">
                    <Users size={16} className="text-slate-400" />
                    <span className="font-medium">{project.agents_count}</span>
                </div>
                <div className="w-px h-4 bg-slate-300"></div>
                <div className="flex items-center gap-1.5" title="Total Cost">
                    <DollarSign size={16} className="text-slate-400" />
                    <span className="font-medium">${project.total_cost.toFixed(4)}</span>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-slate-700">Data Sources</div>
                {isSelectedForIngest && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                    <Check size={12} /> Ingestion Target
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Local</span>
                <span className="font-medium text-slate-700">SQLite (orchestrator.db)</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-500">Platform</span>
                {linkedPlatformId ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    <Link2 size={12} /> Linked
                  </span>
                ) : (
                  <span className="text-slate-400">Not linked</span>
                )}
              </div>
            </div>
          </div>
        )})}
        
        {projects.length === 0 && !isCreating && (
          <div className="col-span-full text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
            <p className="text-slate-500">No projects created yet.</p>
          </div>
        )}
        <div className="col-span-full">
          <Pagination
            page={projectsPage}
            pageSize={projectsPageSize}
            total={projects.length}
            onPageChange={setProjectsPage}
            onPageSizeChange={setProjectsPageSize}
          />
        </div>
      </div>

      {linkingProject && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <div className="text-lg font-semibold text-slate-900">Link project to Platform</div>
              <div className="text-sm text-slate-500 mt-1">
                {linkingProject.name} — choose which Platform project should receive runs/events for this project.
              </div>
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Platform project</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  value={newPlatformProjectName}
                  onChange={(e) => setNewPlatformProjectName(e.target.value)}
                  className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Create new platform project..."
                />
                <button
                  onClick={createPlatformProject}
                  disabled={isCreatingPlatformProject}
                  className="bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2"
                >
                  {isCreatingPlatformProject ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create
                </button>
              </div>
              <select
                value={platformProjectId}
                onChange={(e) => setPlatformProjectId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Not linked</option>
                {platformProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="text-xs text-slate-500">
                After linking, project traces will show Platform runs/events for that Platform project.
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => setLinkingProject(null)}
                className="text-slate-600 hover:text-slate-800 text-sm"
                disabled={isLinking}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <Link
                  to="/auth"
                  className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                  title="If you are not logged in, platform projects won't load."
                >
                  <ExternalLink size={14} /> Sign in
                </Link>
                <button
                  onClick={saveLink}
                  disabled={isLinking}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2"
                >
                  {isLinking ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
