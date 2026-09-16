import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, CheckCircle2, Copy, LoaderCircle, RefreshCw, Smartphone, Wifi, X } from 'lucide-react'
import { api } from './api'

type Session = { active: boolean; id: string; peer: string; url: string; expires_at: number; connected: boolean; host: string; networks: { host: string; name: string }[] }

export function PhoneDialog({ frame, close }: { frame: { peer_id: string; name: string }; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), linkInput = useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<Session | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [copied, setCopied] = useState(false), [now, setNow] = useState(Date.now()), [network, setNetwork] = useState(false)
  const create = async (renew = false, host = '') => { setBusy(true); setError(''); try { setSession(await api<Session>(`/frames/${frame.peer_id}/phone`, { renew, host })) } catch (e) { setError(e instanceof Error ? e.message : 'Could not create a phone link.') } finally { setBusy(false) } }
  useEffect(() => { dialog.current?.showModal(); void create(); let active = true
    const timer = setInterval(() => { setNow(Date.now()); api<Session>('/phone').then(s => { if (active) setSession(s.active && s.peer === frame.peer_id ? s : null) }).catch(() => {}) }, 1500)
    return () => { active = false; clearInterval(timer); dialog.current?.close() }
  }, [])
  const remaining = session ? Math.min(900, Math.max(0, Math.ceil((session.expires_at - now) / 1000))) : 0
  const copy = async () => { if (!session) return; try { await navigator.clipboard.writeText(session.url); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { linkInput.current?.focus(); linkInput.current?.select(); setError('The link is selected below. Copy it to share with your phone.') } }
  const end = async () => { try { await api('/phone', {}, 'DELETE'); close() } catch (e) { setError(e instanceof Error ? e.message : 'Could not end the session.') } }
  return <dialog ref={dialog} className="modal phone-dialog" aria-label="Add photos from your phone" onCancel={e => { e.preventDefault(); close() }} onClick={e => { if (e.target === dialog.current) close() }}>
    <div className="modal-heading"><h2>Add photos from your phone</h2><button className="icon-button" aria-label="Close phone dialog" onClick={close}><X size={20}/></button></div>
    <p className="muted">Straight from your camera roll to <strong>{frame.name}</strong>.</p>
    <div className="qr-stage">{busy ? <LoaderCircle className="spin" size={28}/> : session && remaining > 0 ? <QRCodeSVG value={session.url} size={224} marginSize={2} level="M" title="Scan to send photos from your phone"/> : <div className="qr-expired"><Smartphone size={32}/><strong>Your phone link is closed</strong><button className="text-button" onClick={() => create(true)}><RefreshCw size={14}/> Create a new link</button></div>}</div>
    {session && remaining > 0 && <div className={`phone-connected ${session.connected ? 'ready' : ''}`}>{session.connected ? <CheckCircle2 size={16}/> : <span className="status-dot"/>}{session.connected ? 'Phone connected — ready for photos' : 'Ready for your phone'}<span>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span></div>}
    <ol className="phone-steps"><li><span>1</span><div><strong>Open your phone’s camera</strong><small>Scan the code and tap the link.</small></div></li><li><span>2</span><div><strong>Pick a few moments</strong><small>Choose photos, add a caption, and send.</small></div></li><li><span>3</span><div><strong>Let them find their way home</strong><small>We’ll confirm when they arrive on the frame.</small></div></li></ol>
    <p className="phone-wifi"><Wifi size={15}/> Keep your phone and computer on the same Wi-Fi.</p>
    {session && <div className="phone-link"><input ref={linkInput} aria-label="Phone upload link" value={session.url} readOnly onFocus={e => e.target.select()}/><button className="icon-button" aria-label="Copy phone link" onClick={copy}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div>}
    {error && <p className="error-inline" role="alert">{error}</p>}
    <button className="text-button network-toggle" onClick={() => setNetwork(!network)}>Having trouble connecting?</button>
    {network && <div className="network-help"><p>Keep the desktop app running. Guest Wi-Fi, a VPN or a firewall may block the connection.</p>{session && session.networks.length > 1 && <label>Computer network<select value={session.host} onChange={e => create(true, e.target.value)}>{session.networks.map(n => <option value={n.host} key={`${n.name}:${n.host}`}>{n.name} · {n.host}</option>)}</select></label>}</div>}
    <div className="modal-footer"><button className="text-button" onClick={end}>End phone session</button><span className="quiet">You can close this dialog and keep receiving.</span></div>
  </dialog>
}
