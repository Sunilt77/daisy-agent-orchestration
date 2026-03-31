import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AudioLines, ExternalLink, Mic, Radio, Search, Shield, Volume2, Waves } from 'lucide-react';

type VoiceProfile = {
  voice_id: string;
  tts_model_id: string;
  stt_model_id: string;
  output_format: string;
  sample_rate: number;
  language_code: string;
  auto_tts: boolean;
};

type VoiceAgent = {
  id: number;
  type: 'agent';
  name: string;
  subtitle?: string;
  provider?: string | null;
  model?: string | null;
  status?: string | null;
  is_exposed: boolean;
  voice_profile: VoiceProfile;
  voice_ws_url?: string;
  voice_http_hint?: string;
};

async function safeJson(res: Response) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default function VoiceAgentsPage() {
  const [voiceAgents, setVoiceAgents] = useState<VoiceAgent[]>([]);
  const [search, setSearch] = useState('');
  const [showOnlyExposed, setShowOnlyExposed] = useState(false);
  const [copied, setCopied] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      const [targetsRes, exposedRes] = await Promise.all([
        fetch('/api/voice/targets'),
        fetch('/api/voice/exposed'),
      ]);
      const targetsData = targetsRes.ok ? await safeJson(targetsRes) : null;
      const exposedData = exposedRes.ok ? await safeJson(exposedRes) : null;

      const exposedAgentMap = new Map<number, any>(
        Array.isArray(exposedData?.agents)
          ? exposedData.agents.map((agent: any) => [Number(agent.id), agent])
          : [],
      );

      const agents = Array.isArray(targetsData?.agents) ? targetsData.agents : [];
      setVoiceAgents(
        agents.map((agent: any) => ({
          id: Number(agent.id),
          type: 'agent',
          name: agent.name,
          subtitle: agent.subtitle || agent.role || 'Agent',
          provider: agent.provider || null,
          model: agent.model || null,
          status: agent.status || null,
          is_exposed: exposedAgentMap.has(Number(agent.id)),
          voice_profile: agent.voice_profile || {
            voice_id: 'JBFqnCBsd6RMkjVDRZzb',
            tts_model_id: 'eleven_multilingual_v2',
            stt_model_id: 'scribe_v2_realtime',
            output_format: 'mp3_44100_128',
            sample_rate: 16000,
            language_code: 'en',
            auto_tts: true,
          },
          voice_ws_url: exposedAgentMap.get(Number(agent.id))?.voice_ws_url,
          voice_http_hint: exposedAgentMap.get(Number(agent.id))?.voice_http_hint,
        })),
      );
    };

    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voiceAgents.filter((agent) => {
      if (showOnlyExposed && !agent.is_exposed) return false;
      if (!q) return true;
      const haystack = [
        agent.name,
        agent.subtitle || '',
        agent.provider || '',
        agent.model || '',
        agent.voice_profile.voice_id || '',
        agent.voice_profile.stt_model_id || '',
        agent.voice_profile.tts_model_id || '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [voiceAgents, search, showOnlyExposed]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {}
  };

  const exposedCount = filtered.filter((agent) => agent.is_exposed).length;

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
              <Waves size={12} />
              Voice Agents
            </div>
            <h1 className="text-3xl font-black text-white">Voice Agent Registry</h1>
            <p className="text-slate-300 mt-1">Manage multiple saved voice-capable agents, check which ones are exposed, and grab the runtime endpoints you can serve to external consumers.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/agents" className="rounded-xl bg-white text-slate-900 px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
              <AudioLines size={14} />
              Configure in Agents
            </Link>
            <Link to="/voice" className="rounded-xl border border-white/20 text-white px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
              <Mic size={14} />
              Open Voice Console
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by agent, voice id, TTS/STT model, or provider..."
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showOnlyExposed} onChange={(e) => setShowOnlyExposed(e.target.checked)} />
              Only exposed
            </label>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filtered.map((agent) => (
              <div key={agent.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{agent.name}</div>
                    <div className="text-sm text-slate-500 mt-1">
                      {agent.subtitle}
                      {agent.provider ? ` • ${agent.provider}` : ''}
                      {agent.model ? ` • ${agent.model}` : ''}
                    </div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-semibold ${agent.is_exposed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {agent.is_exposed ? 'Exposed' : 'Local Only'}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">STT</div>
                    <div className="mt-1 font-mono text-slate-900">{agent.voice_profile.stt_model_id}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">TTS</div>
                    <div className="mt-1 font-mono text-slate-900">{agent.voice_profile.tts_model_id}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Voice ID</div>
                    <div className="mt-1 font-mono text-slate-900 break-all">{agent.voice_profile.voice_id}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Output</div>
                    <div className="mt-1 font-mono text-slate-900">{agent.voice_profile.output_format}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/voice" className="rounded-xl bg-cyan-600 text-white px-3 py-2 text-sm font-semibold inline-flex items-center gap-2">
                    <Radio size={14} />
                    Test Live
                  </Link>
                  <Link to="/agents" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
                    <AudioLines size={14} />
                    Edit Voice Config
                  </Link>
                </div>

                {agent.is_exposed && agent.voice_ws_url ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      <Shield size={12} />
                      Exposed Voice Endpoint
                    </div>
                    <div className="mt-2 font-mono text-xs text-slate-800 break-all">{agent.voice_ws_url}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copy(agent.voice_ws_url || '', `ws_${agent.id}`)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700"
                      >
                        {copied === `ws_${agent.id}` ? 'Copied' : 'Copy WS URL'}
                      </button>
                      {agent.voice_http_hint ? (
                        <button
                          type="button"
                          onClick={() => void copy(agent.voice_http_hint || '', `hint_${agent.id}`)}
                          className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700"
                        >
                          {copied === `hint_${agent.id}` ? 'Copied' : 'Copy Descriptor URL'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            {!filtered.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500 xl:col-span-2">
                No voice agents match this view yet. Configure voice on an agent first, then it will show up here.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Registry Summary</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Voice Agents</div>
                <div className="mt-1 text-2xl font-black text-slate-900">{filtered.length}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-700">Exposed</div>
                <div className="mt-1 text-2xl font-black text-emerald-900">{exposedCount}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">How It Works</div>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <div className="flex gap-3">
                <Volume2 size={15} className="text-violet-600 mt-0.5 shrink-0" />
                <p>Voice config is saved on each agent profile, so you can maintain many voice-capable agents with different STT, TTS, and voice IDs.</p>
              </div>
              <div className="flex gap-3">
                <Mic size={15} className="text-cyan-600 mt-0.5 shrink-0" />
                <p>The Voice Console is for testing and live execution. This registry is for maintaining and serving voice-capable agents.</p>
              </div>
              <div className="flex gap-3">
                <ExternalLink size={15} className="text-emerald-600 mt-0.5 shrink-0" />
                <p>When an agent is exposed, the registry shows the websocket endpoint external consumers can connect to for realtime voice sessions.</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
