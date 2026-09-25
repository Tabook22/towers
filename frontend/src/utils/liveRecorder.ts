import { paintBoard, type BoardMark } from './liveBoard';

export interface RecordingInputs { local: MediaStream | null; localAudio: MediaStream | null; remote: MediaStream | null; localVisible: boolean; remoteVisible: boolean; mic: boolean; remoteMic: boolean; marks: BoardMark[]; peer: string }
export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && typeof AudioContext !== 'undefined';

/** Records only streams already shared in this call; never requests a capture device. */
export class LiveRecorder {
  private recorder: MediaRecorder | null = null;
  private capture: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private silence: OscillatorNode | null = null;
  private sources: MediaStreamAudioSourceNode[] = [];
  private local = document.createElement('video');
  private remote = document.createElement('video');
  private canvas = document.createElement('canvas');
  private timer?: ReturnType<typeof setInterval>;
  private chunks: Blob[] = [];
  private size = 0;
  private started = 0;
  private inputs: RecordingInputs | null = null;
  private done: (blob: Blob, reason: string) => void;
  private reason = 'Recording saved';
  constructor(done: (blob: Blob, reason: string) => void) { this.done = done; }
  start(inputs: RecordingInputs) {
    if (!recordingSupported()) throw new Error('Recording is unavailable in this browser. Try Chrome or Edge on a computer.');
    try {
      this.canvas.width = 1280; this.canvas.height = 960;
      this.audio = new AudioContext(); void this.audio.resume();
      this.destination = this.audio.createMediaStreamDestination();
      // Keep the audio clock advancing even in a pad-only session with both microphones off.
      // Otherwise some browsers wait indefinitely for the first audio packet when finalizing.
      this.silence = this.audio.createOscillator();
      const silentGain = this.audio.createGain(); silentGain.gain.value = 0;
      this.silence.connect(silentGain); silentGain.connect(this.destination); this.silence.start();
      this.local.muted = true; this.remote.muted = true; this.local.playsInline = true; this.remote.playsInline = true;
      this.update(inputs); this.paint();
      const stream = this.canvas.captureStream(10); this.capture = stream; stream.addTrack(this.destination.stream.getAudioTracks()[0]);
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1800000 });
      this.recorder.ondataavailable = e => {
        if (e.data.size) { this.chunks.push(e.data); this.size += e.data.size; }
        if (this.size >= 150 * 1024 * 1024) this.stop('Recording stopped at the 150 MB limit');
      };
      this.recorder.onerror = () => this.stop('Recording stopped because the browser reported an error; any captured video is available below');
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'video/webm' }); this.chunks = [];
        this.release(); this.done(blob, this.reason);
      };
      this.started = Date.now(); this.recorder.start(1000);
      this.timer = setInterval(() => { this.paint(); if (Date.now() - this.started >= 20 * 60 * 1000) this.stop('Recording stopped at the 20 minute limit'); }, 100);
    } catch (e) { this.release(); throw e; }
  }
  update(inputs: RecordingInputs) {
    const old = this.inputs; this.inputs = inputs;
    for (const [video, stream] of [[this.local, inputs.local], [this.remote, inputs.remote]] as const) {
      if (video.srcObject !== stream) { video.srcObject = stream; if (stream) void video.play().catch(() => undefined); }
    }
    if (this.audio && this.destination && (!old || old.localAudio !== inputs.localAudio || old.remote !== inputs.remote || old.mic !== inputs.mic || old.remoteMic !== inputs.remoteMic)) {
      this.sources.forEach(s => s.disconnect()); this.sources = [];
      for (const [stream, enabled] of [[inputs.localAudio, inputs.mic], [inputs.remote, inputs.remoteMic]] as const) {
        if (enabled && stream?.getAudioTracks().some(t => t.readyState === 'live')) {
          const source = this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
          source.connect(this.destination); this.sources.push(source);
        }
      }
    }
  }
  private paint() {
    const ctx = this.canvas.getContext('2d'); const i = this.inputs; if (!ctx || !i) return;
    ctx.fillStyle = '#102d38'; ctx.fillRect(0, 0, 1280, 960);
    ctx.fillStyle = 'white'; ctx.font = 'bold 24px Arial'; ctx.fillText('Live Help · shared session', 24, 36);
    ctx.font = '16px Arial'; ctx.fillText(new Date().toLocaleString(), 900, 36);
    const tile = (v: HTMLVideoElement, visible: boolean, x: number, name: string) => {
      ctx.fillStyle = '#183f4c'; ctx.fillRect(x + 8, 60, 624, 360);
      if (visible && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(624 / v.videoWidth, 326 / v.videoHeight); const w = v.videoWidth * scale, h = v.videoHeight * scale;
        ctx.drawImage(v, x + 8 + (624 - w) / 2, 60 + (326 - h) / 2, w, h);
      }
      ctx.fillStyle = '#e2f4ef'; ctx.font = '18px Arial'; ctx.fillText(`${name} · ${visible ? 'shared view' : 'video off'}`, x + 24, 405, 590);
    };
    tile(this.local, i.localVisible, 0, 'You'); tile(this.remote, i.remoteVisible, 640, i.peer);
    ctx.fillStyle = 'white'; ctx.font = 'bold 20px Arial'; ctx.fillText('Shared drawing pad', 24, 451);
    ctx.save(); ctx.translate(194, 472); paintBoard(ctx, i.marks, 892, 470); ctx.restore();
  }
  stop(reason = 'Recording saved') {
    this.reason = reason;
    if (this.timer) clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
  private release() {
    if (this.timer) clearInterval(this.timer);
    this.sources.forEach(s => s.disconnect()); this.sources = [];
    this.silence?.stop(); this.silence?.disconnect(); this.silence = null;
    this.capture?.getTracks().forEach(t => t.stop()); this.capture = null;
    if (this.audio) void this.audio.close().catch(() => undefined);
    this.local.srcObject = null; this.remote.srcObject = null; this.audio = null; this.destination = null;
  }
}
