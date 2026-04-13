import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Radio, Send, Volume2, Waves, Bot, Activity, Save, Paperclip, Search, RotateCcw } from 'lucide-react';

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

type SessionAttachment = {
  id: string;
  kind: 'image' | 'audio' | 'pdf' | 'file';
  name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  url: string;
};

type VoiceConfigPreset = {
  id: number;
  name: string;
  voice_provider?: string;
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
    push_to_talk?: boolean;
  };
};

type ResourceAccessPayload = {
  owner?: {
    owner_user_id?: string;
    owner_org_id?: string | null;
    visibility?: 'private' | 'org';
  } | null;
  shares?: Array<{
    id: number;
    shared_with_user_id?: string | null;
    shared_with_org_id?: string | null;
    created_at?: string;
  }>;
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

const DEFAULT_VAD_SILENCE_THRESHOLD_SECS = 0.8;
const DEFAULT_VAD_THRESHOLD = 0.6;
const DEFAULT_MIN_SPEECH_DURATION_MS = 220;
const DEFAULT_MIN_SILENCE_DURATION_MS = 420;
const DEFAULT_MAX_TOKENS_TO_RECOMPUTE = 5;

const ENVIRONMENT_PRESETS = [
  {
    id: 'quiet-room',
    label: 'Quiet Room',
    description: 'Fastest response for calm spaces.',
    values: {
      vadEnabled: true,
      vadSilenceThresholdSecs: 0.6,
      vadThreshold: 0.5,
      minSpeechDurationMs: 180,
      minSilenceDurationMs: 280,
      maxTokensToRecompute: 4,
      browserNoiseSuppression: true,
      browserEchoCancellation: true,
      browserAutoGainControl: false,
    },
  },
  {
    id: 'office',
    label: 'Office',
    description: 'Balanced for keyboard noise and nearby voices.',
    values: {
      vadEnabled: true,
      vadSilenceThresholdSecs: 0.8,
      vadThreshold: 0.65,
      minSpeechDurationMs: 240,
      minSilenceDurationMs: 420,
      maxTokensToRecompute: 5,
      browserNoiseSuppression: true,
      browserEchoCancellation: true,
      browserAutoGainControl: false,
    },
  },
  {
    id: 'street',
    label: 'Street',
    description: 'More defensive against disturbances and traffic.',
    values: {
      vadEnabled: true,
      vadSilenceThresholdSecs: 1,
      vadThreshold: 0.78,
      minSpeechDurationMs: 320,
      minSilenceDurationMs: 620,
      maxTokensToRecompute: 6,
      browserNoiseSuppression: true,
      browserEchoCancellation: true,
      browserAutoGainControl: false,
    },
  },
];

export default function VoicePage() {
  const [targets, setTargets] = useState<VoiceTarget[]>([]);
  const [voiceConfigs, setVoiceConfigs] = useState<VoiceConfigPreset[]>([]);
  const [selectedVoiceConfigId, setSelectedVoiceConfigId] = useState<string>('');
  const [targetType, setTargetType] = useState<'agent' | 'crew'>('agent');
  const [targetId, setTargetId] = useState<string>('');
  const [voiceId, setVoiceId] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [ttsModelId, setTtsModelId] = useState('eleven_multilingual_v2');
  const [sttModelId, setSttModelId] = useState('scribe_v2_realtime');
  const [outputFormat, setOutputFormat] = useState('mp3_44100_128');
  const [sampleRate, setSampleRate] = useState(16000);
  const [languageCode, setLanguageCode] = useState('en');
  const [autoTts, setAutoTts] = useState(true);
  const [vadEnabled, setVadEnabled] = useState(true);
  const [vadSilenceThresholdSecs, setVadSilenceThresholdSecs] = useState(DEFAULT_VAD_SILENCE_THRESHOLD_SECS);
  const [vadThreshold, setVadThreshold] = useState(DEFAULT_VAD_THRESHOLD);
  const [minSpeechDurationMs, setMinSpeechDurationMs] = useState(DEFAULT_MIN_SPEECH_DURATION_MS);
  const [minSilenceDurationMs, setMinSilenceDurationMs] = useState(DEFAULT_MIN_SILENCE_DURATION_MS);
  const [maxTokensToRecompute, setMaxTokensToRecompute] = useState(DEFAULT_MAX_TOKENS_TO_RECOMPUTE);
  const [browserNoiseSuppression, setBrowserNoiseSuppression] = useState(true);
  const [browserEchoCancellation, setBrowserEchoCancellation] = useState(true);
  const [browserAutoGainControl, setBrowserAutoGainControl] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [isPushToTalkPressed, setIsPushToTalkPressed] = useState(false);
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
  const [statusNote, setStatusNote] = useState('');
  const [turnState, setTurnState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const [speechLikelihood, setSpeechLikelihood] = useState<'idle' | 'background' | 'speech'>('idle');
  const [presetAccess, setPresetAccess] = useState<ResourceAccessPayload | null>(null);
  const [presetAccessLoading, setPresetAccessLoading] = useState(false);
  const [presetAccessSaving, setPresetAccessSaving] = useState(false);
  const [presetAccessError, setPresetAccessError] = useState('');
  const [presetVisibility, setPresetVisibility] = useState<'private' | 'org'>('private');
  const [presetSharedUserIdsText, setPresetSharedUserIdsText] = useState('');
  const [presetSharedOrgIdsText, setPresetSharedOrgIdsText] = useState('');
  const [sessionAttachments, setSessionAttachments] = useState<SessionAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [monitorTab, setMonitorTab] = useState<'conversation' | 'events'>('conversation');
  const [targetSearch, setTargetSearch] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | string>('all');
  const [directElevenLabsMedia, setDirectElevenLabsMedia] = useState(true);
  const [latencyMetrics, setLatencyMetrics] = useState<{
    sttToReplyMs: number | null;
    replyToTtsMs: number | null;
    turnTotalMs: number | null;
  }>({
    sttToReplyMs: null,
    replyToTtsMs: null,
    turnTotalMs: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const audioObjectUrlRef = useRef<string>('');
  const fallbackAudioChunksRef = useRef<string[]>([]);
  const fallbackMimeTypeRef = useRef<string>('audio/mpeg');
  const pendingAudioEndRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pushToTalkPressedRef = useRef(false);
  const turnCommittedAtRef = useRef<number | null>(null);
  const replyStartedAtRef = useRef<number | null>(null);
  const directSttSocketRef = useRef<WebSocket | null>(null);
  const directSttActiveRef = useRef(false);
  const lastDirectCommittedTranscriptRef = useRef('');
  const directTtsSocketRef = useRef<WebSocket | null>(null);
  const directTtsActiveRef = useRef(false);
  const directTtsPlayingRef = useRef(false);
  const lastDirectTtsTextRef = useRef('');

  const stopMicVisualization = () => {
    if (animationFrameRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    analyserRef.current = null;
    setMicLevel(0);
    setSpeechLikelihood('idle');
  };

  const resetAudioStream = () => {
    audioQueueRef.current = [];
    fallbackAudioChunksRef.current = [];
    pendingAudioEndRef.current = false;
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = '';
    }
  };

  const flushAudioQueue = () => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating || !audioQueueRef.current.length) return;
    const chunk = audioQueueRef.current.shift();
    if (!chunk) return;
    sourceBuffer.appendBuffer(chunk);
  };

  const maybeEndAudioStream = () => {
    const mediaSource = mediaSourceRef.current;
    const sourceBuffer = sourceBufferRef.current;
    if (!pendingAudioEndRef.current || !mediaSource || !sourceBuffer) return;
    if (sourceBuffer.updating || audioQueueRef.current.length) return;
    if (mediaSource.readyState === 'open') {
      try {
        mediaSource.endOfStream();
      } catch {}
    }
    pendingAudioEndRef.current = false;
  };

  const startIncomingAudioStream = (mimeType: string) => {
    resetAudioStream();
    fallbackMimeTypeRef.current = mimeType || 'audio/mpeg';
    if (typeof window === 'undefined' || typeof MediaSource === 'undefined' || !audioRef.current) {
      return;
    }
    if (!MediaSource.isTypeSupported(fallbackMimeTypeRef.current)) {
      return;
    }
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    audioObjectUrlRef.current = URL.createObjectURL(mediaSource);
    audioRef.current.src = audioObjectUrlRef.current;
    mediaSource.addEventListener('sourceopen', () => {
      try {
        if (!mediaSourceRef.current) return;
        const sourceBuffer = mediaSource.addSourceBuffer(fallbackMimeTypeRef.current);
        sourceBuffer.mode = 'sequence';
        sourceBufferRef.current = sourceBuffer;
        sourceBuffer.addEventListener('updateend', () => {
          flushAudioQueue();
          maybeEndAudioStream();
        });
        flushAudioQueue();
        audioRef.current?.play().catch(() => undefined);
      } catch {
        sourceBufferRef.current = null;
      }
    }, { once: true });
  };

  const appendIncomingAudioChunk = (base64: string) => {
    if (!base64) return;
    if (sourceBufferRef.current && typeof window !== 'undefined') {
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      audioQueueRef.current.push(bytes);
      flushAudioQueue();
      return;
    }
    fallbackAudioChunksRef.current.push(base64);
  };

  const finishIncomingAudioStream = () => {
    if (!sourceBufferRef.current && fallbackAudioChunksRef.current.length) {
      setLastAudioSrc(`data:${fallbackMimeTypeRef.current};base64,${fallbackAudioChunksRef.current.join('')}`);
      return;
    }
    pendingAudioEndRef.current = true;
    maybeEndAudioStream();
  };

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
          voice_profile: crew.voice_profile,
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

  const loadVoiceConfigs = async () => {
    try {
      const res = await fetch('/api/voice/configs');
      const data = res.ok ? await res.json().catch(() => []) : [];
      setVoiceConfigs(Array.isArray(data) ? data : []);
    } catch {
      setVoiceConfigs([]);
    }
  };

  const startTurnTiming = () => {
    const now = Date.now();
    turnCommittedAtRef.current = now;
    replyStartedAtRef.current = null;
    setLatencyMetrics({
      sttToReplyMs: null,
      replyToTtsMs: null,
      turnTotalMs: null,
    });
  };

  const closeDirectSttSocket = () => {
    directSttActiveRef.current = false;
    lastDirectCommittedTranscriptRef.current = '';
    try {
      directSttSocketRef.current?.close();
    } catch {}
    directSttSocketRef.current = null;
  };

  const closeDirectTtsSocket = () => {
    directTtsActiveRef.current = false;
    directTtsPlayingRef.current = false;
    try {
      directTtsSocketRef.current?.close();
    } catch {}
    directTtsSocketRef.current = null;
  };

  const requestSingleUseToken = async (tokenType: 'realtime_scribe' | 'tts_websocket') => {
    const res = await fetch('/api/voice/elevenlabs/single-use-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType,
        targetId: Number(targetId || 0),
        tokenType,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || `Failed to create ${tokenType} token`));
    const token = String(data?.token || '').trim();
    if (!token) throw new Error(`${tokenType} token missing in response`);
    return token;
  };

  const requestDirectSttToken = async () => {
    return await requestSingleUseToken('realtime_scribe');
  };

  const connectDirectSttSocket = async () => {
    if (!directElevenLabsMedia) return false;
    if (!targetId) return false;
    if (directSttSocketRef.current && (
      directSttSocketRef.current.readyState === WebSocket.OPEN ||
      directSttSocketRef.current.readyState === WebSocket.CONNECTING
    )) {
      return directSttSocketRef.current.readyState === WebSocket.OPEN;
    }

    const token = await requestDirectSttToken();
    const params = new URLSearchParams({
      model_id: sttModelId || 'scribe_v2_realtime',
      sample_rate: String(sampleRate || 16000),
      audio_format: `pcm_${sampleRate || 16000}`,
      token,
    });
    if (vadEnabled === false) {
      params.set('commit_strategy', 'manual');
    } else {
      params.set('commit_strategy', 'vad');
      params.set('vad_silence_threshold_secs', String(vadSilenceThresholdSecs));
      params.set('vad_threshold', String(vadThreshold));
      params.set('min_speech_duration_ms', String(minSpeechDurationMs));
      params.set('min_silence_duration_ms', String(minSilenceDurationMs));
      params.set('max_tokens_to_recompute', String(maxTokensToRecompute));
    }
    if (languageCode) params.set('language_code', languageCode);

    const sttSocket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`);
    directSttSocketRef.current = sttSocket;

    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settle = (ok: boolean, err?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        if (ok) resolve(true);
        else reject(err || new Error('Direct STT connection failed'));
      };
      const timeoutId = window.setTimeout(() => {
        settle(false, new Error('Timed out connecting to ElevenLabs realtime STT'));
      }, 10000);
      sttSocket.onopen = () => {
        pushEvent('stt.socket.open.direct', { provider: 'elevenlabs' });
        setTurnState('listening');
        settle(true);
      };
      sttSocket.onerror = () => {
        if (directSttSocketRef.current === sttSocket) directSttSocketRef.current = null;
        settle(false, new Error('Direct ElevenLabs STT socket error'));
      };
      sttSocket.onclose = () => {
        if (directSttSocketRef.current === sttSocket) directSttSocketRef.current = null;
        pushEvent('stt.socket.closed.direct', {});
        settle(false, new Error('Direct STT socket closed before becoming ready'));
      };
      sttSocket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}'));
          const partial = String(payload?.text || payload?.transcript || '').trim();
          const messageType = String(payload?.message_type || '');
          const speechStarted = messageType === 'speech_started' || messageType === 'speech_start';
          const speechStopped = messageType === 'speech_stopped' || messageType === 'speech_end';
          if (speechStarted || (partial && turnState !== 'speaking')) {
            setStatusNote('Listening…');
            setTurnState('listening');
          }
          if (speechStopped) {
            setStatusNote('Speech committed. Sending to the runtime…');
          }
          const normalizedType =
            messageType === 'committed_transcript' || messageType === 'committed_transcript_with_timestamps' || payload?.is_final || payload?.final
              ? 'stt.final'
              : messageType === 'partial_transcript'
                ? 'stt.partial'
                : 'stt.event';
          if (!partial) return;
          if (normalizedType === 'stt.final') {
            if (lastDirectCommittedTranscriptRef.current === partial) return;
            lastDirectCommittedTranscriptRef.current = partial;
            setLiveTranscript(partial);
            startTurnTiming();
            wsRef.current?.send(JSON.stringify({ type: 'transcript.commit', text: partial }));
            pushEvent('stt.final.direct', { text: partial });
          } else if (normalizedType === 'stt.partial') {
            setLiveTranscript(partial);
          }
        } catch {}
      };
    });
  };

  const connectDirectTtsSocket = async () => {
    if (!directElevenLabsMedia || !autoTts) return false;
    if (!targetId) return false;
    if (directTtsSocketRef.current && (
      directTtsSocketRef.current.readyState === WebSocket.OPEN ||
      directTtsSocketRef.current.readyState === WebSocket.CONNECTING
    )) {
      return directTtsSocketRef.current.readyState === WebSocket.OPEN;
    }

    const token = await requestSingleUseToken('tts_websocket');
    const params = new URLSearchParams({
      single_use_token: token,
      model_id: ttsModelId || 'eleven_multilingual_v2',
      output_format: outputFormat || 'mp3_44100_128',
    });
    if (languageCode) params.set('language_code', languageCode);
    params.set('auto_mode', 'true');
    const socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?${params.toString()}`);
    directTtsSocketRef.current = socket;

    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settle = (ok: boolean, err?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        if (ok) resolve(true);
        else reject(err || new Error('Direct TTS connection failed'));
      };
      const timeoutId = window.setTimeout(() => {
        settle(false, new Error('Timed out connecting to ElevenLabs realtime TTS'));
      }, 10000);
      socket.onopen = () => {
        socket.send(JSON.stringify({
          text: ' ',
          voice_settings: {
            speed: 1,
            stability: 0.5,
            similarity_boost: 0.8,
          },
        }));
        directTtsActiveRef.current = true;
        pushEvent('tts.socket.open.direct', { provider: 'elevenlabs' });
        settle(true);
      };
      socket.onerror = () => {
        if (directTtsSocketRef.current === socket) directTtsSocketRef.current = null;
        directTtsActiveRef.current = false;
        settle(false, new Error('Direct ElevenLabs TTS socket error'));
      };
      socket.onclose = () => {
        if (directTtsSocketRef.current === socket) directTtsSocketRef.current = null;
        directTtsActiveRef.current = false;
        pushEvent('tts.socket.closed.direct', {});
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}'));
          const audio = String(payload?.audio || '');
          if (audio) {
            appendIncomingAudioChunk(audio);
          }
          if (payload?.isFinal === true) {
            finishIncomingAudioStream();
            directTtsPlayingRef.current = false;
            setTurnState('idle');
          }
        } catch {}
      };
    });
  };

  const synthesizeDirectTts = async (text: string) => {
    const content = String(text || '').trim();
    if (!content || !directElevenLabsMedia || !autoTts) return;
    if (lastDirectTtsTextRef.current === content) return;
    if (directTtsPlayingRef.current) return;

    try {
      if (!directTtsActiveRef.current || !directTtsSocketRef.current || directTtsSocketRef.current.readyState !== WebSocket.OPEN) {
        await connectDirectTtsSocket();
      }
      if (!directTtsSocketRef.current || directTtsSocketRef.current.readyState !== WebSocket.OPEN) return;
      lastDirectTtsTextRef.current = content;
      directTtsPlayingRef.current = true;
      setTurnState('speaking');
      startIncomingAudioStream(outputFormat.startsWith('mp3') ? 'audio/mpeg' : 'audio/mpeg');
      directTtsSocketRef.current.send(JSON.stringify({ text: `${content} `, try_trigger_generation: true }));
      directTtsSocketRef.current.send(JSON.stringify({ text: '' }));
    } catch (e: any) {
      directTtsPlayingRef.current = false;
      setStatusNote('Direct ElevenLabs TTS is unavailable. Reply text remains available.');
      pushEvent('tts.socket.error.direct', { message: e?.message || 'Failed to synthesize direct TTS' });
    }
  };

  useEffect(() => {
    void loadTargets();
    void loadVoiceConfigs();
  }, []);

  const uploadSessionAttachments = async (files: FileList | null) => {
    if (!sessionId || !files?.length) return;
    setUploadingAttachment(true);
    setError('');
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      const res = await fetch(`/api/voice/sessions/${sessionId}/attachments`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Failed to upload attachments'));
      const uploaded = Array.isArray(data?.attachments) ? data.attachments : [];
      setSessionAttachments((prev) => [...prev, ...uploaded]);
      setStatusNote(`Attached ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} to this voice session.`);
    } catch (e: any) {
      setError(e?.message || 'Failed to upload attachments');
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const availableTargets = useMemo(
    () => {
      const query = targetSearch.trim().toLowerCase();
      return targets.filter((target) => {
        if (target.type !== targetType) return false;
        if (!query) return true;
        return `${target.name} ${target.subtitle || ''} ${target.role || ''} ${target.process || ''}`.toLowerCase().includes(query);
      });
    },
    [targetSearch, targetType, targets],
  );

  const selectedTarget = useMemo(
    () => availableTargets.find((target) => Number(target.id) === Number(targetId)) || null,
    [targetId, availableTargets],
  );
  const currentPreset = useMemo(
    () => voiceConfigs.find((item) => String(item.id) === String(selectedVoiceConfigId)) || null,
    [selectedVoiceConfigId, voiceConfigs],
  );

  const sensitivityGuide = useMemo(() => {
    if (!vadEnabled) {
      return {
        title: 'Manual Commit Style',
        text: 'Automatic turn commit is disabled, so speech will wait for explicit commit behavior rather than VAD timing.',
        tone: 'bg-amber-50 border-amber-200 text-amber-900',
      };
    }
    if (vadThreshold >= 0.75 || minSpeechDurationMs >= 300 || minSilenceDurationMs >= 600) {
      return {
        title: 'Noise Resistant',
        text: 'Good for busy environments. It will ignore more disturbances, but the agent may wait a bit longer before responding.',
        tone: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      };
    }
    if (vadThreshold <= 0.52 && minSilenceDurationMs <= 300 && vadSilenceThresholdSecs <= 0.65) {
      return {
        title: 'Ultra Responsive',
        text: 'Great for quiet rooms and fast turn-taking. It may accidentally react to brief disturbances or clipped pauses.',
        tone: 'bg-cyan-50 border-cyan-200 text-cyan-900',
      };
    }
    return {
      title: 'Balanced',
      text: 'A good middle ground for home and office use, with moderate disturbance resistance and solid response speed.',
      tone: 'bg-slate-50 border-slate-200 text-slate-900',
    };
  }, [vadEnabled, vadThreshold, minSpeechDurationMs, minSilenceDurationMs, vadSilenceThresholdSecs]);

  const latencyTone = useMemo(() => {
    const total = latencyMetrics.turnTotalMs;
    if (total == null) return 'text-slate-300';
    if (total <= 1800) return 'text-emerald-300';
    if (total <= 3500) return 'text-amber-300';
    return 'text-rose-300';
  }, [latencyMetrics.turnTotalMs]);
  const eventTypes = useMemo(() => {
    return Array.from(new Set(events.map((event) => String(event.type || '').trim()).filter(Boolean))).sort();
  }, [events]);
  const filteredEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    return events.filter((event) => {
      const matchesType = eventTypeFilter === 'all' || event.type === eventTypeFilter;
      if (!matchesType) return false;
      if (!query) return true;
      return `${event.type || ''} ${JSON.stringify(event.payload || {})}`.toLowerCase().includes(query);
    });
  }, [eventSearch, eventTypeFilter, events]);
  const hasVoiceFilters = targetSearch.trim().length > 0 || eventSearch.trim().length > 0 || eventTypeFilter !== 'all';

  useEffect(() => {
    if (!availableTargets.some((target) => String(target.id) === String(targetId))) {
      setTargetId(availableTargets[0]?.id ? String(availableTargets[0].id) : '');
    }
  }, [availableTargets, targetId]);

  useEffect(() => {
    if (!selectedTarget?.voice_profile) return;
    setVoiceId(String(selectedTarget.voice_profile.voice_id || 'JBFqnCBsd6RMkjVDRZzb'));
    setTtsModelId(String(selectedTarget.voice_profile.tts_model_id || 'eleven_multilingual_v2'));
    setSttModelId(String(selectedTarget.voice_profile.stt_model_id || 'scribe_v2_realtime'));
    setOutputFormat(String(selectedTarget.voice_profile.output_format || 'mp3_44100_128'));
    setSampleRate(Number(selectedTarget.voice_profile.sample_rate || 16000));
    setLanguageCode(String(selectedTarget.voice_profile.language_code || 'en'));
    setAutoTts(Boolean(selectedTarget.voice_profile.auto_tts ?? true));
    setSelectedVoiceConfigId(String(selectedTarget.voice_profile.meta?.preset_id || ''));
    setVadEnabled(Boolean(selectedTarget.voice_profile.meta?.vad_enabled ?? true));
    setVadSilenceThresholdSecs(Number(selectedTarget.voice_profile.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS));
    setVadThreshold(Number(selectedTarget.voice_profile.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD));
    setMinSpeechDurationMs(Number(selectedTarget.voice_profile.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS));
    setMinSilenceDurationMs(Number(selectedTarget.voice_profile.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS));
    setMaxTokensToRecompute(Number(selectedTarget.voice_profile.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE));
    setBrowserNoiseSuppression(Boolean(selectedTarget.voice_profile.meta?.browser_noise_suppression ?? true));
    setBrowserEchoCancellation(Boolean(selectedTarget.voice_profile.meta?.browser_echo_cancellation ?? true));
    setBrowserAutoGainControl(Boolean(selectedTarget.voice_profile.meta?.browser_auto_gain_control ?? false));
    setPushToTalk(Boolean(selectedTarget.voice_profile.meta?.push_to_talk ?? false));
  }, [selectedTarget]);

  const applyVoiceConfig = (presetId: string) => {
    setSelectedVoiceConfigId(presetId);
    const preset = voiceConfigs.find((item) => String(item.id) === String(presetId));
    if (!preset) return;
    setVoiceId(String(preset.voice_id || 'JBFqnCBsd6RMkjVDRZzb'));
    setTtsModelId(String(preset.tts_model_id || 'eleven_multilingual_v2'));
    setSttModelId(String(preset.stt_model_id || 'scribe_v2_realtime'));
    setOutputFormat(String(preset.output_format || 'mp3_44100_128'));
    setSampleRate(Number(preset.sample_rate || 16000));
    setLanguageCode(String(preset.language_code || 'en'));
    setAutoTts(Boolean(preset.auto_tts ?? true));
    setVadEnabled(Boolean(preset.meta?.vad_enabled ?? true));
    setVadSilenceThresholdSecs(Number(preset.meta?.vad_silence_threshold_secs ?? DEFAULT_VAD_SILENCE_THRESHOLD_SECS));
    setVadThreshold(Number(preset.meta?.vad_threshold ?? DEFAULT_VAD_THRESHOLD));
    setMinSpeechDurationMs(Number(preset.meta?.min_speech_duration_ms ?? DEFAULT_MIN_SPEECH_DURATION_MS));
    setMinSilenceDurationMs(Number(preset.meta?.min_silence_duration_ms ?? DEFAULT_MIN_SILENCE_DURATION_MS));
    setMaxTokensToRecompute(Number(preset.meta?.max_tokens_to_recompute ?? DEFAULT_MAX_TOKENS_TO_RECOMPUTE));
    setBrowserNoiseSuppression(Boolean(preset.meta?.browser_noise_suppression ?? true));
    setBrowserEchoCancellation(Boolean(preset.meta?.browser_echo_cancellation ?? true));
    setBrowserAutoGainControl(Boolean(preset.meta?.browser_auto_gain_control ?? false));
    setPushToTalk(Boolean(preset.meta?.push_to_talk ?? false));
  };

  const applyEnvironmentPreset = (presetId: string) => {
    const preset = ENVIRONMENT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setVadEnabled(preset.values.vadEnabled);
    setVadSilenceThresholdSecs(preset.values.vadSilenceThresholdSecs);
    setVadThreshold(preset.values.vadThreshold);
    setMinSpeechDurationMs(preset.values.minSpeechDurationMs);
    setMinSilenceDurationMs(preset.values.minSilenceDurationMs);
    setMaxTokensToRecompute(preset.values.maxTokensToRecompute);
    setBrowserNoiseSuppression(preset.values.browserNoiseSuppression);
    setBrowserEchoCancellation(preset.values.browserEchoCancellation);
    setBrowserAutoGainControl(preset.values.browserAutoGainControl);
    setStatusNote(`Applied ${preset.label} voice tuning.`);
  };

  useEffect(() => {
    if (!selectedVoiceConfigId) {
      setPresetAccess(null);
      setPresetAccessError('');
      setPresetVisibility('private');
      setPresetSharedUserIdsText('');
      setPresetSharedOrgIdsText('');
      return;
    }
    let canceled = false;
    const loadPresetAccess = async () => {
      setPresetAccessLoading(true);
      setPresetAccessError('');
      try {
        const res = await fetch(`/api/resource-access/voice_config/${selectedVoiceConfigId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || 'Failed to load preset access'));
        if (canceled) return;
        const payload = data as ResourceAccessPayload;
        setPresetAccess(payload);
        setPresetVisibility(payload.owner?.visibility === 'org' ? 'org' : 'private');
        setPresetSharedUserIdsText((payload.shares || []).map((row) => String(row.shared_with_user_id || '').trim()).filter(Boolean).join(', '));
        setPresetSharedOrgIdsText((payload.shares || []).map((row) => String(row.shared_with_org_id || '').trim()).filter(Boolean).join(', '));
      } catch (e: any) {
        if (!canceled) {
          setPresetAccess(null);
          setPresetAccessError(e.message || 'Failed to load preset access');
        }
      } finally {
        if (!canceled) setPresetAccessLoading(false);
      }
    };
    void loadPresetAccess();
    return () => { canceled = true; };
  }, [selectedVoiceConfigId]);

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
    closeDirectSttSocket();
    closeDirectTtsSocket();
    setError('');
    setStatusNote('');
    const runtimeAutoTts = autoTts && !directElevenLabsMedia;
    const url = new URL(`${window.location.origin.replace(/^http/, 'ws')}/ws/voice`);
    url.searchParams.set('targetType', targetType);
    url.searchParams.set('targetId', String(targetId));
    url.searchParams.set('voiceId', voiceId);
    url.searchParams.set('ttsModelId', ttsModelId);
    url.searchParams.set('sttModelId', sttModelId);
    url.searchParams.set('outputFormat', outputFormat);
    url.searchParams.set('sampleRate', String(sampleRate));
    url.searchParams.set('languageCode', languageCode);
    url.searchParams.set('autoTts', runtimeAutoTts ? 'true' : 'false');
    url.searchParams.set('vadEnabled', vadEnabled ? 'true' : 'false');
    url.searchParams.set('vadSilenceThresholdSecs', String(vadSilenceThresholdSecs));
    url.searchParams.set('vadThreshold', String(vadThreshold));
    url.searchParams.set('minSpeechDurationMs', String(minSpeechDurationMs));
    url.searchParams.set('minSilenceDurationMs', String(minSilenceDurationMs));
    url.searchParams.set('maxTokensToRecompute', String(maxTokensToRecompute));
    url.searchParams.set('browserNoiseSuppression', browserNoiseSuppression ? 'true' : 'false');
    url.searchParams.set('browserEchoCancellation', browserEchoCancellation ? 'true' : 'false');
    url.searchParams.set('browserAutoGainControl', browserAutoGainControl ? 'true' : 'false');
    url.searchParams.set('pushToTalk', pushToTalk ? 'true' : 'false');
    const ws = new WebSocket(url);
    wsRef.current = ws;
    void saveProfile();
    ws.onopen = () => {
      setIsConnected(true);
      pushEvent('socket.open', { targetType, targetId: Number(targetId) });
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data || '{}'));
        pushEvent(message.type || 'message', message);
        if (message.type === 'session.started') setSessionId(String(message.sessionId || ''));
        if (message.type === 'session.started') setSessionAttachments(Array.isArray(message.attachments) ? message.attachments : []);
        if (message.type === 'attachments.updated') {
          const updated = Array.isArray(message.attachments) ? message.attachments : [];
          if (updated.length) {
            setSessionAttachments((prev) => {
              const seen = new Set(prev.map((item) => String(item.id || '')));
              const merged = [...prev];
              for (const item of updated) {
                const id = String(item?.id || '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                merged.push(item);
              }
              return merged;
            });
          }
        }
        if (message.type === 'session.started') setStatusNote('Connected. Start speaking and committed speech will invoke the selected runtime automatically.');
        if (message.type === 'turn.state') {
          const next = String(message.state || 'idle');
          if (next === 'listening' || next === 'thinking' || next === 'speaking' || next === 'idle') {
            setTurnState(next);
          }
        }
        if (message.type === 'speech.started') {
          setStatusNote('Listening…');
        }
        if (message.type === 'speech.stopped') {
          startTurnTiming();
          setStatusNote('Speech committed. Sending to the runtime…');
        }
        if (message.type === 'stt.partial') setLiveTranscript(String(message.text || ''));
        if (message.type === 'stt.final') setLiveTranscript(String(message.text || ''));
        if (message.type === 'agent.reply.start') {
          setAgentReply('');
          const now = Date.now();
          replyStartedAtRef.current = now;
          if (turnCommittedAtRef.current) {
            setLatencyMetrics((prev) => ({
              ...prev,
              sttToReplyMs: Math.max(0, now - turnCommittedAtRef.current!),
            }));
          }
        }
        if (message.type === 'agent.reply.delta') {
          if (message.fullText) setAgentReply(String(message.fullText || ''));
          else if (message.text) setAgentReply((prev) => `${prev}${prev ? ' ' : ''}${String(message.text || '')}`);
        }
        if (message.type === 'agent.reply.complete') setAgentReply(String(message.text || ''));
        if (message.type === 'agent.reply.complete' && directElevenLabsMedia && autoTts) {
          void synthesizeDirectTts(String(message.text || ''));
        }
        if (message.type === 'agent.reply') setAgentReply(String(message.text || ''));
        if (message.type === 'agent.reply' && directElevenLabsMedia && autoTts) {
          void synthesizeDirectTts(String(message.text || ''));
        }
        if (message.type === 'voice.busy') setStatusNote(String(message.message || 'The runtime is still processing the previous utterance.'));
        if (message.type === 'voice.progress' && message.text) {
          setVoiceProgress((prev) => [
            { id: `${Date.now()}_${prev.length}`, text: String(message.text || ''), ts: new Date().toISOString() },
            ...prev,
          ].slice(0, 20));
        }
        if (message.type === 'tts.start') {
          if (directElevenLabsMedia) return;
          const now = Date.now();
          if (replyStartedAtRef.current) {
            setLatencyMetrics((prev) => ({
              ...prev,
              replyToTtsMs: Math.max(0, now - replyStartedAtRef.current!),
            }));
          }
          startIncomingAudioStream(String(message.mimeType || 'audio/mpeg'));
        }
        if (message.type === 'tts.chunk' && message.audio) {
          if (directElevenLabsMedia) return;
          appendIncomingAudioChunk(String(message.audio || ''));
        }
        if (message.type === 'tts.complete') {
          if (directElevenLabsMedia) return;
          finishIncomingAudioStream();
        }
        if (message.type === 'voice.progress.audio.start') {
          if (directElevenLabsMedia) return;
          startIncomingAudioStream(String(message.mimeType || 'audio/mpeg'));
        }
        if (message.type === 'voice.progress.audio.chunk' && message.audio) {
          if (directElevenLabsMedia) return;
          appendIncomingAudioChunk(String(message.audio || ''));
        }
        if (message.type === 'voice.progress.audio.complete') {
          if (directElevenLabsMedia) return;
          finishIncomingAudioStream();
        }
        if (message.type === 'tts.interrupted') {
          resetAudioStream();
          setStatusNote('Interrupted current playback because new speech started.');
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
        if (message.type === 'session.completed' && turnCommittedAtRef.current) {
          const now = Date.now();
          setLatencyMetrics((prev) => ({
            ...prev,
            turnTotalMs: Math.max(0, now - turnCommittedAtRef.current!),
          }));
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to parse voice event');
      }
    };
    ws.onerror = () => setError('Voice socket error');
    ws.onclose = () => {
      closeDirectSttSocket();
      closeDirectTtsSocket();
      wsRef.current = null;
      setIsConnected(false);
      setIsRecording(false);
      setIsPushToTalkPressed(false);
      stopMicVisualization();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      resetAudioStream();
      setStatusNote('');
      setSessionAttachments([]);
      pushEvent('socket.closed', {});
    };
  };

  const disconnect = () => {
    closeDirectSttSocket();
    closeDirectTtsSocket();
    wsRef.current?.send(JSON.stringify({ type: 'session.stop' }));
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setIsRecording(false);
    setIsPushToTalkPressed(false);
    stopMicVisualization();
    resetAudioStream();
  };

  const sendText = () => {
    const text = textInput.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setLiveTranscript(text);
    startTurnTiming();
    wsRef.current.send(JSON.stringify({ type: 'transcript.commit', text }));
    setStatusNote('Manual text submitted to the selected runtime.');
    setTextInput('');
  };

  const commitCurrentTranscript = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const transcript = liveTranscript.trim() || textInput.trim();
    if (!transcript) return;
    setLiveTranscript(transcript);
    startTurnTiming();
    wsRef.current.send(JSON.stringify({ type: 'transcript.commit', text: transcript }));
    setStatusNote('Committed transcript to runtime.');
    if (textInput.trim()) setTextInput('');
  };

  const saveProfile = async () => {
    if (!targetId) return;
    const basePath = targetType === 'crew' ? '/api/voice/crews' : '/api/voice/agents';
    await fetch(`${basePath}/${targetId}/profile`, {
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
        meta: {
          preset_id: selectedVoiceConfigId ? Number(selectedVoiceConfigId) : null,
          vad_enabled: vadEnabled,
          vad_silence_threshold_secs: vadSilenceThresholdSecs,
          vad_threshold: vadThreshold,
          min_speech_duration_ms: minSpeechDurationMs,
          min_silence_duration_ms: minSilenceDurationMs,
          max_tokens_to_recompute: maxTokensToRecompute,
          browser_noise_suppression: browserNoiseSuppression,
          browser_echo_cancellation: browserEchoCancellation,
          browser_auto_gain_control: browserAutoGainControl,
          push_to_talk: pushToTalk,
        },
      }),
    });
    pushEvent('profile.saved', { targetType, targetId: Number(targetId) });
  };

  const saveCurrentAsPreset = async () => {
    const name = window.prompt('Voice preset name');
    if (!name?.trim()) return;
    const res = await fetch('/api/voice/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        voice_id: voiceId,
        tts_model_id: ttsModelId,
        stt_model_id: sttModelId,
        output_format: outputFormat,
        sample_rate: sampleRate,
        language_code: languageCode,
        auto_tts: autoTts,
        meta: {
          vad_enabled: vadEnabled,
          vad_silence_threshold_secs: vadSilenceThresholdSecs,
          vad_threshold: vadThreshold,
          min_speech_duration_ms: minSpeechDurationMs,
          min_silence_duration_ms: minSilenceDurationMs,
          max_tokens_to_recompute: maxTokensToRecompute,
          browser_noise_suppression: browserNoiseSuppression,
          browser_echo_cancellation: browserEchoCancellation,
          browser_auto_gain_control: browserAutoGainControl,
          push_to_talk: pushToTalk,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data?.error || 'Failed to save voice preset'));
      return;
    }
    await loadVoiceConfigs();
    setSelectedVoiceConfigId(String(data.id || ''));
  };

  const updateSelectedPreset = async () => {
    if (!selectedVoiceConfigId) return;
    const preset = voiceConfigs.find((item) => String(item.id) === String(selectedVoiceConfigId));
    if (!preset) return;
    const res = await fetch(`/api/voice/configs/${selectedVoiceConfigId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: preset.name,
        voice_id: voiceId,
        tts_model_id: ttsModelId,
        stt_model_id: sttModelId,
        output_format: outputFormat,
        sample_rate: sampleRate,
        language_code: languageCode,
        auto_tts: autoTts,
        meta: {
          vad_enabled: vadEnabled,
          vad_silence_threshold_secs: vadSilenceThresholdSecs,
          vad_threshold: vadThreshold,
          min_speech_duration_ms: minSpeechDurationMs,
          min_silence_duration_ms: minSilenceDurationMs,
          max_tokens_to_recompute: maxTokensToRecompute,
          browser_noise_suppression: browserNoiseSuppression,
          browser_echo_cancellation: browserEchoCancellation,
          browser_auto_gain_control: browserAutoGainControl,
          push_to_talk: pushToTalk,
        },
        notes: preset.notes || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data?.error || 'Failed to update voice preset'));
      return;
    }
    await loadVoiceConfigs();
  };

  const deleteSelectedPreset = async () => {
    if (!selectedVoiceConfigId) return;
    if (!window.confirm('Delete this voice preset?')) return;
    await fetch(`/api/voice/configs/${selectedVoiceConfigId}`, { method: 'DELETE' });
    setSelectedVoiceConfigId('');
    await loadVoiceConfigs();
  };

  const saveSelectedPresetAccess = async () => {
    if (!selectedVoiceConfigId) return;
    setPresetAccessSaving(true);
    setPresetAccessError('');
    try {
      const res = await fetch(`/api/resource-access/voice_config/${selectedVoiceConfigId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: presetVisibility,
          shared_user_ids: presetSharedUserIdsText.split(',').map((value) => value.trim()).filter(Boolean),
          shared_org_ids: presetSharedOrgIdsText.split(',').map((value) => value.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Failed to save preset access'));
      const payload = data as ResourceAccessPayload;
      setPresetAccess(payload);
      setStatusNote('Voice preset access updated.');
    } catch (e: any) {
      setPresetAccessError(e.message || 'Failed to save preset access');
    } finally {
      setPresetAccessSaving(false);
    }
  };

  const startRecording = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setError('');
    directSttActiveRef.current = false;
    if (directElevenLabsMedia) {
      try {
        const isOpen = await connectDirectSttSocket();
        directSttActiveRef.current = Boolean(isOpen);
      } catch (e: any) {
        directSttActiveRef.current = false;
        setStatusNote('Direct ElevenLabs STT is unavailable, using server relay mode.');
        pushEvent('stt.socket.error.direct', { message: e?.message || 'Failed to open direct STT socket' });
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate,
        noiseSuppression: browserNoiseSuppression,
        echoCancellation: browserEchoCancellation,
        autoGainControl: browserAutoGainControl,
      },
    });
    const audioContext = new AudioContext({ sampleRate });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    streamRef.current = stream;
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    processorRef.current = processor;
    analyserRef.current = analyser;

    wsRef.current.send(JSON.stringify({
      type: 'session.update',
      audioMimeType: 'audio/pcm',
      voiceId,
      ttsModelId,
      sttModelId,
      outputFormat,
      sampleRate,
      languageCode,
      autoTts: autoTts && !directElevenLabsMedia,
      vadEnabled,
      vadSilenceThresholdSecs,
      vadThreshold,
      minSpeechDurationMs,
      minSilenceDurationMs,
      maxTokensToRecompute,
      browserNoiseSuppression,
      browserEchoCancellation,
      browserAutoGainControl,
      pushToTalk,
    }));

    processor.onaudioprocess = (event) => {
      if (pushToTalk && !pushToTalkPressedRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      const base64 = toBase64(pcm.buffer);
      if (directSttActiveRef.current && directSttSocketRef.current?.readyState === WebSocket.OPEN) {
        directSttSocketRef.current.send(JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: base64,
        }));
      } else {
        wsRef.current?.send(JSON.stringify({
          type: 'audio.stream',
          chunk: base64,
        }));
      }
    };

    const levelBuffer = new Uint8Array(analyser.frequencyBinCount);
    const updateMicLevel = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(levelBuffer);
      let sumSquares = 0;
      for (let i = 0; i < levelBuffer.length; i += 1) {
        const normalized = (levelBuffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / levelBuffer.length);
      const level = Math.min(1, rms * 8);
      setMicLevel(level);
      const thresholdFloor = Math.max(0.08, Math.min(0.6, vadThreshold * 0.35));
      setSpeechLikelihood(level > thresholdFloor ? 'speech' : level > 0.025 ? 'background' : 'idle');
      animationFrameRef.current = window.requestAnimationFrame(updateMicLevel);
    };

    source.connect(analyser);
    source.connect(processor);
    processor.connect(audioContext.destination);
    animationFrameRef.current = window.requestAnimationFrame(updateMicLevel);
    setIsRecording(true);
    setStatusNote(pushToTalk ? 'Push-to-talk is enabled. Hold the button or space bar while speaking.' : 'Listening live. ElevenLabs committed speech segments will invoke the selected runtime automatically.');
  };

  const stopRecording = () => {
    closeDirectSttSocket();
    closeDirectTtsSocket();
    stopMicVisualization();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
    setIsPushToTalkPressed(false);
    setStatusNote('Microphone stopped. Waiting for any final committed speech segment.');
  };

  useEffect(() => {
    pushToTalkPressedRef.current = isPushToTalkPressed;
  }, [isPushToTalkPressed]);

  useEffect(() => {
    if (!pushToTalk || !isConnected || !isRecording) return;
    const shouldIgnoreKeyTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (shouldIgnoreKeyTarget(event.target)) return;
      event.preventDefault();
      setIsPushToTalkPressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (shouldIgnoreKeyTarget(event.target)) return;
      event.preventDefault();
      setIsPushToTalkPressed(false);
    };
    const onWindowBlur = () => setIsPushToTalkPressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [pushToTalk, isConnected, isRecording]);

  useEffect(() => {
    if (directElevenLabsMedia) return;
    closeDirectSttSocket();
    closeDirectTtsSocket();
  }, [directElevenLabsMedia]);

  useEffect(() => {
    if (!lastAudioSrc || !audioRef.current) return;
    audioRef.current.play().catch(() => undefined);
  }, [lastAudioSrc]);

  useEffect(() => () => {
    closeDirectSttSocket();
    closeDirectTtsSocket();
    resetAudioStream();
    stopMicVisualization();
  }, []);

  return (
    <div className="space-y-6">
      <div className="swarm-hero p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white">Voice Console</h1>
            <p className="text-slate-300 mt-1">Run realtime voice sessions with fast turn control, barge-in, and live latency feedback.</p>
          </div>
          <div className="rounded-full bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200">
            Manage session actions in Session Setup
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 px-4 py-4 text-white shadow-[0_18px_65px_rgba(15,23,42,0.28)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Target</div>
          <div className="mt-2 text-lg font-semibold">{selectedTarget?.name || `No ${targetType} selected`}</div>
          <div className="mt-1 text-xs text-slate-400">{selectedTarget?.subtitle || selectedTarget?.role || 'Select a runtime target'}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 px-4 py-4 text-white shadow-[0_18px_65px_rgba(15,23,42,0.28)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Session</div>
          <div className="mt-2 text-lg font-semibold">{isConnected ? 'Connected' : 'Disconnected'}</div>
          <div className="mt-1 text-xs text-slate-400">{sessionId ? `Session ${sessionId}` : 'Open a socket to start a voice turn'}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 px-4 py-4 text-white shadow-[0_18px_65px_rgba(15,23,42,0.28)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Turn State</div>
          <div className="mt-2 text-lg font-semibold capitalize">{turnState}</div>
          <div className="mt-1 text-xs text-slate-400">Barge-in and VAD state are tracked live during the session.</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 px-4 py-4 text-white shadow-[0_18px_65px_rgba(15,23,42,0.28)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Attachments</div>
          <div className="mt-2 text-lg font-semibold">{sessionAttachments.length}</div>
          <div className="mt-1 text-xs text-slate-400">{sessionAttachments.length ? 'Session files will be included with the next turn.' : 'Attach image or files after you connect.'}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/88 px-4 py-4 text-white shadow-[0_18px_65px_rgba(15,23,42,0.28)]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Latency</div>
          <div className={`mt-2 text-sm font-semibold ${latencyTone}`}>
            {latencyMetrics.sttToReplyMs != null ? `${latencyMetrics.sttToReplyMs}ms` : '--'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Reply start
            {latencyMetrics.replyToTtsMs != null ? ` • TTS ${latencyMetrics.replyToTtsMs}ms` : ''}
            {latencyMetrics.turnTotalMs != null ? ` • Total ${latencyMetrics.turnTotalMs}ms` : ''}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-cyan-900">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-cyan-400 text-cyan-600 focus:ring-cyan-500"
            checked={directElevenLabsMedia}
            onChange={(event) => setDirectElevenLabsMedia(event.target.checked)}
          />
          <span>
            <span className="font-semibold">Direct ElevenLabs Media Plane</span>
            <span className="block text-xs text-cyan-800/90">
              Streams microphone audio directly to ElevenLabs realtime STT from the browser and only sends committed transcript turns to your orchestration runtime.
            </span>
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6">
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Session Setup</div>
                <div className="mt-1 text-xs text-slate-500">Pick the runtime target, choose a saved voice profile, and connect. Advanced synthesis and turn controls stay below when you need them.</div>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                Core Flow
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Find Target</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    placeholder={`Search ${targetType}s by name or role...`}
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{availableTargets.length} visible target{availableTargets.length === 1 ? '' : 's'} for {targetType}</div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Target Type</label>
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
                <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Voice Config Preset</label>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
                  value={selectedVoiceConfigId}
                  onChange={(e) => applyVoiceConfig(e.target.value)}
                >
                  <option value="">Custom runtime values</option>
                  {voiceConfigs.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Session Actions</div>
                  <div className="mt-1 text-sm text-cyan-900">Step 1: connect socket. Step 2: start microphone streaming.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={isConnected ? disconnect : connect}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 ${
                      isConnected ? 'bg-red-500 text-white' : 'bg-slate-900 text-white'
                    }`}
                  >
                    {isConnected ? <PhoneOff size={14} /> : <PhoneCall size={14} />}
                    {isConnected ? 'Disconnect' : 'Connect'}
                  </button>
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={!isConnected}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold text-white inline-flex items-center gap-2 disabled:opacity-40 ${
                      isRecording ? 'bg-red-500' : 'bg-emerald-600'
                    }`}
                  >
                    {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
                    {isRecording ? 'Stop Mic' : 'Start Mic'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={autoTts} onChange={(e) => setAutoTts(e.target.checked)} />
                Auto-play TTS reply
              </label>
              <button onClick={saveProfile} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2">
                <Save size={14} />
                {targetType === 'agent' ? 'Save Agent Voice Profile' : 'Save Crew Voice Profile'}
              </button>
              <button onClick={saveCurrentAsPreset} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                Save As Preset
              </button>
              <button onClick={updateSelectedPreset} disabled={!selectedVoiceConfigId} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40">
                Update Preset
              </button>
              <button onClick={deleteSelectedPreset} disabled={!selectedVoiceConfigId} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">
                Delete Preset
              </button>
              <button
                onClick={() => {
                  setTargetSearch('');
                  setEventSearch('');
                  setEventTypeFilter('all');
                }}
                disabled={!hasVoiceFilters}
                className="ml-auto rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45 inline-flex items-center gap-1"
              >
                <RotateCcw size={14} />
                Reset Filters
              </button>
            </div>

            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Voice Settings</div>
                  <div className="mt-1 text-xs text-slate-500">Voice ID, synthesis model, transcription model, language, and audio format.</div>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 group-open:bg-slate-900 group-open:text-white">
                  Expand
                </span>
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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
            </details>

            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Turn Detection And Disturbance Control</div>
                  <div className="mt-1 text-xs text-slate-500">Tune VAD timing and browser-side cleanup to ignore disturbances without making the assistant feel slow.</div>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 group-open:bg-slate-900 group-open:text-white">
                  Expand
                </span>
              </summary>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {ENVIRONMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyEnvironmentPreset(preset.id)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-100"
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={vadEnabled} onChange={(e) => setVadEnabled(e.target.checked)} />
                    VAD auto-commit
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={browserNoiseSuppression} onChange={(e) => setBrowserNoiseSuppression(e.target.checked)} />
                    Browser noise suppression
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={browserEchoCancellation} onChange={(e) => setBrowserEchoCancellation(e.target.checked)} />
                    Echo cancellation
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={browserAutoGainControl} onChange={(e) => setBrowserAutoGainControl(e.target.checked)} />
                    Auto gain control
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={pushToTalk} onChange={(e) => setPushToTalk(e.target.checked)} />
                    Push to talk
                  </label>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Silence Threshold (sec)</label>
                    <input type="number" min="0.2" max="3" step="0.1" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={vadSilenceThresholdSecs} onChange={(e) => setVadSilenceThresholdSecs(Number(e.target.value) || DEFAULT_VAD_SILENCE_THRESHOLD_SECS)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">VAD Threshold</label>
                    <input type="number" min="0.1" max="0.95" step="0.05" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={vadThreshold} onChange={(e) => setVadThreshold(Number(e.target.value) || DEFAULT_VAD_THRESHOLD)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Min Speech (ms)</label>
                    <input type="number" min="50" max="2000" step="10" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={minSpeechDurationMs} onChange={(e) => setMinSpeechDurationMs(Number(e.target.value) || DEFAULT_MIN_SPEECH_DURATION_MS)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Min Silence (ms)</label>
                    <input type="number" min="50" max="3000" step="10" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={minSilenceDurationMs} onChange={(e) => setMinSilenceDurationMs(Number(e.target.value) || DEFAULT_MIN_SILENCE_DURATION_MS)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Recompute Window</label>
                    <input type="number" min="0" max="50" step="1" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono" value={maxTokensToRecompute} onChange={(e) => setMaxTokensToRecompute(Number(e.target.value) || DEFAULT_MAX_TOKENS_TO_RECOMPUTE)} />
                  </div>
                </div>
                <div className={`rounded-xl border px-3 py-3 ${sensitivityGuide.tone}`}>
                  <div className="text-sm font-semibold">{sensitivityGuide.title}</div>
                  <div className="text-xs mt-1 opacity-90">{sensitivityGuide.text}</div>
                </div>
              </div>
            </details>

            {selectedVoiceConfigId ? (
              <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Preset Sharing</div>
                    <div className="mt-1 text-xs text-slate-500">Manage who can see and reuse this voice preset.</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 group-open:bg-slate-900 group-open:text-white">
                    Expand
                  </span>
                </summary>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">Shared settings for this preset.</div>
                    {presetAccessLoading ? <div className="text-xs text-slate-500">Loading…</div> : null}
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">Owner User</div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">{presetAccess?.owner?.owner_user_id || 'Unknown'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">Owner Org</div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">{presetAccess?.owner?.owner_org_id || 'None'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500">Visibility</div>
                      <select
                        value={presetVisibility}
                        onChange={(e) => setPresetVisibility(e.target.value === 'org' ? 'org' : 'private')}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="private">Private</option>
                        <option value="org">Organization</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Shared User IDs</label>
                      <textarea
                        value={presetSharedUserIdsText}
                        onChange={(e) => setPresetSharedUserIdsText(e.target.value)}
                        placeholder="user_123, user_456"
                        className="min-h-[88px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Shared Org IDs</label>
                      <textarea
                        value={presetSharedOrgIdsText}
                        onChange={(e) => setPresetSharedOrgIdsText(e.target.value)}
                        placeholder="org_123, org_456"
                        className="min-h-[88px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  {presetAccessError ? <div className="mt-3 text-sm text-red-600">{presetAccessError}</div> : null}
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={saveSelectedPresetAccess}
                      disabled={presetAccessLoading || presetAccessSaving}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {presetAccessSaving ? 'Saving Sharing…' : 'Save Preset Sharing'}
                    </button>
                  </div>
                </div>
              </details>
            ) : null}

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
                <span className={`rounded-full px-2.5 py-1 ${
                  turnState === 'speaking'
                    ? 'bg-violet-100 text-violet-700'
                    : turnState === 'thinking'
                      ? 'bg-amber-100 text-amber-700'
                      : turnState === 'listening'
                        ? 'bg-cyan-100 text-cyan-700'
                        : 'bg-slate-200 text-slate-600'
                }`}>
                  {turnState.charAt(0).toUpperCase() + turnState.slice(1)}
                </span>
                {sessionId ? <span className="rounded-full bg-slate-200 px-2.5 py-1 font-mono text-slate-700">session {sessionId}</span> : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Realtime Voice Controls</div>
                <div className="mt-1 text-xs text-slate-500">Use manual text, transcript commit, and attachments from one dock.</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
              }`}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { void uploadSessionAttachments(e.target.files); }}
            />
            <textarea
              className="min-h-[120px] w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Optional fallback: type text manually if you want to trigger the selected runtime without using the microphone."
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={sendText}
                disabled={!isConnected || !textInput.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 inline-flex items-center gap-2"
              >
                <Send size={14} />
                Send Manual Text
              </button>
              <button
                onClick={commitCurrentTranscript}
                disabled={!isConnected || (!liveTranscript.trim() && !textInput.trim())}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-40"
              >
                Commit Transcript
              </button>
              {pushToTalk && isRecording ? (
                <button
                  type="button"
                  onMouseDown={() => setIsPushToTalkPressed(true)}
                  onMouseUp={() => setIsPushToTalkPressed(false)}
                  onMouseLeave={() => setIsPushToTalkPressed(false)}
                  onTouchStart={() => setIsPushToTalkPressed(true)}
                  onTouchEnd={() => setIsPushToTalkPressed(false)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold ${isPushToTalkPressed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}
                >
                  {isPushToTalkPressed ? 'Talking… release to mute' : 'Hold to Talk (or Space)'}
                </button>
              ) : null}
              <button
                onClick={() => attachmentInputRef.current?.click()}
                disabled={!isConnected || uploadingAttachment}
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 inline-flex items-center gap-2 disabled:opacity-40"
              >
                <Paperclip size={14} />
                {uploadingAttachment ? 'Uploading…' : 'Attach Image / File'}
              </button>
            </div>
            {pushToTalk ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Push-to-talk is active. Hold the green button or press and hold the space bar while speaking.
              </div>
            ) : null}
            {sessionAttachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sessionAttachments.map((attachment) => (
                  <div key={attachment.id} className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[11px] font-semibold text-cyan-800">
                    <Paperclip size={11} />
                    <a href={attachment.url} target="_blank" rel="noreferrer" className="max-w-[15rem] truncate hover:underline">
                      {attachment.name}
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-900">
              Mic audio streams live to ElevenLabs STT. Committed speech segments automatically invoke the selected agent or crew, and any attached files are included in the current session context.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mic Activity</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {speechLikelihood === 'speech' ? 'Speech likely' : speechLikelihood === 'background' ? 'Background noise only' : 'Waiting for input'}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  speechLikelihood === 'speech'
                    ? 'bg-emerald-100 text-emerald-700'
                    : speechLikelihood === 'background'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-200 text-slate-600'
                }`}>
                  {Math.round(micLevel * 100)}%
                </span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    speechLikelihood === 'speech'
                      ? 'bg-emerald-500'
                      : speechLikelihood === 'background'
                        ? 'bg-amber-400'
                        : 'bg-slate-400'
                  }`}
                  style={{ width: `${Math.max(4, Math.round(micLevel * 100))}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Use this while tuning VAD. If the bar stays active during room noise, increase `VAD Threshold`, `Min Speech`, or `Min Silence`.
              </div>
            </div>
            {statusNote ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{statusNote}</div> : null}
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Radio size={16} className="text-cyan-600" />
                Live Monitor
              </div>
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setMonitorTab('conversation')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${monitorTab === 'conversation' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                >
                  Conversation
                </button>
                <button
                  type="button"
                  onClick={() => setMonitorTab('events')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${monitorTab === 'events' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                >
                  Event Stream
                </button>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  placeholder="Search monitor payloads, transcript snippets, and event messages..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm"
                />
              </div>
              <select
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="all">All Event Types</option>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            {monitorTab === 'conversation' ? (
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
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-950 text-slate-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <Activity size={16} className="text-emerald-400" />
                  Session Events ({filteredEvents.length})
                </div>
                <div className="max-h-[520px] overflow-auto space-y-2 font-mono text-xs">
                  {filteredEvents.length ? filteredEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                        <span>{event.type}</span>
                        <span>{new Date(event.ts).toLocaleTimeString()}</span>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap text-slate-200">{JSON.stringify(event.payload, null, 2)}</pre>
                    </div>
                  )) : (
                    <div className="text-slate-500">{events.length ? 'No events match current filters.' : 'Connect a voice session to watch runtime events, transcripts, and TTS output.'}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
