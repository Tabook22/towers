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
media path without capturing a real desktop or microphone. A production relay/cross-network test
still requires the VPS relay to be installed and enabled.
