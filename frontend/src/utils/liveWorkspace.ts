import { BOARD_LIMIT, safeFilename, validMark, type BoardMark } from './liveBoard';
import { LiveRecorder, type RecordingInputs } from './liveRecorder';

const MAX_FILE = 20 * 1024 * 1024;
const CHUNK = 12000;
type Phase = 'idle' | 'requesting' | 'requested' | 'approved' | 'peer-approved' | 'recording' | 'peer-recording';
export interface SharedFile { id: string; name: string; size: number; own: boolean; progress: number; status: 'offered' | 'transferring' | 'ready' | 'declined' | 'failed'; blob?: Blob }
export interface SavedRecording { id: string; name: string; blob: Blob }
interface Snapshot { ready: boolean; marks: BoardMark[]; files: SharedFile[]; phase: Phase; recordings: SavedRecording[]; message: string }
type Wire = { workspace: 1; type: string; id?: string; [key: string]: unknown };
interface Transfer { id: string; size: number; chunks: Uint8Array<ArrayBuffer>[]; received: number; sequence: number; touched: number }

/** Session-only collaboration over the existing ordered, encrypted peer data channel. */
export class LiveWorkspace {
  private state: Snapshot = { ready: false, marks: [], files: [], phase: 'idle', recordings: [], message: '' };
  private listeners = new Set<() => void>();
  private channel: RTCDataChannel | null = null;
  private tick?: ReturnType<typeof setInterval>;
  private ownMarks: string[] = [];
  private clock = 0;
  private fileTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private removed = new Set<string>();
  private outgoing = new Map<string, File>();
  private incoming: Transfer | null = null;
  private pumping = new Set<string>();
  private recordId = '';
  private deadline = 0;
  private lastPeer = 0;
  private recorder: LiveRecorder | null = null;
  private inputs: RecordingInputs | null = null;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<Snapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  message(text: string) { this.update({ message: text }); }
  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.channel?.readyState !== 'open') throw new Error('The session is disconnected.');
    if (this.channel.bufferedAmount > 256000) throw new Error('The transfer is busy. Please try again.');
    this.channel.send(JSON.stringify({ workspace: 1, type, ...data }));
  }
  private trySend(type: string, data: Record<string, unknown> = {}) { try { this.send(type, data); } catch { /* Disconnect/timeout closes peer work. */ } }
  connect(channel: RTCDataChannel) {
    this.disconnect(); this.channel = channel; this.ownMarks = []; this.clock = 0; this.removed.clear();
    this.update({ ready: false, marks: [], files: [], message: '', phase: 'idle' });
    channel.addEventListener('message', this.receive); channel.addEventListener('close', this.onClose);
    this.trySend('hello');
    this.tick = setInterval(() => {
      if (!this.state.ready) this.trySend('hello');
      const now = Date.now();
      if (this.incoming && now - this.incoming.touched > 30000) this.cancelFile(this.incoming.id, 'failed');
      if (this.state.phase === 'recording') {
        if (now - this.lastPeer > 15000) this.stopRecording('Recording stopped because the other participant is no longer responding.');
        else this.trySend('record-live', { id: this.recordId });
      } else if (this.state.phase === 'peer-recording') {
        this.trySend('record-lease', { id: this.recordId });
        if (now - this.lastPeer > 15000) this.stopRecording('Recording connection lost.');
      } else if (this.state.phase !== 'idle' && now > this.deadline) this.stopRecording('Recording request expired.');
    }, 2000);
  }
  private onClose = () => this.disconnect();
  disconnect() {
    this.stopRecording('Session ended. Your recorded video is available to download.');
    if (this.tick) clearInterval(this.tick);
    this.channel?.removeEventListener('message', this.receive); this.channel?.removeEventListener('close', this.onClose);
    this.fileTimers.forEach(clearTimeout); this.fileTimers.clear();
    this.channel = null; this.outgoing.clear(); this.incoming = null; this.pumping.clear();
    this.update({ ready: false, files: this.state.files.map(f => ['offered', 'transferring'].includes(f.status) ? { ...f, status: 'failed' } : f) });
  }
  addMark(mark: BoardMark) {
    mark = { ...mark, order: ++this.clock };
    if (!this.state.ready) throw new Error('Wait for your colleague to connect.');
    if (!validMark(mark) || this.state.marks.length >= BOARD_LIMIT) throw new Error('The pad is full. Undo some of your marks or start a new session.');
    this.send('mark', { mark }); this.ownMarks.push(mark.id); this.update({ marks: this.sortMarks([...this.state.marks, mark]) });
  }
  private sortMarks(marks: BoardMark[]) { return marks.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id)); }
  undo() {
    const id = this.ownMarks.at(-1); if (!id || !this.state.ready) return;
    this.send('remove-mark', { id }); this.ownMarks.pop(); this.removed.add(id); this.update({ marks: this.state.marks.filter(m => m.id !== id) });
  }
  private filePatch(id: string, patch: Partial<SharedFile>) { this.update({ files: this.state.files.map(f => f.id === id ? { ...f, ...patch } : f) }); }
  offerFile(file: File) {
    if (!this.state.ready) throw new Error('Wait for your colleague to connect.');
    if (!file.size || file.size > MAX_FILE) throw new Error('Choose a non-empty file up to 20 MB.');
    if (this.state.files.filter(f => f.own).length >= 5) throw new Error('Up to five documents can be shared per person in a session.');
    if (this.outgoing.size) throw new Error('Finish or cancel your current document transfer first.');
    const id = crypto.randomUUID(); const name = safeFilename(file.name);
    this.send('file-offer', { id, name, size: file.size }); this.outgoing.set(id, file);
    this.update({ files: [...this.state.files, { id, name, size: file.size, own: true, progress: 0, status: 'offered' }] });
  }
  acceptFile(id: string) {
    const f = this.state.files.find(f => f.id === id && !f.own && f.status === 'offered'); if (!f) return;
    if (this.incoming) throw new Error('Finish the current download first.');
    this.send('file-accept', { id }); this.incoming = { id, size: f.size, chunks: [], received: 0, sequence: 0, touched: Date.now() };
    this.filePatch(id, { status: 'transferring' });
  }
  cancelFile(id: string, status: 'declined' | 'failed' = 'declined') {
    clearTimeout(this.fileTimers.get(id)); this.fileTimers.delete(id);
    this.trySend('file-cancel', { id }); this.outgoing.delete(id); if (this.incoming?.id === id) this.incoming = null;
    this.filePatch(id, { status });
  }
  private async pump(id: string) {
    const file = this.outgoing.get(id); const channel = this.channel;
    if (!file || !channel || this.pumping.has(id)) return;
    this.pumping.add(id); this.filePatch(id, { status: 'transferring' });
    try {
      let blocked = Date.now();
      for (let offset = 0, sequence = 0; offset < file.size; offset += CHUNK, sequence++) {
        while (channel.bufferedAmount > 64000) {
          if (this.channel !== channel || !this.outgoing.has(id) || channel.readyState !== 'open' || Date.now() - blocked > 30000) throw new Error('Transfer interrupted');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        blocked = Date.now();
        const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
        if (this.channel !== channel || !this.outgoing.has(id)) return;
        this.send('file-chunk', { id, sequence, data: btoa(String.fromCharCode(...bytes)) });
        this.filePatch(id, { progress: Math.min(99, Math.round((offset + bytes.length) / file.size * 100)) });
      }
      if (this.channel === channel && this.outgoing.has(id)) {
        this.send('file-end', { id });
        // Wait for receiver acknowledgement before displaying success.
        this.fileTimers.set(id, setTimeout(() => { if (this.channel === channel && this.outgoing.has(id)) this.cancelFile(id, 'failed'); }, 30000));
      }
    } catch { if (this.channel === channel) this.cancelFile(id, 'failed'); }
    finally { this.pumping.delete(id); }
  }
  requestRecording() {
    if (!this.state.ready || this.state.phase !== 'idle' || this.recorder) throw new Error('A recording request is already in progress.');
    if (this.state.recordings.length >= 3) throw new Error('Download and remove a saved recording before making another.');
    const id = crypto.randomUUID(); this.send('record-request', { id }); this.recordId = id;
    this.deadline = Date.now() + 30000; this.update({ phase: 'requesting', message: '' });
  }
  answerRecording(allow: boolean) {
    if (this.state.phase !== 'requested') return;
    if (!allow) { this.stopRecording('Recording declined.'); return; }
    this.send('record-allow', { id: this.recordId }); this.deadline = Date.now() + 30000; this.update({ phase: 'peer-approved' });
  }
  setInputs(inputs: RecordingInputs) { this.inputs = inputs; this.recorder?.update(inputs); }
  startRecording() {
    if (this.state.phase !== 'approved' || !this.inputs || Date.now() > this.deadline) throw new Error('Ask your colleague for recording permission first.');
    const id = this.recordId;
    const recorder = new LiveRecorder((blob, reason) => {
      if (this.recorder === recorder) this.recorder = null;
      if (this.recordId === id) { this.trySend('record-stop', { id }); this.recordId = ''; this.update({ phase: 'idle' }); }
      const name = `live-help-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      this.update({ recordings: blob.size ? [...this.state.recordings, { id, name, blob }] : this.state.recordings, message: blob.size ? reason : 'No video was captured.' });
    });
    try {
      this.send('record-start', { id }); this.recorder = recorder; recorder.start(this.inputs);
      this.lastPeer = Date.now(); this.update({ phase: 'recording' });
    } catch (e) { this.recorder = null; this.stopRecording('Recording could not start.'); throw e; }
  }
  stopRecording(reason = 'Recording stopped. Any captured video is available to download.') {
    if (this.state.phase === 'idle' && !this.recorder) return;
    this.trySend('record-stop', { id: this.recordId }); this.recordId = ''; this.recorder?.stop(reason);
    this.update({ phase: 'idle', message: reason });
  }
  removeRecording(id: string) { this.update({ recordings: this.state.recordings.filter(r => r.id !== id) }); }
  private receive = (event: MessageEvent) => {
    if (typeof event.data !== 'string' || event.data.length > 40000) return;
    try {
      const d = JSON.parse(event.data) as Wire;
      if (!d || d.workspace !== 1 || typeof d.type !== 'string') return;
      if (d.type === 'hello') { if (!this.state.ready) { this.trySend('hello'); this.update({ ready: true }); } return; }
      if (!this.state.ready) return;
      if (d.type === 'mark') {
        if (validMark(d.mark) && Number.isSafeInteger(d.mark.order) && this.state.marks.length < BOARD_LIMIT && !this.removed.has(d.mark.id) && !this.state.marks.some(m => m.id === (d.mark as BoardMark).id)) { this.clock = Math.max(this.clock, d.mark.order!); this.update({ marks: this.sortMarks([...this.state.marks, d.mark]) }); }
        return;
      }
      if (typeof d.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(d.id)) return;
      const id = d.id;
      if (d.type === 'remove-mark') {
        if (!this.ownMarks.includes(id) && this.removed.size < 2000) { this.removed.add(id); this.update({ marks: this.state.marks.filter(m => m.id !== id) }); } return;
      }
      if (d.type === 'file-offer') {
        if (typeof d.name !== 'string' || !Number.isInteger(d.size) || Number(d.size) < 1 || Number(d.size) > MAX_FILE || this.state.files.filter(f => !f.own).length >= 5 || this.state.files.some(f => f.id === id)) return;
        this.update({ files: [...this.state.files, { id, name: safeFilename(d.name), size: Number(d.size), own: false, progress: 0, status: 'offered' }] }); return;
      }
      if (d.type === 'file-accept') { void this.pump(id); return; }
      if (d.type === 'file-cancel') { this.outgoing.delete(id); if (this.incoming?.id === id) this.incoming = null; this.filePatch(id, { status: 'declined' }); return; }
      if (d.type === 'file-chunk') {
        const t = this.incoming; if (!t || t.id !== id) return;
        if (d.sequence !== t.sequence || typeof d.data !== 'string' || d.data.length > 16000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(d.data)) { this.cancelFile(id, 'failed'); return; }
        const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
        if (!bytes.length || bytes.length > CHUNK || t.received + bytes.length > t.size) { this.cancelFile(id, 'failed'); return; }
        t.chunks.push(bytes); t.received += bytes.length; t.sequence++; t.touched = Date.now();
        this.filePatch(id, { progress: Math.round(t.received / t.size * 100) }); return;
      }
      if (d.type === 'file-end') {
        const t = this.incoming; if (!t || t.id !== id) return;
        if (t.received !== t.size) { this.cancelFile(id, 'failed'); return; }
        this.filePatch(id, { blob: new Blob(t.chunks, { type: 'application/octet-stream' }), status: 'ready', progress: 100 });
        this.incoming = null; this.trySend('file-received', { id }); return;
      }
      if (d.type === 'file-received') { if (this.outgoing.has(id)) { clearTimeout(this.fileTimers.get(id)); this.fileTimers.delete(id); this.filePatch(id, { status: 'ready', progress: 100 }); this.outgoing.delete(id); } return; }
      if (d.type === 'record-request') {
        if (this.state.phase !== 'idle' || this.recorder) { this.trySend('record-stop', { id }); return; }
        this.recordId = id; this.deadline = Date.now() + 30000; this.update({ phase: 'requested' }); return;
      }
      if (id !== this.recordId) return;
      if (d.type === 'record-stop') { this.stopRecording('Recording stopped or declined by your colleague.'); return; }
      if (d.type === 'record-allow' && this.state.phase === 'requesting') { this.deadline = Date.now() + 30000; this.update({ phase: 'approved' }); }
      if (d.type === 'record-start' && this.state.phase === 'peer-approved' && Date.now() <= this.deadline) {
        this.lastPeer = Date.now(); this.update({ phase: 'peer-recording' }); this.trySend('record-lease', { id });
      }
      if (d.type === 'record-live' && this.state.phase === 'peer-recording') { this.lastPeer = Date.now(); this.trySend('record-lease', { id }); }
      if (d.type === 'record-lease' && this.state.phase === 'recording') this.lastPeer = Date.now();
    } catch { /* Invalid peer packets do not affect the active call. */ }
  };
}
