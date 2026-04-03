import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Plus, Trash2, Users, Brain, Target, Edit, Sparkles, 
  Check, X, Folder, Activity, Key, Play, Loader2, 
  ExternalLink, Shield, Zap, Globe, Save, ArrowRight, Search, List, LayoutGrid, ArrowUpDown, AudioLines, Radio
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Pagination from '../components/Pagination';

interface Agent {
  id: number;
  name: string;
  role: string;
  agent_role?: string;
}

interface VoiceConfigPreset {
  id: number;
  name: string;
  voice_id: string;
  tts_model_id: string;
  stt_model_id: string;
  output_format: string;
  sample_rate: number;
  language_code: string;
  auto_tts: boolean;
  notes?: string;
  meta?: {
    vad_enabled?: boolean;
    vad_silence_threshold_secs?: number;
    vad_threshold?: number;
    min_speech_duration_ms?: number;
    min_silence_duration_ms?: number;
    max_tokens_to_recompute?: number;
    browser_noise_suppression?: boolean;
    browser_echo_cancellation?: boolean;
    browser_auto_gain_control?: boolean;
  };
}

const DEFAULT_VAD_SILENCE_THRESHOLD_SECS = 0.8;
const DEFAULT_VAD_THRESHOLD = 0.6;
const DEFAULT_MIN_SPEECH_DURATION_MS = 220;
const DEFAULT_MIN_SILENCE_DURATION_MS = 420;
const DEFAULT_MAX_TOKENS_TO_RECOMPUTE = 5;

interface Crew {
  id: number;
  name: string;
  description: string;
  process: 'sequential' | 'hierarchical' | 'parallel';
  is_exposed: boolean;
  learning_enabled?: boolean;
  coordinator_agent_id?: number | null;
  coordinator_agent?: Agent | null;
  project_id?: number;
  max_runtime_ms?: number;
  max_cost_usd?: number;
  max_tool_calls?: number;
  voice_profile?: {
    voice_id?: string;
    tts_model_id?: string;
    stt_model_id?: string;
    output_format?: string;
    sample_rate?: number;
    language_code?: string;
    auto_tts?: boolean;
    meta?: VoiceConfigPreset['meta'];
  } | null;
  agents: Agent[];
}

export default function CrewsPage() {
  type CrewOptionalConfig = 'description' | 'limits' | 'voice' | 'exposure';
  const navigate = useNavigate();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [crewsPage, setCrewsPage] = useState(1);
  const [crewsPageSize, setCrewsPageSize] = useState(8);
  const [crewSearch, setCrewSearch] = useState('');
  const [processFilter, setProcessFilter] = useState<'all' | 'sequential' | 'hierarchical' | 'parallel'>('all');
  const [exposureFilter, setExposureFilter] = useState<'all' | 'exposed' | 'local'>('all');
  const [crewSortMode, setCrewSortMode] = useState<'name' | 'size' | 'process'>('size');
  const [crewView, setCrewView] = useState<'grid' | 'list'>('grid');
  const [visibleCrewConfigs, setVisibleCrewConfigs] = useState<CrewOptionalConfig[]>([]);
  const [crewConfigPicker, setCrewConfigPicker] = useState<'' | CrewOptionalConfig>('');

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    process: 'sequential' as 'sequential' | 'hierarchical' | 'parallel',
    agentIds: [] as number[],
    coordinator_agent_id: null as number | null,
    is_exposed: false,
    learning_enabled: true,
    max_runtime_ms: 120000,
    max_cost_usd: 5.0,
    max_tool_calls: 20,
    voice_id: 'JBFqnCBsd6RMkjVDRZzb',
    tts_model_id: 'eleven_multilingual_v2',
    stt_model_id: 'scribe_v2_realtime',
    voice_output_format: 'mp3_44100_128',
    voice_sample_rate: 16000,
    voice_language_code: 'en',
    voice_auto_tts: true,
    voice_vad_enabled: true,
    voice_vad_silence_threshold_secs: 0.8,
    voice_vad_threshold: 0.6,
    voice_min_speech_duration_ms: 220,
    voice_min_silence_duration_ms: 420,
    voice_max_tokens_to_recompute: 5,
    voice_browser_noise_suppression: true,
    voice_browser_echo_cancellation: true,
    voice_browser_auto_gain_control: false,
    voice_preset_id: '',
  });

  const [projects, setProjects] = useState<{id: number, name: string}[]>([]);
  const [providers, setProviders] = useState<{id: string, name: string, type: string}[]>([]);
  const [availableModels, setAvailableModels] = useState<{ id: string, name: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Auto-Build State
  const [isAutoBuilding, setIsAutoBuilding] = useState(false);
  const [autoBuildGoal, setAutoBuildGoal] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [buildEvents, setBuildEvents] = useState<{message: string, type: 'status' | 'error' | 'done', id?: number}[]>([]);
  const [autoBuildProvider, setAutoBuildProvider] = useState('google');
  const [autoBuildModel, setAutoBuildModel] = useState('');
  const [autoBuildProcessPreference, setAutoBuildProcessPreference] = useState<'auto' | 'sequential' | 'hierarchical' | 'parallel'>('auto');
  const [autoBuildProjectId, setAutoBuildProjectId] = useState('');

  const crewConfigOptions: Array<{ key: CrewOptionalConfig; label: string }> = [
    { key: 'description', label: 'Functional Brief' },
    { key: 'limits', label: 'Runtime/Cost Limits' },
    { key: 'voice', label: 'Voice Runtime' },
    { key: 'exposure', label: 'MCP Exposure' },
  ];
  const showCrewConfig = (key: CrewOptionalConfig) => visibleCrewConfigs.includes(key);
  const addCrewConfig = (key: CrewOptionalConfig) => {
    setVisibleCrewConfigs((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };
  const removeCrewConfig = (key: CrewOptionalConfig) => {
    setVisibleCrewConfigs((prev) => prev.filter((k) => k !== key));
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [crewsRes, agentsRes, projectsRes, providersRes] = await Promise.all([
        fetch('/api/crews'),
        fetch('/api/agents'),
        fetch('/api/projects'),
        fetch('/api/providers'),
      ]);
      const crewsData = await crewsRes.json();
      const agentsData = await agentsRes.json();
      const projectsData = await projectsRes.json();
      const providersData = await providersRes.json();
      
      setCrews(Array.isArray(crewsData) ? crewsData : []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      
      if (Array.isArray(providersData)) {
          const dbProviders = providersData.map((p: any) => ({ id: p.name, name: p.name, type: p.provider }));
          setProviders(dbProviders);
          if (dbProviders.length > 0 && !dbProviders.find((p: any) => p.id === autoBuildProvider)) {
              setAutoBuildProvider(dbProviders[0].id);
          }
      }
      const voiceConfigsRes = await fetch('/api/voice/configs');
      const voiceConfigData = await voiceConfigsRes.json().catch(() => []);
      setVoiceConfigs(Array.isArray(voiceConfigData) ? voiceConfigData : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchModelsForProvider = async (providerId: string) => {
    setIsLoadingModels(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/models`);
      let models: { id: string, name: string }[] = [];

      if (res.ok) {
        const fetchedModels = await res.json();
        if (Array.isArray(fetchedModels)) {
          models = fetchedModels;
        }
      }

      // NO HARDCODED FALLBACKS
      if (models.length === 0) {
        console.warn("No models returned from provider fetching for crew auto-build.");
      }

      setAvailableModels(models);
      if (models.length > 0 && (!autoBuildModel || !models.find(m => m.id === autoBuildModel))) {
          setAutoBuildModel(models[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => {
      if (isAutoBuilding) {
          fetchModelsForProvider(autoBuildProvider);
      }
  }, [autoBuildProvider, isAutoBuilding]);

  const autoBuildCrew = async () => {
      if (!autoBuildGoal) return;
      setIsBuilding(true);
      setBuildError('');
      setBuildEvents([]);

      try {
          const response = await fetch('/api/crews/autobuild', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  goal: autoBuildGoal,
                  project_id: autoBuildProjectId || null,
                  provider: autoBuildProvider,
                  model: autoBuildModel,
                  process_preference: autoBuildProcessPreference,
                  stream: true
              })
          });

          if (!response.ok) {
              let errorMessage = `Server error: ${response.status} ${response.statusText}`;
              try {
                  const contentType = response.headers.get('content-type');
                  if (contentType && contentType.includes('application/json')) {
                      const data = await response.json();
                      errorMessage = data.error || errorMessage;
                  } else {
                      const text = await response.text();
                      if (text && text.length < 200) errorMessage = text;
                  }
              } catch (parseError) {
                  console.error("Failed to parse error response", parseError);
              }
              throw new Error(errorMessage);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          while (true) {
              const { done, value } = await reader!.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                  if (line.startsWith('data: ')) {
                      try {
                          const event = JSON.parse(line.slice(6));
                          setBuildEvents(prev => [...prev, event]);

                          if (event.type === 'done') {
                              setTimeout(() => {
                                  navigate(`/crew/${event.id}`);
                              }, 1500);
                          } else if (event.type === 'error') {
                              setBuildError(event.message);
                              setIsBuilding(false);
                          }
                      } catch (e) {
                          console.error("Failed to parse event", e);
                      }
                  }
              }
          }
      } catch (e: any) {
          setBuildError(e.message);
          setIsBuilding(false);
      }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setCrewsPage(1);
  }, [crews.length]);

  const handleOpenModal = (crew: Crew | null = null) => {
    setSaveError('');
    setCrewConfigPicker('');
    if (crew) {
      setEditingCrew(crew);
      const initialConfigs: CrewOptionalConfig[] = [];
      if (crew.description) initialConfigs.push('description');
      if (crew.max_runtime_ms || crew.max_cost_usd || crew.max_tool_calls) initialConfigs.push('limits');
      if (crew.voice_profile) initialConfigs.push('voice');
      if (crew.is_exposed) initialConfigs.push('exposure');
      setVisibleCrewConfigs(initialConfigs);
      setFormData({
        name: crew.name,
        description: crew.description || '',
        process: crew.process || 'sequential',
        agentIds: crew.agents.map(a => a.id),
        coordinator_agent_id: crew.coordinator_agent_id ?? null,
        is_exposed: !!crew.is_exposed,
        learning_enabled: crew.learning_enabled !== false,
        max_runtime_ms: crew.max_runtime_ms || 120000,
        max_cost_usd: crew.max_cost_usd || 5.0,
        max_tool_calls: crew.max_tool_calls || 20,
        voice_id: String(crew.voice_profile?.voice_id || 'JBFqnCBsd6RMkjVDRZzb'),
        tts_model_id: String(crew.voice_profile?.tts_model_id || 'eleven_multilingual_v2'),
        stt_model_id: String(crew.voice_profile?.stt_model_id || 'scribe_v2_realtime'),
        voice_output_format: String(crew.voice_profile?.output_format || 'mp3_44100_128'),
        voice_sample_rate: Number(crew.voice_profile?.sample_rate || 16000),
        voice_language_code: String(crew.voice_profile?.language_code || 'en'),
        voice_auto_tts: Boolean(crew.voice_profile?.auto_tts ?? true),
        voice_vad_enabled: Boolean(crew.voice_profile?.meta?.vad_enabled ?? true),
        voice_vad_silence_threshold_secs: Number(crew.voice_profile?.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
        voice_vad_threshold: Number(crew.voice_profile?.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD),
        voice_min_speech_duration_ms: Number(crew.voice_profile?.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS),
        voice_min_silence_duration_ms: Number(crew.voice_profile?.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS),
        voice_max_tokens_to_recompute: Number(crew.voice_profile?.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
        voice_browser_noise_suppression: Boolean(crew.voice_profile?.meta?.browser_noise_suppression ?? true),
        voice_browser_echo_cancellation: Boolean(crew.voice_profile?.meta?.browser_echo_cancellation ?? true),
        voice_browser_auto_gain_control: Boolean(crew.voice_profile?.meta?.browser_auto_gain_control ?? false),
        voice_preset_id: String((crew.voice_profile as any)?.meta?.preset_id || ''),
      });
    } else {
      setEditingCrew(null);
      setVisibleCrewConfigs([]);
      setFormData({
        name: '',
        description: '',
        process: 'sequential',
        agentIds: [],
        coordinator_agent_id: null,
        is_exposed: false,
        learning_enabled: true,
        max_runtime_ms: 120000,
        max_cost_usd: 5.0,
        max_tool_calls: 20,
        voice_id: 'JBFqnCBsd6RMkjVDRZzb',
        tts_model_id: 'eleven_multilingual_v2',
        stt_model_id: 'scribe_v2_realtime',
        voice_output_format: 'mp3_44100_128',
        voice_sample_rate: 16000,
        voice_language_code: 'en',
        voice_auto_tts: true,
        voice_vad_enabled: true,
        voice_vad_silence_threshold_secs: 0.8,
        voice_vad_threshold: 0.6,
        voice_min_speech_duration_ms: 220,
        voice_min_silence_duration_ms: 420,
        voice_max_tokens_to_recompute: 5,
        voice_browser_noise_suppression: true,
        voice_browser_echo_cancellation: true,
        voice_browser_auto_gain_control: false,
        voice_preset_id: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    if (formData.agentIds.length === 0) {
      setSaveError('Select at least one agent to create a crew.');
      return;
    }
    if (formData.process === 'hierarchical' && formData.agentIds.length < 2) {
      setSaveError('Hierarchical process requires at least two agents (one coordinator + one specialist).');
      return;
    }
    if (formData.coordinator_agent_id != null && !formData.agentIds.includes(formData.coordinator_agent_id)) {
      setSaveError('Coordinator must be selected from assigned crew agents.');
      return;
    }
    const url = editingCrew ? `/api/crews/${editingCrew.id}` : '/api/crews';
    const method = editingCrew ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save crew');
      const savedCrewId = Number(data?.id || editingCrew?.id);
      if (Number.isFinite(savedCrewId) && savedCrewId > 0) {
        const voiceRes = await fetch(`/api/voice/crews/${savedCrewId}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voice_id: formData.voice_id,
            tts_model_id: formData.tts_model_id,
            stt_model_id: formData.stt_model_id,
            output_format: formData.voice_output_format,
            sample_rate: Number(formData.voice_sample_rate || 16000),
            language_code: formData.voice_language_code,
            auto_tts: Boolean(formData.voice_auto_tts),
            meta: {
              preset_id: formData.voice_preset_id ? Number(formData.voice_preset_id) : null,
              vad_enabled: Boolean(formData.voice_vad_enabled),
              vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
              vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
              min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
              min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
              max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
              browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
              browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
              browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
            },
          }),
        });
        const voiceData = await voiceRes.json().catch(() => ({}));
        if (!voiceRes.ok) throw new Error(voiceData?.error || 'Crew saved, but voice profile failed to save');
      }
      setIsModalOpen(false);
      loadData();
    } catch (e: any) {
      setSaveError(e.message || 'Failed to save crew');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this crew?')) return;
    try {
      const res = await fetch(`/api/crews/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete crew');
      loadData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleExposed = async (crew: Crew) => {
    try {
      const res = await fetch(`/api/crews/${crew.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...crew,
          agentIds: crew.agents.map(a => a.id),
          is_exposed: !crew.is_exposed
        })
      });
      if (!res.ok) throw new Error('Failed to update exposure');
      loadData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const crewInsights = useMemo(() => {
    const hierarchical = crews.filter((crew) => crew.process === 'hierarchical').length;
    const parallel = crews.filter((crew) => crew.process === 'parallel').length;
    const exposed = crews.filter((crew) => crew.is_exposed).length;
    const totalAgentsAssigned = crews.reduce((sum, crew) => sum + crew.agents.length, 0);
    return {
      hierarchical,
      parallel,
      exposed,
      totalAgentsAssigned,
      avgTeamSize: crews.length ? (totalAgentsAssigned / crews.length).toFixed(1) : '0.0',
    };
  }, [crews]);

  const filteredCrews = useMemo(() => {
    const query = crewSearch.trim().toLowerCase();
    const filtered = crews.filter((crew) => {
      const matchesQuery = !query || [
        crew.name,
        crew.description,
        crew.process,
        crew.coordinator_agent?.name,
        ...crew.agents.map((agent) => `${agent.name} ${agent.role} ${agent.agent_role || ''}`),
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      const matchesProcess = processFilter === 'all' || crew.process === processFilter;
      const matchesExposure = exposureFilter === 'all' || (exposureFilter === 'exposed' ? crew.is_exposed : !crew.is_exposed);
      return matchesQuery && matchesProcess && matchesExposure;
    });

    return [...filtered].sort((a, b) => {
      if (crewSortMode === 'name') return a.name.localeCompare(b.name);
      if (crewSortMode === 'process') return a.process.localeCompare(b.process);
      return b.agents.length - a.agents.length;
    });
  }, [crews, crewSearch, processFilter, exposureFilter, crewSortMode]);

  const pagedCrews = useMemo(() => {
    const start = (crewsPage - 1) * crewsPageSize;
    return filteredCrews.slice(start, start + crewsPageSize);
  }, [filteredCrews, crewsPage, crewsPageSize]);

  const selectedCrewAgents = useMemo(
    () => agents.filter((agent) => formData.agentIds.includes(agent.id)),
    [agents, formData.agentIds]
  );
  const coordinatorPreview = useMemo(() => {
    if (!selectedCrewAgents.length) return null;
    if (formData.coordinator_agent_id != null) {
      return selectedCrewAgents.find((agent) => agent.id === formData.coordinator_agent_id) || null;
    }
    return selectedCrewAgents.find((agent) => agent.agent_role === 'supervisor') || selectedCrewAgents[0] || null;
  }, [selectedCrewAgents, formData.coordinator_agent_id]);
  const resetCrewFilters = () => {
    setCrewSearch('');
    setProcessFilter('all');
    setExposureFilter('all');
    setCrewSortMode('size');
  };
  const selectedSupervisorCount = useMemo(
    () => selectedCrewAgents.filter((agent) => agent.agent_role === 'supervisor').length,
    [selectedCrewAgents]
  );
  const selectedSpecialistCount = useMemo(
    () => selectedCrewAgents.filter((agent) => agent.agent_role !== 'supervisor').length,
    [selectedCrewAgents]
  );

  const applyVoicePreset = (presetId: string) => {
    const preset = voiceConfigs.find((item) => String(item.id) === String(presetId));
    if (!preset) {
      setFormData((prev) => ({ ...prev, voice_preset_id: '' }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      voice_preset_id: presetId,
      voice_id: String(preset.voice_id || 'JBFqnCBsd6RMkjVDRZzb'),
      tts_model_id: String(preset.tts_model_id || 'eleven_multilingual_v2'),
      stt_model_id: String(preset.stt_model_id || 'scribe_v2_realtime'),
      voice_output_format: String(preset.output_format || 'mp3_44100_128'),
      voice_sample_rate: Number(preset.sample_rate || 16000),
      voice_language_code: String(preset.language_code || 'en'),
      voice_auto_tts: Boolean(preset.auto_tts ?? true),
      voice_vad_enabled: Boolean(preset.meta?.vad_enabled ?? true),
      voice_vad_silence_threshold_secs: Number(preset.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
      voice_vad_threshold: Number(preset.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD),
      voice_min_speech_duration_ms: Number(preset.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS),
      voice_min_silence_duration_ms: Number(preset.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS),
      voice_max_tokens_to_recompute: Number(preset.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
      voice_browser_noise_suppression: Boolean(preset.meta?.browser_noise_suppression ?? true),
      voice_browser_echo_cancellation: Boolean(preset.meta?.browser_echo_cancellation ?? true),
      voice_browser_auto_gain_control: Boolean(preset.meta?.browser_auto_gain_control ?? false),
    }));
  };

  const saveCurrentVoicePreset = async () => {
    const name = window.prompt('Voice preset name');
    if (!name?.trim()) return;
    const res = await fetch('/api/voice/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        voice_id: formData.voice_id,
        tts_model_id: formData.tts_model_id,
        stt_model_id: formData.stt_model_id,
        output_format: formData.voice_output_format,
        sample_rate: Number(formData.voice_sample_rate || 16000),
        language_code: formData.voice_language_code,
        auto_tts: Boolean(formData.voice_auto_tts),
        meta: {
          vad_enabled: Boolean(formData.voice_vad_enabled),
          vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
          vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
          min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
          min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
          max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
          browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
          browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
          browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(String((data as any)?.error || 'Failed to save voice preset'));
      return;
    }
    await loadData();
    setFormData((prev) => ({ ...prev, voice_preset_id: String((data as any)?.id || '') }));
  };

  const updateSelectedVoicePreset = async () => {
    if (!formData.voice_preset_id) return;
    const preset = voiceConfigs.find((item) => String(item.id) === String(formData.voice_preset_id));
    if (!preset) return;
    const res = await fetch(`/api/voice/configs/${formData.voice_preset_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: preset.name,
        voice_id: formData.voice_id,
        tts_model_id: formData.tts_model_id,
        stt_model_id: formData.stt_model_id,
        output_format: formData.voice_output_format,
        sample_rate: Number(formData.voice_sample_rate || 16000),
        language_code: formData.voice_language_code,
        auto_tts: Boolean(formData.voice_auto_tts),
        meta: {
          vad_enabled: Boolean(formData.voice_vad_enabled),
          vad_silence_threshold_secs: Number(formData.voice_vad_silence_threshold_secs || DEFAULT_VAD_SILENCE_THRESHOLD_SECS),
          vad_threshold: Number(formData.voice_vad_threshold || DEFAULT_VAD_THRESHOLD),
          min_speech_duration_ms: Number(formData.voice_min_speech_duration_ms || DEFAULT_MIN_SPEECH_DURATION_MS),
          min_silence_duration_ms: Number(formData.voice_min_silence_duration_ms || DEFAULT_MIN_SILENCE_DURATION_MS),
          max_tokens_to_recompute: Number(formData.voice_max_tokens_to_recompute || DEFAULT_MAX_TOKENS_TO_RECOMPUTE),
          browser_noise_suppression: Boolean(formData.voice_browser_noise_suppression),
          browser_echo_cancellation: Boolean(formData.voice_browser_echo_cancellation),
          browser_auto_gain_control: Boolean(formData.voice_browser_auto_gain_control),
        },
        notes: preset.notes || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(String((data as any)?.error || 'Failed to update voice preset'));
      return;
    }
    await loadData();
  };

  const deleteSelectedVoicePreset = async () => {
    if (!formData.voice_preset_id || !window.confirm('Delete this voice preset?')) return;
    await fetch(`/api/voice/configs/${formData.voice_preset_id}`, { method: 'DELETE' });
    await loadData();
    setFormData((prev) => ({ ...prev, voice_preset_id: '' }));
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Sparkles className="text-indigo-600" size={32} />
            Crews
          </h1>
          <p className="text-slate-500 mt-2 font-medium">Coordinate multiple specialized agents to achieve complex goals.</p>
        </div>
        <div className="flex gap-3">
            <button 
                onClick={() => setIsAutoBuilding(true)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-2xl flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-purple-100 font-bold"
            >
                <Sparkles size={18} />
                Auto-Build Crew
            </button>
            <button
            onClick={() => handleOpenModal()}
            className="panel-chrome flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-brand-700 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-brand-100/50"
            >
            <Plus size={18} />
            Architect New Crew
            </button>
        </div>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-linear-to-r from-amber-50 via-white to-indigo-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-amber-600">Crew Strategy</div>
            <h3 className="mt-2 text-xl font-black text-slate-900">Use hierarchical crews for coordinator plus specialist teams.</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Sequential crews are great for fixed handoff chains. Parallel crews are best for independent workstreams. Hierarchical crews are best when one coordinator should route specialist delegations and synthesize the final answer.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:w-[640px]">
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Sequential</div>
              <div className="mt-2 text-sm text-slate-700">Best for deterministic step-by-step pipelines where each agent hands its output to the next one.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Hierarchical</div>
              <div className="mt-2 text-sm text-slate-700">Best for supervisor routing, parallel specialist work, and final synthesis from delegated child runs.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Parallel</div>
              <div className="mt-2 text-sm text-slate-700">Best for independent specialist tasks that run concurrently and merge into one synthesized output.</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Setup Tip</div>
              <div className="mt-2 text-sm text-slate-700">Mark one agent as `supervisor`, attach domain integrations to specialists, and let the crew coordinator orchestrate.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {[
          { label: 'Total Crews', value: crews.length.toString() },
          { label: 'Hierarchical', value: crewInsights.hierarchical.toString() },
          { label: 'Parallel', value: crewInsights.parallel.toString() },
          { label: 'Exposed', value: crewInsights.exposed.toString() },
          { label: 'Avg Team Size', value: crewInsights.avgTeamSize },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">{item.label}</div>
            <div className="mt-2 text-2xl font-black text-slate-900">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-sm backdrop-blur">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.7fr))_auto]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Search crews, coordinators, or assigned agents..."
              value={crewSearch}
              onChange={(e) => setCrewSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={processFilter}
            onChange={(e) => setProcessFilter(e.target.value as 'all' | 'sequential' | 'hierarchical' | 'parallel')}
          >
            <option value="all">All Processes</option>
            <option value="hierarchical">Hierarchical</option>
            <option value="parallel">Parallel</option>
            <option value="sequential">Sequential</option>
          </select>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={exposureFilter}
            onChange={(e) => setExposureFilter(e.target.value as 'all' | 'exposed' | 'local')}
          >
            <option value="all">All Exposure</option>
            <option value="exposed">Exposed</option>
            <option value="local">Local Only</option>
          </select>
          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            value={crewSortMode}
            onChange={(e) => setCrewSortMode(e.target.value as 'name' | 'size' | 'process')}
          >
            <option value="size">Sort: Team Size</option>
            <option value="name">Sort: Name</option>
            <option value="process">Sort: Process</option>
          </select>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            <ArrowUpDown size={14} className="text-slate-400" />
            {filteredCrews.length} visible
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setCrewView('grid')}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${crewView === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCrewView('list')}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${crewView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { label: 'All', onClick: () => { setProcessFilter('all'); setExposureFilter('all'); } },
            { label: 'Hierarchical', onClick: () => setProcessFilter('hierarchical') },
            { label: 'Parallel', onClick: () => setProcessFilter('parallel') },
            { label: 'Exposed', onClick: () => setExposureFilter('exposed') },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onClick}
              className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {chip.label}
            </button>
          ))}
          <button
            type="button"
            onClick={resetCrewFilters}
            className="ml-auto px-3 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 animate-pulse">
          <Loader2 className="text-indigo-600 animate-spin mb-4" size={48} />
          <p className="text-slate-400 font-bold tracking-widest uppercase text-xs">Loading Syndicates...</p>
        </div>
      ) : filteredCrews.length === 0 ? (
        <div className="panel-chrome rounded-3xl p-12 text-center border-2 border-dashed border-slate-200">
          <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Users className="text-slate-300" size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-900">{crews.length === 0 ? 'No Crews Found' : 'No Matching Crews'}</h3>
          <p className="text-slate-500 mt-2 max-w-md mx-auto">
            {crews.length === 0
              ? 'Build your first AI team by combining agents from your library.'
              : 'Adjust search or filters to see more orchestration teams.'}
          </p>
          {crews.length === 0 ? (
            <button
              onClick={() => handleOpenModal()}
              className="mt-8 text-indigo-600 font-bold text-sm hover:underline"
            >
              Create your first crew →
            </button>
          ) : null}
        </div>
      ) : (
        <div className={`grid gap-6 ${crewView === 'grid' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
          {pagedCrews.map(crew => (
            <motion.div
              layout
              key={crew.id}
              className="panel-chrome group rounded-3xl p-6 relative overflow-hidden border border-slate-100 hover:border-indigo-200 transition-all duration-300"
            >
              <div className={`relative z-10 ${crewView === 'list' ? 'flex items-start justify-between gap-6' : 'flex items-start justify-between'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-xl font-bold text-slate-900 truncate">{crew.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      crew.process === 'hierarchical'
                        ? 'bg-amber-100 text-amber-700'
                        : crew.process === 'parallel'
                          ? 'bg-cyan-100 text-cyan-700'
                          : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {crew.process}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2 min-h-[2.5rem] mb-4">
                    {crew.description || 'No description provided.'}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {crew.agents.length} agents
                    </span>
                    {crew.coordinator_agent?.name && crew.process === 'hierarchical' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                        Coordinator: {crew.coordinator_agent.name}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2 mb-6">
                    {crew.agents.map(agent => (
                      <div key={agent.id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-600">
                        <Brain size={12} className="text-indigo-400" />
                        {agent.name}
                        {agent.agent_role && (
                          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider ${
                            agent.agent_role === 'supervisor'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-cyan-100 text-cyan-700'
                          }`}>
                            {agent.agent_role}
                          </span>
                        )}
                      </div>
                    ))}
                    {crew.agents.length === 0 && (
                      <span className="text-xs text-slate-400 italic">No agents assigned</span>
                    )}
                  </div>
                  {crew.process === 'hierarchical' && (
                    <div className="mb-4 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Coordinator: {crew.coordinator_agent?.name || crew.agents.find((a) => a.id === crew.coordinator_agent_id)?.name || 'Auto Select'}
                    </div>
                  )}
                </div>

                <div className={`flex ${crewView === 'list' ? 'flex-row md:flex-col' : 'flex-col'} gap-2 ml-4 shrink-0`}>
                  <button
                    onClick={() => navigate(`/crew/${crew.id}`)}
                    className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
                    title="Run Crew"
                  >
                    <Play size={18} fill="currentColor" />
                  </button>
                  <button
                    onClick={() => handleOpenModal(crew)}
                    className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(crew.id)}
                    className="p-2.5 rounded-xl bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-100 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 mt-2 border-t border-slate-100">
                <div className="flex items-center gap-4">
                   <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                     <Shield size={14} className={crew.is_exposed ? 'text-emerald-500' : 'text-slate-300'} />
                     {crew.is_exposed ? 'Exposed to MCP' : 'Local Only'}
                   </div>
                   <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                     <Zap size={14} className="text-indigo-400" />
                     {crew.max_runtime_ms ? `${(crew.max_runtime_ms / 1000).toFixed(0)}s limit` : 'No limit'}
                   </div>
                </div>
                
                <label className="relative inline-flex items-center cursor-pointer group/toggle">
                  <input
                    type="checkbox"
                    checked={!!crew.is_exposed}
                    onChange={() => toggleExposed(crew)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 shadow-inner"></div>
                </label>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {!isLoading && crews.length > 0 && (
        <div className="mt-6">
          <Pagination
            page={crewsPage}
            pageSize={crewsPageSize}
            total={filteredCrews.length}
            onPageChange={setCrewsPage}
            onPageSizeChange={setCrewsPageSize}
            pageSizeOptions={[6, 8, 12, 16]}
          />
        </div>
      )}

      {/* Auto-Build Modal */}
      {isAutoBuilding && (
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-in fade-in duration-200"
            onClick={() => !isBuilding && setIsAutoBuilding(false)}
          >
              <div 
                className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                  <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-purple-50/50">
                      <div>
                        <h3 className="text-xl font-black text-purple-900 flex items-center gap-2 tracking-tight">
                            <Sparkles size={24} className="text-purple-600" />
                            Auto-Build Syndicate
                        </h3>
                        <p className="text-[10px] text-purple-600 font-bold uppercase tracking-widest mt-1">AI-Assisted Team Architecture</p>
                      </div>
                      <button 
                        onClick={() => !isBuilding && setIsAutoBuilding(false)} 
                        className="p-2 rounded-xl hover:bg-purple-100 transition-colors text-purple-400"
                        disabled={isBuilding}
                      >
                          <X size={24} />
                      </button>
                  </div>
                  
                  <div className="p-8 overflow-y-auto">
                      <p className="text-slate-600 mb-6 text-sm font-medium">
                          Describe your goal, and our AI Architect will select the best agents from your library (or design new specialists) and wire them into a cohesive syndicate.
                      </p>
                      
                      <div className="space-y-4">
                          <div className="space-y-1">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Mission Objective</label>
                              <textarea
                                  className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 outline-none h-32 resize-none bg-slate-50/50 font-medium text-slate-700 transition-all"
                                  placeholder="e.g. Conduct a deep analysis of the current EV market and generate a series of engaging tweets about the findings."
                                  value={autoBuildGoal}
                                  onChange={(e) => setAutoBuildGoal(e.target.value)}
                                  disabled={isBuilding}
                              />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Inference Provider</label>
                                <select
                                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-purple-500/10 outline-none bg-slate-50/50 font-bold text-slate-700 transition-all appearance-none"
                                    value={autoBuildProvider}
                                    onChange={(e) => setAutoBuildProvider(e.target.value)}
                                    disabled={isBuilding}
                                >
                                    {providers.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Cerebral Model</label>
                                <select
                                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-purple-500/10 outline-none bg-slate-50/50 font-bold text-slate-700 transition-all appearance-none"
                                    value={autoBuildModel}
                                    onChange={(e) => setAutoBuildModel(e.target.value)}
                                    disabled={isBuilding || isLoadingModels}
                                >
                                    {isLoadingModels ? (
                                        <option value="">Syncing models...</option>
                                    ) : (
                                        availableModels.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))
                                    )}
                                </select>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Process Preference</label>
                            <select
                                className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-purple-500/10 outline-none bg-slate-50/50 font-bold text-slate-700 transition-all appearance-none"
                                value={autoBuildProcessPreference}
                                onChange={(e) => setAutoBuildProcessPreference(e.target.value as 'auto' | 'sequential' | 'hierarchical' | 'parallel')}
                                disabled={isBuilding}
                            >
                                <option value="auto">Auto Decide</option>
                                <option value="sequential">Sequential</option>
                                <option value="parallel">Parallel</option>
                                <option value="hierarchical">Hierarchical</option>
                            </select>
                            <p className="text-[11px] text-slate-500">
                              Parallel crews run independent specialists together. Hierarchical crews create a coordinator/supervisor. Sequential crews pass work step by step.
                            </p>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Target Project (Optional)</label>
                            <select
                                className="w-full px-4 py-3 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-purple-500/10 outline-none bg-slate-50/50 font-bold text-slate-700 transition-all appearance-none"
                                value={autoBuildProjectId}
                                onChange={(e) => setAutoBuildProjectId(e.target.value)}
                                disabled={isBuilding}
                            >
                                <option value="">Global Workforce</option>
                                {projects.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                      </div>

                      {buildEvents.length > 0 && (
                        <div className="mt-8 space-y-3">
                            <div className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <Activity size={12} /> Neural Design Stream
                            </div>
                            <div className="bg-slate-900 rounded-2xl p-4 font-mono text-[11px] space-y-2 max-h-48 overflow-y-auto shadow-inner border border-slate-800">
                                <AnimatePresence mode='popLayout'>
                                    {buildEvents.map((event, i) => (
                                        <motion.div 
                                            key={i}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className={`${event.type === 'error' ? 'text-red-400' : event.type === 'done' ? 'text-emerald-400' : 'text-slate-400'} flex items-start gap-2`}
                                        >
                                            <span className="text-slate-600 shrink-0">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                                            <span className="leading-relaxed">
                                                {event.message}
                                            </span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div id="stream-end" />
                            </div>
                        </div>
                      )}

                      {buildError && (
                          <div className="mt-6 p-4 bg-red-50 text-red-700 text-xs font-bold rounded-2xl border border-red-100 flex items-center gap-3">
                               <X size={16} className="shrink-0" />
                               {buildError}
                          </div>
                      )}

                      <div className="flex justify-end gap-3 mt-8">
                          <button 
                              onClick={() => {
                                  setIsAutoBuilding(false);
                                  setBuildEvents([]);
                              }}
                              className="px-6 py-3 text-slate-500 hover:text-slate-900 rounded-2xl font-bold text-sm transition-colors"
                              disabled={isBuilding}
                          >
                              Cancel
                          </button>
                          <button 
                              onClick={autoBuildCrew}
                              className="premium-gradient text-white px-8 py-3 rounded-2xl flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-purple-200 font-bold text-sm disabled:opacity-50"
                              disabled={isBuilding || !autoBuildGoal}
                          >
                              {isBuilding ? (
                                  <>
                                      <Loader2 size={18} className="animate-spin" />
                                      Architecting...
                                  </>
                              ) : (
                                  <>
                                      <Sparkles size={18} />
                                      Build Syndicate
                                  </>
                              )}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/85 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-[min(96vw,1400px)] h-[92vh] bg-white rounded-[1.5rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleSave} className="flex flex-col h-full">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {editingCrew ? 'Synthesize Modification' : 'Initialize Syndicate'}
                    </h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Crew Configuration Interface</p>
                    <p className="mt-2 text-xs text-slate-400 uppercase tracking-[0.18em]">
                      Keep the collaboration design visible first. Open voice serving and exposure only when this crew actually needs them.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
                
                <div className="flex-1 min-h-0 p-8 overflow-y-auto space-y-6 custom-scrollbar">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Syndicate Name</label>
                      <input
                        required
                        className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-bold text-slate-900"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Strategic Analyst Pod"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Process Matrix</label>
                      <select
                        className="w-full ui-select !rounded-2xl !bg-slate-50 !border-slate-200 focus:!bg-white !font-bold text-slate-900 appearance-none"
                        value={formData.process}
                        onChange={e => {
                          const nextProcess = e.target.value as 'sequential' | 'hierarchical' | 'parallel';
                          setFormData((prev) => ({
                            ...prev,
                            process: nextProcess,
                            coordinator_agent_id: (nextProcess === 'hierarchical' || nextProcess === 'parallel')
                              ? (prev.coordinator_agent_id ?? prev.agentIds[0] ?? null)
                              : prev.coordinator_agent_id,
                          }));
                        }}
                      >
                        <option value="sequential">Sequential Loop</option>
                        <option value="parallel">Parallel Fan-Out</option>
                        <option value="hierarchical">Hierarchical Stack</option>
                      </select>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/60 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Add Configuration</label>
                      <select
                        className="ui-select !py-1.5 !text-xs min-w-[220px]"
                        value={crewConfigPicker}
                        onChange={(e) => {
                          const key = e.target.value as CrewOptionalConfig;
                          if (!key) return;
                          addCrewConfig(key);
                          setCrewConfigPicker('');
                        }}
                      >
                        <option value="">Choose optional section...</option>
                        {crewConfigOptions
                          .filter((opt) => !visibleCrewConfigs.includes(opt.key))
                          .map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                      </select>
                    </div>
                    {visibleCrewConfigs.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {visibleCrewConfigs.map((key) => (
                          <span key={key} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-white border border-slate-200 rounded-full text-slate-700">
                            {crewConfigOptions.find((o) => o.key === key)?.label || key}
                            <button type="button" onClick={() => removeCrewConfig(key)} className="text-slate-400 hover:text-red-500">
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Coordinator Agent (Optional)</label>
                    <select
                      className="w-full ui-select !rounded-2xl !bg-slate-50 !border-slate-200 focus:!bg-white !font-bold text-slate-900"
                      value={formData.coordinator_agent_id ?? ''}
                      onChange={(e) => setFormData({ ...formData, coordinator_agent_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Auto Select</option>
                      {selectedCrewAgents
                        .map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} ({agent.role}{agent.agent_role ? ` • ${agent.agent_role}` : ''})
                          </option>
                        ))}
                    </select>
                    <p className="text-[11px] text-slate-500">
                      For hierarchical and parallel crews, this agent can drive final synthesis.
                    </p>
                  </div>

                  {(formData.process === 'hierarchical' || formData.process === 'parallel') && coordinatorPreview && (
                    <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-violet-600 mb-1">Coordinator Preview</div>
                      <div className="text-sm font-semibold text-violet-900">
                        {coordinatorPreview.name} <span className="text-violet-600">({coordinatorPreview.role})</span>
                      </div>
                      <div className="mt-1 text-[11px] text-violet-700">
                        {formData.coordinator_agent_id != null
                          ? 'Explicitly selected coordinator.'
                          : coordinatorPreview.agent_role === 'supervisor'
                            ? 'Auto-selected because this agent is marked as a supervisor.'
                            : 'Auto-selected as the first available crew agent.'}
                      </div>
                    </div>
                  )}

                  <div className={`rounded-2xl border px-4 py-3 ${
                    formData.process === 'hierarchical'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : formData.process === 'parallel'
                        ? 'bg-cyan-50 border-cyan-200 text-cyan-800'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                  }`}>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1">
                      {formData.process === 'hierarchical'
                        ? 'Hierarchical Handshake'
                        : formData.process === 'parallel'
                          ? 'Parallel Handshake'
                          : 'Sequential Handshake'}
                    </div>
                    <div className="text-sm">
                      {formData.process === 'hierarchical'
                        ? 'Coordinator plans/delegates, then synthesizes a cumulative final answer from all agent outputs.'
                        : formData.process === 'parallel'
                          ? 'Agents run concurrently as independent specialists, then one synthesis step merges all outputs into a final answer.'
                          : 'Agents run in selected order. Each step receives the previous step output and contributes to one final cumulative answer.'}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Coordinator + Specialists Guidance</div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Selected Supervisors</div>
                        <div className="mt-2 text-lg font-black text-slate-900">{selectedSupervisorCount}</div>
                        <div className="mt-1 text-[11px] text-slate-600">Ideally one coordinator for hierarchical and parallel crews.</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Selected Specialists</div>
                        <div className="mt-2 text-lg font-black text-slate-900">{selectedSpecialistCount}</div>
                        <div className="mt-1 text-[11px] text-slate-600">Attach MCP bundles and domain tools to these agents.</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Recommended Pattern</div>
                        <div className="mt-2 text-[11px] leading-5 text-slate-700">
                          Keep the coordinator orchestration-focused. Let specialists own actual HTTP tools, local tools, and MCP bundles for their domain.
                        </div>
                      </div>
                    </div>
                  </div>

                  {showCrewConfig('description') && (
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Functional Brief</label>
                    <textarea
                      rows={3}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-medium text-slate-700"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Describe the collaborative objective of this crew..."
                    />
                  </div>
                  )}

                  <div className="space-y-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Agent Selection ({formData.agentIds.length})</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {agents.map(agent => {
                        const isSelected = formData.agentIds.includes(agent.id);
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => {
                              const newIds = isSelected
                                ? formData.agentIds.filter(id => id !== agent.id)
                                : [...formData.agentIds, agent.id];
                              setFormData((prev) => ({
                                ...prev,
                                agentIds: newIds,
                                coordinator_agent_id: prev.coordinator_agent_id && !newIds.includes(prev.coordinator_agent_id)
                                  ? (newIds[0] ?? null)
                                  : prev.coordinator_agent_id,
                              }));
                            }}
                            className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                              isSelected
                                ? 'bg-indigo-50 border-indigo-500 ring-4 ring-indigo-500/10'
                                : 'bg-white border-slate-100 hover:border-slate-200'
                            }`}
                          >
                            <Brain size={24} className={isSelected ? 'text-indigo-600' : 'text-slate-300'} />
                            <span className={`mt-2 text-[11px] font-bold text-center truncate w-full ${isSelected ? 'text-indigo-900' : 'text-slate-500'}`}>
                              {agent.name}
                            </span>
                            {agent.agent_role && (
                              <span className={`mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                agent.agent_role === 'supervisor'
                                  ? 'bg-violet-100 text-violet-700'
                                  : 'bg-cyan-100 text-cyan-700'
                              }`}>
                                {agent.agent_role}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {agents.length === 0 && (
                      <div className="p-6 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                        <Link to="/agents" className="text-xs font-bold text-indigo-500 hover:underline">
                          No agents found. Initialize agents first →
                        </Link>
                      </div>
                    )}
                  </div>

                  {showCrewConfig('limits') && (
                  <div className="pt-4 border-t border-slate-100">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Runtime Limit (ms)</label>
                        <input
                          type="number"
                          className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white font-bold text-slate-900"
                          value={formData.max_runtime_ms}
                          onChange={e => setFormData({ ...formData, max_runtime_ms: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Cost Cap ($ USD)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white font-bold text-slate-900"
                          value={formData.max_cost_usd}
                          onChange={e => setFormData({ ...formData, max_cost_usd: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Step Limit</label>
                        <input
                          type="number"
                          className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:bg-white font-bold text-slate-900"
                          value={formData.max_tool_calls}
                          onChange={e => setFormData({ ...formData, max_tool_calls: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <label className="mt-4 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                        checked={formData.learning_enabled}
                        onChange={e => setFormData({ ...formData, learning_enabled: e.target.checked })}
                      />
                      <span className="text-sm text-slate-700">Enable Learning From Feedback</span>
                    </label>
                    <p className="text-xs text-slate-500 mt-2">
                      When enabled, this crew uses saved run feedback to influence planning, delegation, and synthesis on future runs.
                    </p>
                  </div>
                  )}

                  {showCrewConfig('voice') && (
                  <details className="border border-emerald-100 rounded-2xl p-4 bg-emerald-50/40 space-y-3 group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-emerald-950">
                          <AudioLines size={16} className="text-emerald-600" />
                          Voice Settings
                        </label>
                        <p className="text-xs text-emerald-900/75 mt-1">
                          Save voice defaults on this crew so live voice sessions can invoke the whole crew with its own STT/TTS profile.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Link to="/voice" className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">
                          Open Voice Console
                        </Link>
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 group-open:bg-emerald-700 group-open:text-white">
                          Expand
                        </span>
                      </div>
                    </summary>
                    <div className="pt-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 items-end">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Voice Preset</label>
                          <select
                            className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-sm"
                            value={formData.voice_preset_id}
                            onChange={e => applyVoicePreset(e.target.value)}
                          >
                            <option value="">Custom runtime values</option>
                            {voiceConfigs.map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.name}</option>
                            ))}
                          </select>
                        </div>
                        <button type="button" onClick={saveCurrentVoicePreset} className="px-3 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700">
                          Save As Preset
                        </button>
                        <button type="button" onClick={updateSelectedVoicePreset} disabled={!formData.voice_preset_id} className="px-3 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 disabled:opacity-40">
                          Update Preset
                        </button>
                        <button type="button" onClick={deleteSelectedVoicePreset} disabled={!formData.voice_preset_id} className="px-3 py-3 rounded-2xl border border-red-200 bg-red-50 text-sm font-bold text-red-700 disabled:opacity-40">
                          Delete Preset
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Voice ID</label>
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_id} onChange={e => setFormData({ ...formData, voice_id: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">TTS Model</label>
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.tts_model_id} onChange={e => setFormData({ ...formData, tts_model_id: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">STT Model</label>
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.stt_model_id} onChange={e => setFormData({ ...formData, stt_model_id: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Output Format</label>
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_output_format} onChange={e => setFormData({ ...formData, voice_output_format: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Sample Rate</label>
                          <input type="number" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-bold text-slate-900" value={formData.voice_sample_rate} onChange={e => setFormData({ ...formData, voice_sample_rate: Number(e.target.value) || 16000 })} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Language</label>
                          <input className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_language_code} onChange={e => setFormData({ ...formData, voice_language_code: e.target.value })} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.voice_auto_tts} onChange={e => setFormData({ ...formData, voice_auto_tts: e.target.checked })} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                        <span className="text-sm text-slate-700">Auto-play TTS replies for this crew</span>
                      </label>
                      <div className="rounded-2xl border border-emerald-100 bg-white/80 p-4 space-y-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">Turn Detection And Disturbance Control</div>
                          <div className="text-xs text-slate-500 mt-1">These defaults are reused by crew voice sessions so short disturbances can be ignored without making real pauses feel slow.</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={formData.voice_vad_enabled} onChange={e => setFormData({ ...formData, voice_vad_enabled: e.target.checked })} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                            VAD auto-commit
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={formData.voice_browser_noise_suppression} onChange={e => setFormData({ ...formData, voice_browser_noise_suppression: e.target.checked })} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                            Browser noise suppression
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={formData.voice_browser_echo_cancellation} onChange={e => setFormData({ ...formData, voice_browser_echo_cancellation: e.target.checked })} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                            Echo cancellation
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={formData.voice_browser_auto_gain_control} onChange={e => setFormData({ ...formData, voice_browser_auto_gain_control: e.target.checked })} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500" />
                            Auto gain control
                          </label>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Silence Threshold (sec)</label>
                            <input type="number" min="0.2" max="3" step="0.1" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_vad_silence_threshold_secs} onChange={e => setFormData({ ...formData, voice_vad_silence_threshold_secs: Number(e.target.value) || DEFAULT_VAD_SILENCE_THRESHOLD_SECS })} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">VAD Threshold</label>
                            <input type="number" min="0.1" max="0.95" step="0.05" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_vad_threshold} onChange={e => setFormData({ ...formData, voice_vad_threshold: Number(e.target.value) || DEFAULT_VAD_THRESHOLD })} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Min Speech (ms)</label>
                            <input type="number" min="50" max="2000" step="10" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_min_speech_duration_ms} onChange={e => setFormData({ ...formData, voice_min_speech_duration_ms: Number(e.target.value) || DEFAULT_MIN_SPEECH_DURATION_MS })} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Min Silence (ms)</label>
                            <input type="number" min="50" max="3000" step="10" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_min_silence_duration_ms} onChange={e => setFormData({ ...formData, voice_min_silence_duration_ms: Number(e.target.value) || DEFAULT_MIN_SILENCE_DURATION_MS })} />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Recompute Window</label>
                            <input type="number" min="0" max="50" step="1" className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 font-mono text-sm" value={formData.voice_max_tokens_to_recompute} onChange={e => setFormData({ ...formData, voice_max_tokens_to_recompute: Number(e.target.value) || DEFAULT_MAX_TOKENS_TO_RECOMPUTE })} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>
                  )}

                  {showCrewConfig('exposure') && (
                  <details className="space-y-4 group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4">
                      <div className="flex items-center gap-3">
                         <Globe size={20} className="text-indigo-600" />
                         <div>
                           <p className="text-sm font-bold text-slate-900">Expose to Neural Command (MCP)</p>
                           <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider">Make this crew invokable as MCP, API, and voice runtime</p>
                         </div>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700 group-open:bg-indigo-700 group-open:text-white">
                        Expand
                      </span>
                    </summary>
                    <div className="pt-2 space-y-4">
                      <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                        <div className="text-xs text-slate-600">
                          When enabled, this crew can be served to API callers, MCP clients, and external voice consumers.
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.is_exposed}
                            onChange={e => setFormData({ ...formData, is_exposed: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-indigo-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                      {formData.is_exposed && editingCrew && (
                        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-900">
                            <Radio size={16} />
                            Voice Connection
                          </div>
                          <div className="text-xs text-cyan-900/80">Use this websocket endpoint to connect external realtime voice clients to the crew.</div>
                          <div className="rounded-xl bg-white border border-cyan-100 px-3 py-2 font-mono text-xs break-all">
                            {origin.replace(/^http/, 'ws')}/ws/voice?targetType=crew&targetId={editingCrew.id}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                  )}
                </div>

                <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
                  {saveError && (
                    <div className="mr-auto text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {saveError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-3 rounded-2xl text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-8 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    <Save size={18} />
                    {editingCrew ? 'Commit Changes' : 'Initialize Syndicate'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
