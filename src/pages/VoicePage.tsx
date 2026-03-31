import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Radio, Send, Volume2, Waves, Bot, Activity, Save } from 'lucide-react';

type VoiceTarget = {
  id: number;
  type: 'agent' | 'crew';
  name: string;
  subtitle?: string;
  role?: string;
  process?: string;
  provider?: string;
  model?: string;
  status?: string;
  voice_profile?: any;
};

type VoiceEvent = {
  id: string;
  type: string;
  payload: any;
  ts: string;
};

function toBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default function VoicePage() {
  const [targets, setTargets] = useState<VoiceTarget[]>([]);
  const [targetType, setTargetType] = useState<'agent' | 'crew'>('agent');
  const [targetId, setTargetId] = useState<string>('');
  const [voiceId, setVoiceId] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [ttsModelId, setTtsModelId] = useState('eleven_multilingual_v2');
  const [sttModelId, setSttModelId] = useState('scribe_v1');
  const [outputFormat, setOutputFormat] = useState('mp3_44100_128');
  const [sampleRate, setSampleRate] = useState(16000);
  const [languageCode, setLanguageCode] = useState('en');
  const [autoTts, setAutoTts] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [agentReply, setAgentReply] = useState('');
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [voiceProgress, setVoiceProgress] = useState<Array<{ id: string; text: string; ts: string }>>([]);
  const [lastAudioSrc, setLastAudioSrc] = useState('');
  const [error, setError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const loadTargets = async () => {
    try {
      const targetsRes = await fetch('/api/voice/targets');
      if (targetsRes.ok) {
        const data = await targetsRes.json().catch(() => ({}));
        const nextTargets = [
          ...(Array.isArray(data?.agents) ? data.agents : []),
          ...(Array.isArray(data?.crews) ? data.crews : []),
        ] as VoiceTarget[];
        if (nextTargets.length) {
          setTargets(nextTargets);
          const firstAgent = nextTargets.find((target) => target.type === 'agent');
          if (firstAgent) {
            setTargetType('agent');
            setTargetId(String(firstAgent.id));
          } else if (nextTargets[0]?.id) {
            setTargetType(nextTargets[0].type);
            setTargetId(String(nextTargets[0].id));
          }
          return;
        }
      }

      const [agentsRes, crewsRes] = await Promise.all([
        fetch('/api/voice/agents'),
        fetch('/api/crews'),
      ]);

      const agentsData = agentsRes.ok ? await agentsRes.json().catch(() => []) : [];
      const crewsData = crewsRes.ok ? await crewsRes.json().catch(() => []) : [];
      const fallbackTargets: VoiceTarget[] = [
        ...(Array.isArray(agentsData) ? agentsData.map((agent: any) => ({
          id: Number(agent.id),
          type: 'agent' as const,
          name: agent.name,
          subtitle: agent.role || 'Agent',
          role: agent.role || 'Agent',
          provider: agent.provider || undefined,
          model: agent.model || undefined,
          status: agent.status || undefined,
          voice_profile: agent.voice_profile,
        })) : []),
        ...(Array.isArray(crewsData) ? crewsData.map((crew: any) => ({
          id: Number(crew.id),
          type: 'crew' as const,
          name: crew.name,
          subtitle: `${crew.process || 'sequential'} crew`,
          process: crew.process || 'sequential',
          status: crew.status || undefined,
        })) : []),
      ];
      setTargets(fallbackTargets);
      const firstAgent = fallbackTargets.find((target) => target.type === 'agent');
      if (firstAgent) {
        setTargetType('agent');
        setTargetId(String(firstAgent.id));
      } else if (fallbackTargets[0]?.id) {
        setTargetType(fallbackTargets[0].type);
        setTargetId(String(fallbackTargets[0].id));
      }
      if (!fallbackTargets.length) {
        setError('Voice Console could not load agents or crews. If you recently updated the server, restart it and refresh this page.');
      }
    } catch {
      setTargets([]);
      setError('Voice Console could not load runtime targets. If the server was just updated, restart it and refresh.');
    }
  };

  useEffect(() => {
    void loadTargets();
  }, []);

  const availableTargets = useMemo(
    () => targets.filter((target) => target.type === targetType),
    [targetType, targets],
  );

  const selectedTarget = useMemo(
    () => availableTargets.find((target) => Number(target.id) === Number(targetId)) || null,
    [targetId, availableTargets],
  );

  useEffect(() => {
    if (!availableTargets.some((target) => String(target.id) === String(targetId))) {
      setTargetId(availableTargets[0]?.id ? String(availableTargets[0].id) : '');
    }
  }, [availableTargets, targetId]);

  useEffect(() => {
    if (!selectedTarget?.voice_profile) return;
    setVoiceId(String(selectedTarget.voice_profile.voice_id || 'JBFqnCBsd6RMkjVDRZzb'));
    setTtsModelId(String(selectedTarget.voice_profile.tts_model_id || 'eleven_multilingual_v2'));
    setSttModelId(String(selectedTarget.voice_profile.stt_model_id || 'scribe_v1'));
    setOutputFormat(String(selectedTarget.voice_profile.output_format || 'mp3_44100_128'));
    setSampleRate(Number(selectedTarget.voice_profile.sample_rate || 16000));
    setLanguageCode(String(selectedTarget.voice_profile.language_code || 'en'));
    setAutoTts(Boolean(selectedTarget.voice_profile.auto_tts ?? true));
  }, [selectedTarget]);

  const pushEvent = (type: string, payload: any) => {
    setEvents((prev) => [
      {
        id: `${Date.now()}_${prev.length}`,
        type,
        payload,
        ts: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 120));
  };

  const connect = () => {
    if (!targetId) return;
    setError('');
    const url = new URL(`${window.location.origin.replace(/^http/, 'ws')}/ws/voice`);
    url.searchParams.set('targetType', targetType);
    url.searchParams.set('targetId', String(targetId));
    url.searchParams.set('voiceId', voiceId);
    url.searchParams.set('ttsModelId', ttsModelId);
    url.searchParams.set('sttModelId', sttModelId);
    url.searchParams.set('outputFormat', outputFormat);
    url.searchParams.set('sampleRate', String(sampleRate));
    url.searchParams.set('languageCode', languageCode);
    url.searchParams.set('autoTts', autoTts ? 'true' : 'false');
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setIsConnected(true);
      pushEvent('socket.open', { targetType, targetId: Number(targetId) });
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data || '{}'));
        pushEvent(message.type || 'message', message);
        if (message.type === 'session.started') setSessionId(String(message.sessionId || ''));
        if (message.type === 'stt.final') setLiveTranscript(String(message.text || ''));
        if (message.type === 'agent.reply') setAgentReply(String(message.text || ''));
        if (message.type === 'voice.progress' && message.text) {
          setVoiceProgress((prev) => [
            { id: `${Date.now()}_${prev.length}`, text: String(message.text || ''), ts: new Date().toISOString() },
            ...prev,
          ].slice(0, 20));
        }
        if (message.type === 'tts.audio' && message.audio) {
          const mimeType = String(message.mimeType || 'audio/mpeg');
          setLastAudioSrc(`data:${mimeType};base64,${message.audio}`);
        }
        if (message.type === 'voice.progress.audio' && message.audio) {
          const mimeType = String(message.mimeType || 'audio/mpeg');
          setLastAudioSrc(`data:${mimeType};base64,${message.audio}`);
        }
        if (message.type === 'error') setError(String(message.message || 'Voice error'));
      } catch (e: any) {
        setError(e?.message || 'Failed to parse voice event');
      }
    };
    ws.onerror = () => setError('Voice socket error');
    ws.onclose = () => {
      setIsConnected(false);
      setIsRecording(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      pushEvent('socket.closed', {});
    };
  };

  const disconnect = () => {
    wsRef.current?.send(JSON.stringify({ type: 'session.stop' }));
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setIsRecording(false);
  };

  const sendText = () => {
    const text = textInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setLiveTranscript(text);
    wsRef.current.send(JSON.stringify({ type: 'transcript.commit', text }));
    setTextInput('');
  };

  const saveProfile = async () => {
    if (targetType !== 'agent' || !targetId) return;
    await fetch(`/api/voice/agents/${targetId}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_id: voiceId,
        tts_model_id: ttsModelId,
        stt_model_id: sttModelId,
        output_format: outputFormat,
        sample_rate: sampleRate,
        language_code: languageCode,
        auto_tts: autoTts,
      }),
    });
    pushEvent('profile.saved', { targetType, targetId: Number(targetId) });
  };

  const startRecording = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setError('');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate } });
    const audioContext = new AudioContext({ sampleRate });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    streamRef.current = stream;
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    processorRef.current = processor;

    wsRef.current.send(JSON.stringify({
      type: 'session.update',
      audioMimeType: 'audio/pcm',
      voiceId,
      ttsModelId,
      sttModelId,
      outputFormat,
      sampleRate,
      languageCode,
      autoTts,
    }));

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      const base64 = toBase64(pcm.buffer);
      wsRef.current?.send(JSON.stringify({
        type: 'audio.stream',
        chunk: base64,
      }));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    setIsRecording(true);
  };

  const stopRecording = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    wsRef.current?.send(JSON.stringify({ type: 'transcript.commit' }));
    setIsRecording(false);
  };

  useEffect(() => {
    if (!lastAudioSrc || !audioRef.current) return;
    audioRef.current.play().catch(() => undefined);
  }, [lastAudioSrc]);

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 mb-3">
              <Waves size={12} />
              Voice Runtime
            </div>
            <h1 className="text-3xl font-black text-white">Voice Console</h1>
            <p className="text-slate-300 mt-1">Test ElevenLabs-backed STT/TTS sessions against your agents over a platform WebSocket, with live runtime events and replayable session details.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={isConnected ? disconnect : connect}
              className={`rounded-xl px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 ${
                isConnected ? 'bg-red-500 text-white' : 'bg-white text-slate-900'
              }`}
            >
              {isConnected ? <PhoneOff size={14} /> : <PhoneCall size={14} />}
              {isConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6">
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-900 mb-4">Session Setup</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Runtime Type</label>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value === 'crew' ? 'crew' : 'agent')}
                >
                  <option value="agent">Agent</option>
                  <option value="crew">Crew</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">
                  {targetType === 'crew' ? 'Crew' : 'Agent'}
                </label>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  {!availableTargets.length ? (
                    <option value="">{targetType === 'crew' ? 'No crews available' : 'No agents available'}</option>
                  ) : availableTargets.map((target) => (
                    <option key={`${target.type}-${target.id}`} value={target.id}>
                      {target.name} ({target.subtitle || target.role || target.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Voice ID</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">TTS Model</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={ttsModelId} onChange={(e) => setTtsModelId(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">STT Model</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={sttModelId} onChange={(e) => setSttModelId(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Output Format</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Sample Rate</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" type="number" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value) || 16000)} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Language</label>
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={autoTts} onChange={(e) => setAutoTts(e.target.checked)} />
                Auto-play TTS reply
              </label>
              <button onClick={saveProfile} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
                <Save size={14} />
                {targetType === 'agent' ? 'Save Agent Voice Profile' : 'Crew Uses Session Voice Settings'}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">{selectedTarget?.name || `No ${targetType} selected`}</div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedTarget?.subtitle || selectedTarget?.role || 'No runtime details'}
                {selectedTarget?.provider ? ` • ${selectedTarget.provider}` : ''}
                {selectedTarget?.model ? ` • ${selectedTarget.model}` : ''}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 ${isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                  {isConnected ? 'Socket Connected' : 'Disconnected'}
                </span>
                {sessionId ? <span className="rounded-full bg-slate-200 px-2.5 py-1 font-mono text-slate-700">session {sessionId}</span> : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="text-sm font-semibold text-slate-900">Transcript Input</div>
            <textarea
              className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type a transcript manually, or record your voice below and let ElevenLabs transcribe on stop."
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={sendText}
                disabled={!isConnected || !textInput.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 inline-flex items-center gap-2"
              >
                <Send size={14} />
                Send Transcript
              </button>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isConnected}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-40 ${
                  isRecording ? 'bg-red-500' : 'bg-emerald-600'
                }`}
              >
                {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
                {isRecording ? 'Stop Recording' : 'Record Audio'}
              </button>
            </div>
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-900">
              Mic audio now streams as PCM chunks over the platform WebSocket. ElevenLabs realtime STT can emit transcript events during capture, and stopping the mic commits the utterance for the agent response.
            </div>
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
              <Radio size={16} className="text-cyan-600" />
              Live Transcript and Reply
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Voice Progress</div>
                <div className="mt-2 space-y-2">
                  {voiceProgress.length ? voiceProgress.map((item) => (
                    <div key={item.id} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-800 border border-amber-100">
                      <div>{item.text}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">{new Date(item.ts).toLocaleTimeString()}</div>
                    </div>
                  )) : (
                    <div className="text-sm text-slate-500">Short spoken progress updates will appear here during long runs.</div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Transcript</div>
                <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap min-h-[64px]">{liveTranscript || 'Waiting for transcript...'}</div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  <Bot size={12} />
                  Agent Reply
                </div>
                <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap min-h-[100px]">{agentReply || 'Waiting for agent response...'}</div>
              </div>
              {lastAudioSrc ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                    <Volume2 size={12} />
                    Synthesized Audio
                  </div>
                  <audio ref={audioRef} className="mt-3 w-full" controls src={lastAudioSrc} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-950 text-slate-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold mb-3">
              <Activity size={16} className="text-emerald-400" />
              Runtime Events
            </div>
            <div className="max-h-[520px] overflow-auto space-y-2 font-mono text-xs">
              {events.length ? events.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    <span>{event.type}</span>
                    <span>{new Date(event.ts).toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap text-slate-200">{JSON.stringify(event.payload, null, 2)}</pre>
                </div>
              )) : (
                <div className="text-slate-500">Connect a voice session to watch runtime events, transcripts, and TTS output.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
