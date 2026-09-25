import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';

export interface HelpRoom { id: string; caller: number; guest: number; status: string; subject: string; peer_name: string; incoming: boolean; owned: boolean; expires: string }
export interface HelpContact { id: number; name: string; team: string; role: string; online: boolean; busy: boolean }
interface ChatLine { id: string; text: string; own: boolean }
interface Runtime { id: string; alive: boolean; pc: RTCPeerConnection | null; channel: RTCDataChannel | null; screen: MediaStream | null; mic: MediaStream | null; remote: MediaStream; source: string; after: number; pending: RTCIceCandidateInit[]; queue: Promise<void> }
type Packet = { type: 'chat'; text: string } | { type: 'state'; source: string; mic: boolean } | { type: 'point'; x: number; y: number };

export function helpError(error: unknown): string {
  const e = error as { response?: { data?: { detail?: unknown } }; name?: string; message?: string };
  if (e.name === 'NotAllowedError') return 'Permission was cancelled or blocked. Nothing new is being shared. Try again when you are ready.';
  if (e.name === 'NotFoundError') return 'No camera or microphone was found on this device.';
  if (e.name === 'NotReadableError') return 'This device is in use or unavailable. Close other camera or microphone apps and try again.';
  return typeof e.response?.data?.detail === 'string' ? e.response.data.detail : 'The connection could not be completed. Check your internet connection and try again.';
}

export function useLiveHelp(userId: number) {
  const [device] = useState(() => crypto.randomUUID());
  const [room, setRoom] = useState<HelpRoom | null>(null);
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; }, [room]);
  const [incoming, setIncoming] = useState<HelpRoom | null>(null);
  const [elsewhere, setElsewhere] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState('Waiting');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [source, setSource] = useState('');
  const [remoteSource, setRemoteSource] = useState('');
  const [mic, setMic] = useState(false);
  const [localAudio, setLocalAudio] = useState<MediaStream | null>(null);
  const [channel, setChannel] = useState<RTCDataChannel | null>(null);
  const [remoteMic, setRemoteMic] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [point, setPoint] = useState<{ x: number; y: number; at: number } | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const mounted = useRef(true);

  const cleanup = () => {
    const r = runtime.current;
    if (r) { r.alive = false; r.screen?.getTracks().forEach(t => t.stop()); r.mic?.getTracks().forEach(t => t.stop()); r.pc?.close(); r.channel?.close(); }
    runtime.current = null;
    setChannel(null); setLocalAudio(null); setLocal(null); setRemote(null); setSource(''); setRemoteSource(''); setMic(false); setRemoteMic(false); setPoint(null); setLines([]); setError(''); setConnection('Not connected');
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cleanup(); }; }, []);

  // Available on every authenticated page; no microphone/screen permissions are requested here.
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { data } = await apiClient.post<{ rooms: HelpRoom[] }>('/api/live-help/presence', { device }, { timeout: 12000 });
        if (!alive) return;
        setIncoming(data.rooms.find(r => r.incoming && r.status === 'ringing' && r.id !== roomRef.current?.id) || null);
        setElsewhere(data.rooms.some(r => r.status === 'active' && !r.owned || !r.incoming && !r.owned));
      } catch { /* Directory remains usable; a session's own poll handles connection failures. */ }
      if (alive) timer = setTimeout(tick, 10000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [device, userId]);

  useEffect(() => {
    if (!room?.owned || !['ringing', 'active'].includes(room.status)) return;
    const r: Runtime = { id: room.id, alive: true, pc: null, channel: null, screen: null, mic: null, remote: new MediaStream(), source: '', after: 0, pending: [], queue: Promise.resolve() };
    runtime.current = r;
    setLines([]); setError(''); setConnection(room.status === 'ringing' ? 'Waiting for acceptance' : 'Connecting');
    let timer: ReturnType<typeof setTimeout>; let lastSuccess = Date.now(); let negotiatingSince = Date.now();
    const sendSignal = (kind: string, payload: unknown) => {
      const data = { device, nonce: crypto.randomUUID(), kind, payload: JSON.stringify(payload) };
      const send = async () => {
        if (!r.alive) return;
        try { await apiClient.post(`/api/live-help/rooms/${r.id}/signals`, data, { timeout: 10000 }); }
        catch (first) { if (!r.alive) return; await apiClient.post(`/api/live-help/rooms/${r.id}/signals`, data, { timeout: 10000 }).catch(() => { throw first; }); }
      };
      r.queue = r.queue.then(send); return r.queue;
    };
    const bindChannel = (channel: RTCDataChannel) => {
      r.channel = channel;
      channel.onopen = () => { if (r.alive) { setChannel(channel); setConnection('Connected'); channel.send(JSON.stringify({ type: 'state', source: r.source, mic: false })); } };
      channel.onmessage = event => {
        if (!r.alive || typeof event.data !== 'string' || event.data.length > 5000) return;
        try {
          const data = JSON.parse(event.data) as Packet;
          if (data.type === 'chat' && typeof data.text === 'string' && data.text.length <= 2000) setLines(old => [...old.slice(-199), { id: crypto.randomUUID(), text: data.text, own: false }]);
          if (data.type === 'state') { setRemoteSource(['screen', 'camera'].includes(data.source) ? data.source : ''); setRemoteMic(data.mic === true); }
          if (data.type === 'point' && Number.isFinite(data.x) && Number.isFinite(data.y) && data.x >= 0 && data.x <= 1 && data.y >= 0 && data.y <= 1) setPoint({ x: data.x, y: data.y, at: Date.now() });
        } catch { /* Ignore malformed peer data. React renders chat as plain text. */ }
      };
    };
    const connect = async () => {
      const { data } = await apiClient.get<{ iceServers: RTCIceServer[]; relay_configured: boolean }>(`/api/live-help/rooms/${r.id}/connection`, { params: { device }, timeout: 10000 });
      if (!r.alive) return;
      if (!data.relay_configured) setError('The connection relay is not configured. Calls may only work on the same network until the administrator enables it.');
      const pc = new RTCPeerConnection({ iceServers: data.iceServers }); r.pc = pc;
      pc.onicecandidate = e => { if (e.candidate && r.alive) void sendSignal('candidate', e.candidate.toJSON()).catch(() => { if (r.alive) setError('Connection setup could not be sent. End this session and try again.'); }); };
      pc.ontrack = e => { if (r.alive) { r.remote.addTrack(e.track); setRemote(new MediaStream(r.remote.getTracks())); } };
      pc.onconnectionstatechange = () => {
        if (!r.alive) return;
        if (pc.connectionState === 'failed') { cleanup(); setRoom(null); setNotice('The call could not connect. Check your network and start a new session.'); void apiClient.post(`/api/live-help/rooms/${r.id}/action`, { device, action: 'end' }).catch(() => undefined); }
        else setConnection(pc.connectionState === 'connected' && r.channel?.readyState === 'open' ? 'Connected' : pc.connectionState === 'disconnected' ? 'Reconnecting' : 'Connecting');
      };
      if (!room.incoming) {
        pc.addTransceiver('video', { direction: 'sendrecv' }); pc.addTransceiver('audio', { direction: 'sendrecv' });
        bindChannel(pc.createDataChannel('help'));
        await pc.setLocalDescription(await pc.createOffer());
        if (r.alive) await sendSignal('offer', pc.localDescription);
      } else pc.ondatachannel = e => bindChannel(e.channel);
    };
    const tick = async () => {
      try {
        const { data } = await apiClient.get<{ room: HelpRoom; signals: { id: number; kind: string; payload: string }[] }>(`/api/live-help/rooms/${r.id}`, { params: { device, after: r.after }, timeout: 10000 });
        if (!r.alive) return;
        lastSuccess = Date.now();
        if (!['ringing', 'active'].includes(data.room.status)) {
          cleanup(); setRoom(null); setNotice(data.room.status === 'declined' ? 'Invitation declined.' : data.room.status === 'expired' ? 'Session expired or the other person disconnected.' : 'The session has ended. Screen, camera and microphone are off.'); return;
        }
        if (data.room.status === 'active' && room.status === 'ringing') { setRoom(data.room); return; }
        if (data.room.status === 'active') {
          if (!r.pc) { negotiatingSince = Date.now(); await connect(); }
          if (!r.alive || !r.pc) return;
          for (const s of data.signals) {
            const payload = JSON.parse(s.payload);
            if (s.kind === 'offer' || s.kind === 'answer') {
              await r.pc.setRemoteDescription(payload);
              for (const candidate of r.pending) await r.pc.addIceCandidate(candidate);
              r.pending = [];
              if (s.kind === 'offer') {
                // Offer-created transceivers start recvonly. Reserve both sending directions
                // now so the invited person can later share without another negotiation.
                r.pc.getTransceivers().forEach(t => { t.direction = 'sendrecv'; });
                await r.pc.setLocalDescription(await r.pc.createAnswer()); await sendSignal('answer', r.pc.localDescription);
              }
            } else if (r.pc.remoteDescription) await r.pc.addIceCandidate(payload); else r.pending.push(payload);
            r.after = s.id;
          }
          if (r.pc.connectionState !== 'connected' && Date.now() - negotiatingSince > 60000) throw new Error('Connection timed out');
          if (r.pc.connectionState === 'connected') negotiatingSince = Date.now();
        }
      } catch (e) {
        if (!r.alive) return;
        setError(helpError(e));
        const status = (e as { response?: { status: number } }).response?.status;
        if (Date.now() - lastSuccess > 20000 || [403, 404, 409].includes(status || 0) || Date.now() - negotiatingSince > 60000) {
          cleanup(); setRoom(null); setNotice('Connection lost. Sharing and microphone have been stopped. Start a new session to reconnect.');
          void apiClient.post(`/api/live-help/rooms/${r.id}/action`, { device, action: 'end' }).catch(() => undefined); return;
        }
      }
      if (r.alive) timer = setTimeout(tick, 1800);
    };
    void tick();
    return () => { clearTimeout(timer); if (runtime.current === r) cleanup(); else { r.alive = false; r.pc?.close(); } };
  }, [room?.id, room?.status, room?.owned, room?.incoming, device]);

  const send = (packet: Packet) => {
    const channel = runtime.current?.channel;
    if (channel?.readyState !== 'open') throw new Error('Not connected');
    if (channel.bufferedAmount > 64000) throw new Error('Connection is busy');
    channel.send(JSON.stringify(packet));
  };
  const state = () => { const r = runtime.current; if (r?.channel?.readyState === 'open') send({ type: 'state', source: r.source, mic: !!r.mic?.getAudioTracks().some(t => t.enabled && t.readyState === 'live') }); };
  const stopSharing = async () => {
    const r = runtime.current; if (!r) return;
    r.screen?.getTracks().forEach(t => t.stop()); r.screen = null; r.source = ''; setLocal(null); setSource(''); setPoint(null);
    state(); await r.pc?.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender.replaceTrack(null);
  };
  const share = async (kind: 'screen' | 'camera') => {
    const r = runtime.current; if (!r?.pc || connection !== 'Connected') return;
    setError('');
    let stream: MediaStream | undefined;
    try {
      // Must be called directly from the user's click, before any await/API request.
      stream = kind === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 }, audio: false }) : await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (!r.alive || runtime.current !== r) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      const sender = r.pc.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender;
      if (!sender) throw new Error('Video channel unavailable');
      await sender.replaceTrack(track);
      if (!r.alive) { stream.getTracks().forEach(t => t.stop()); return; }
      r.screen?.getTracks().forEach(t => t.stop()); r.screen = stream; r.source = kind;
      track.onended = () => { if (r.alive && r.screen === stream) void stopSharing(); };
      setLocal(stream); setSource(kind); state();
    } catch (e) { stream?.getTracks().forEach(t => t.stop()); if (r.alive) setError(helpError(e)); }
  };
  const toggleMic = async () => {
    const r = runtime.current; if (!r?.pc || connection !== 'Connected') return;
    setError('');
    if (r.mic) { r.mic.getTracks().forEach(t => t.stop()); r.mic = null; setLocalAudio(null); setMic(false); state(); await r.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender.replaceTrack(null); return; }
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!r.alive) { stream.getTracks().forEach(t => t.stop()); return; }
      const sender = r.pc.getTransceivers().find(t => t.receiver.track.kind === 'audio')?.sender;
      if (!sender) throw new Error('Audio channel unavailable');
      await sender.replaceTrack(stream.getAudioTracks()[0]);
      if (!r.alive) { stream.getTracks().forEach(t => t.stop()); return; }
      r.mic = stream; setLocalAudio(stream); setMic(true); state();
      stream.getAudioTracks()[0].onended = () => { if (r.alive) { r.mic = null; setLocalAudio(null); setMic(false); state(); } };
    } catch (e) { stream?.getTracks().forEach(t => t.stop()); if (r.alive) setError(helpError(e)); }
  };
  const invite = async (contact: HelpContact, subject: string) => {
    setError(''); setNotice('');
    const { data } = await apiClient.post<HelpRoom>('/api/live-help/rooms', { device, user_id: contact.id, subject }, { timeout: 12000 });
    if (mounted.current) setRoom(data);
  };
  const answer = async (accept: boolean) => {
    if (!incoming) return;
    const { data } = await apiClient.post<HelpRoom>(`/api/live-help/rooms/${incoming.id}/action`, { device, action: accept ? 'accept' : 'decline' }, { timeout: 12000 });
    if (mounted.current) { setIncoming(null); if (accept) { setNotice(''); setRoom(data); } }
  };
  const end = async () => {
    const current = roomRef.current; cleanup(); setRoom(null); setLines([]); setNotice('Session ended. Screen, camera and microphone are off.');
    if (current) await apiClient.post(`/api/live-help/rooms/${current.id}/action`, { device, action: 'end' }, { timeout: 10000 }).catch(() => setNotice('Sharing stopped on this device. The offline session will expire automatically.'));
  };
  const chat = (text: string) => { const trimmed = text.trim().slice(0, 2000); if (!trimmed) return; send({ type: 'chat', text: trimmed }); setLines(old => [...old.slice(-199), { id: crypto.randomUUID(), text: trimmed, own: true }]); };
  return { channel, localAudio, room, incoming, elsewhere, error, setError, notice, setNotice, connection, local, remote, source, remoteSource, mic, remoteMic, lines, point, invite, answer, end, share, stopSharing, toggleMic, chat, pointAt: (x: number, y: number) => send({ type: 'point', x, y }) };
}
