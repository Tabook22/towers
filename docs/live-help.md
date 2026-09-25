# Live Help

The headset button in the app header opens a private, two-person guidance session.
Filter by team or Administration, choose an individual, and send an invitation. Invitations
appear across the app while the recipient has it open; this is not a background telephone
notification service. The invitation expires after 90 seconds.

Acceptance connects the two people without opening any capture device. Each person explicitly
chooses Share screen, Camera, or Enable microphone. Browser permission is required. Phones
without `getDisplayMedia` can watch, chat, speak, and use their camera. Desktop screen sharing
requires HTTPS (localhost also works) and a supported browser. System audio is not captured.

The pointing tool sends a temporary marker to the sharer's preview within Live Help, not to the
underlying desktop. It does not control the other person's mouse. Minimize keeps the session
running and displays a persistent status/stop bar. Stop sharing releases the video device;
Mute releases the microphone. End session releases both. Navigating within the app preserves
the session; reloading or changing devices requires a new invitation.

## Access and privacy

- Active, approved internal staff with Messages access can call each other. Customer accounts
  cannot list contacts, join sessions, or obtain relay credentials.
- Only the two participants can read or publish connection messages. Signalling is unavailable
  until acceptance. Per-tab ownership and unique user reservations prevent duplicate sessions.
- The API stores short-lived invitations and WebRTC connection messages, not captured media or
  chat transcripts. Connection messages are removed on end/expiry; session metadata is removed
  after a day when the next live-help request runs. Session chat is in-memory over a WebRTC data
  channel, and clears on session exit. Recipients can still use their own recording software.
- Calls expire after 45 minutes, or when either participant stops polling for 75 seconds.
  The browser stops its media after a sustained signalling failure (~20–30 seconds).
- TURN credentials last one hour and are issued only to participants in an accepted session.
  Media transport is encrypted by WebRTC; TURN forwards packets without decoding media.

## VPS setup

Tables are additive, created through the existing `Base.metadata.create_all` startup path.
Back up the SQLite database before first deployment. Pre-create the tables with one backend
process before restarting a multi-worker service. Frontend needs no new npm dependencies.

Reliable connections across mobile/carrier networks need a TURN relay. With no relay configured,
the UI reports that limitation and can only attempt a direct connection.

On this project's Ubuntu VPS, after deploying the backend, run as root:

```sh
bash scripts/setup-live-help-relay.sh skygreenline-lab.io 77.37.45.106
```

This installs distro coturn, preserves existing unrelated relay configurations by refusing to
overwrite them, sets a generated shared secret in backend/.env and root-owned TURN config,
copies the domain's TLS certificate for coturn, installs a renewal hook, and opens only TURN
3478 UDP/TCP, 5349 TCP TLS, and UDP relay range 49160–49200. It denies private/multicast peers,
disables the management CLI and TCP relay allocations, and caps user/global allocations and
bandwidth. Encrypted TURN over TCP remains available; disabling TCP relay allocations does
not disable client-to-TURN TCP connections. Provider-level firewall rules must also permit
these ports. Networks permitting only port 443 may still block this relay; use another network
in that case. No external meeting service or account is required.

For other deployments configure `LIVE_TURN_URLS` (a JSON array) and `LIVE_TURN_SECRET` in the
backend environment. Never put the shared secret in a Vite/frontend variable. Do not deploy an
anonymous TURN relay. Remove relay firewall allowances and disable coturn if retiring it.

## Verification

Run `pytest tests/test_live_help.py` for consent, participant isolation, tab ownership,
busy reservations, expiry, signal replay, and credential tests. Run frontend build/tests.
Use two separate browser profiles/accounts to check an actual call; logging two different
users into tabs of the same origin changes the shared localStorage login.

Check invite/decline/accept, private chat both directions, browser capture cancellation,
screen/camera/microphone start and stop, minimized status, fullscreen, pointing, hangup,
and loss of connection. Also test across two different networks to exercise the relay.
Use test accounts and a non-sensitive window; never automatically capture an operator's
desktop or microphone during deployment verification.

Local QA on 25 September 2026 verified two independent Chrome logins, invitation acceptance,
bidirectional private chat, navigation while minimized, remote hangup, and mobile picker layout.
A separate local-only harness substituted a generated canvas video and silent audio for device
capture and verified decoded video frames and received audio samples in both directions, including
sharing by the invited participant, then stopping capture and ending the call. This verifies the
media path without capturing a real desktop or microphone. The VPS relay was deployed on 25 September 2026; authenticated UDP, TCP and TLS packet
relay tests passed, and external connectivity and TLS certificate validation were verified.
Actual field-device calls across mobile networks still need a practical check.


## Shared workspace and recording

Both participants must refresh to load the workspace update. Once the encrypted data channel
connects, the tools handshake enables the pad, documents and recording controls. Older clients
can still call but cannot use the new workspace until refreshed.

- The drawing pad supports mouse, pen and touch, five ink colors, three widths, English/Arabic
  text labels, undo of your own marks, zoom and PNG export. Strokes synchronize on pointer release.
  Marks have a deterministic order for simultaneous drawing and bounded sizes/counts.
- Documents use a recipient Accept/Decline flow, ordered 12 KB chunks, sequence/length validation,
  acknowledgement, progress, cancellation and backpressure. Each person can offer five files up
  to 20 MB each per call. Files remain in browser memory and are downloaded only on request;
  active HTML/SVG/documents are never rendered inline or uploaded to the backend.
- Recording requires a request, explicit agreement and a separate Start recording click.
  Both participants see a red indicator and can stop, including from the minimized call bar.
  Consent expires if not used, cannot carry across sessions and is revoked on disconnection.
  Recorder/participant heartbeats stop the recording on loss of the peer.
- The recorder composites the two already-shared video streams plus the pad at 1280×960/10 fps,
  and mixes enabled microphones. It never requests another device or records the whole desktop.
  Private chat and document contents are excluded unless visible in a shared screen.
- Videos remain on the recording participant's device, with a Download video action that survives
  ending the call. Save before closing/refreshing; a browser exit warning protects unsaved files.
  They are not archived on the VPS. A capture stops at 20 minutes or 150 MB; three saved captures
  can be held before downloading/removing one. Either person can record once permission is given.
- Keep the recording tab visible. Browser background suspension, screen locking and memory limits
  can interrupt canvas recording, particularly on mobile. Unsupported recording browsers can still
  participate in calls, use the pad, receive files and approve another participant's recording.

Workspace QA: automated tests exercise concurrent drawing/undo, malicious or oversized inputs,
acceptance before file bytes, exact multi-chunk delivery, out-of-order rejection, interrupted transfers,
recording consent/revocation and simultaneous requests. Local Chrome testing used actual WebRTC
data channels with synthetic video/audio, verified a bilingual pad and drawn stroke on both sides,
exact transferred document bytes, peer-controlled recording stop and playable 1280×960 video.
