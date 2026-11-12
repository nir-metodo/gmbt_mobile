import { PermissionsAndroid, Platform } from 'react-native';
import { phoneCallsApi } from '../api/phoneCalls';
import { useSipPhoneStore } from '../../stores/sipPhoneStore';

/**
 * The app's own phone: a SIP/WebRTC endpoint registered on the Gambot PBX (the same Asterisk gateway and the same per-user login
 * the web softphone uses). Two things run through it:
 *  - click-to-call: the app asks the backend to place the call; the gateway rings every registered endpoint of this user, the app
 *    auto-answers that leg (expectBridge) and the gateway dials the customer, bridges and records;
 *  - incoming calls: while the app is open the call rings here (IncomingCallOverlay) as well as in the browser.
 *
 * It needs the native WebRTC module (react-native-webrtc), i.e. an app build that includes it. In a build without it
 * isSupported() is false and every caller falls back to the "ring my phone first" bridge call.
 */

const BRIDGE_WINDOW_MS = 60_000;

let JsSIP: any = null;
let loadFailed = false;

function load(): boolean {
  if (JsSIP) return true;
  if (loadFailed) return false;
  try {
    const webrtc = require('react-native-webrtc');
    webrtc.registerGlobals();
    JsSIP = require('jssip');
    try { JsSIP.debug.disable('JsSIP:*'); } catch { /* quiet */ }
    return true;
  } catch (e) {
    loadFailed = true;
    return false;
  }
}

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS asks when the microphone is first opened
  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

class SipPhone {
  private ua: any = null;
  private session: any = null;
  private iceServers: any[] = [];
  private startedFor = '';
  private starting: Promise<boolean> | null = null;
  private bridgeUntil = 0;

  isSupported(): boolean {
    return load();
  }

  isRegistered(): boolean {
    return useSipPhoneStore.getState().registered;
  }

  /** Fetch this user's SIP login and register. Safe to call repeatedly (no-op when already running for that organization). */
  async start(organization: string): Promise<boolean> {
    if (!load()) return false;
    if (this.ua && this.startedFor === organization) return true;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        this.stop();
        const creds = await phoneCallsApi.getSipCredentials(organization);
        if (!creds?.success || !creds.wssUrl || !creds.domain || !creds.sipUser) return false;
        this.iceServers = creds.iceServers || [];
        const ua = new JsSIP.UA({
          sockets: [new JsSIP.WebSocketInterface(creds.wssUrl)],
          uri: `sip:${creds.sipUser}@${creds.domain}`,
          authorization_user: creds.sipUser,
          password: creds.sipPassword,
          register: true,
          // Re-register often: the REGISTER doubles as the keep-alive that stops the load balancer dropping an idle WSS.
          register_expires: 90,
          session_timers: false,
          user_agent: 'GambotApp',
        });
        ua.on('registered', () => useSipPhoneStore.getState().setRegistered(true));
        ua.on('unregistered', () => useSipPhoneStore.getState().setRegistered(false));
        ua.on('registrationFailed', () => useSipPhoneStore.getState().setRegistered(false));
        ua.on('disconnected', () => useSipPhoneStore.getState().setRegistered(false));
        ua.on('newRTCSession', (data: any) => {
          if (data.originator === 'remote') this.onRemoteSession(data.session, data.request);
        });
        this.ua = ua;
        this.startedFor = organization;
        ua.start();
        return true;
      } catch {
        return false;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  /** Unregister (removes this phone from the PBX so nothing rings a closed app) and drop the connection. */
  stop() {
    const ua = this.ua;
    this.ua = null;
    this.startedFor = '';
    this.session = null;
    const store = useSipPhoneStore.getState();
    store.setRegistered(false);
    store.setIncoming(null);
    store.setInCall(false);
    if (!ua) return;
    try { ua.unregister({ all: true }); } catch { /* ignore */ }
    setTimeout(() => { try { ua.stop(); } catch { /* ignore */ } }, 600);
  }

  /** Resolve true as soon as the phone is registered (false after the timeout). */
  waitRegistered(timeoutMs = 4000): Promise<boolean> {
    if (this.isRegistered()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const unsub = useSipPhoneStore.subscribe((s) => {
        if (s.registered) { clearTimeout(timer); unsub(); resolve(true); }
      });
      const timer = setTimeout(() => { unsub(); resolve(false); }, timeoutMs);
    });
  }

  /** The next INVITE from the gateway is the bridge leg of the call we just asked for: answer it without ringing. */
  expectBridge() {
    this.bridgeUntil = Date.now() + BRIDGE_WINDOW_MS;
  }

  cancelBridge() {
    this.bridgeUntil = 0;
  }

  private answerOptions() {
    return { mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: this.iceServers } };
  }

  private bind(session: any) {
    this.session = session;
    const store = useSipPhoneStore.getState();
    const done = () => {
      if (this.session === session) this.session = null;
      const s = useSipPhoneStore.getState();
      s.setIncoming(null);
      s.setInCall(false);
    };
    session.on('accepted', () => { store.setIncoming(null); store.setInCall(true); });
    session.on('confirmed', () => { store.setIncoming(null); store.setInCall(true); });
    session.on('ended', done);
    session.on('failed', done);
  }

  private async onRemoteSession(session: any, request: any) {
    const hdr = (name: string): string => { try { return request?.getHeader?.(name) || ''; } catch { return ''; } };
    const outLeg = !!hdr('X-Gambot-Out');
    const callId = hdr('X-Gambot-CallId');
    const from = session?.remote_identity?.uri?.user || '';
    const name = session?.remote_identity?.display_name || '';
    const decline = () => { try { session.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch { /* ignore */ } };

    // One call at a time in the app.
    if (this.session && this.session !== session) { decline(); return; }

    if (Date.now() < this.bridgeUntil) {
      // Our own click-to-call: answer silently, the gateway then dials the customer.
      this.bridgeUntil = 0;
      this.bind(session);
      if (!(await ensureMicPermission())) { decline(); return; }
      try { session.answer(this.answerOptions()); } catch { decline(); }
      return;
    }
    // A click-to-call leg that belongs to another of this user's devices (the browser, say): not ours to answer or ring.
    if (outLeg) { decline(); return; }

    // A real incoming call: ring in the app until the agent answers / declines (or it is answered elsewhere / hung up).
    this.bind(session);
    useSipPhoneStore.getState().setIncoming({ from, name, callId });
  }

  async answerIncoming(): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    if (!(await ensureMicPermission())) { this.rejectIncoming(); return false; }
    try { session.answer(this.answerOptions()); return true; } catch { return false; }
  }

  rejectIncoming() {
    const session = this.session;
    useSipPhoneStore.getState().setIncoming(null);
    if (!session) return;
    try { session.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); } catch { /* already ended */ }
  }

  hangup() {
    try { this.session?.terminate(); } catch { /* ignore */ }
  }
}

export const sipPhone = new SipPhone();
