import { useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, ChevronRight, ImagePlus, Images, LoaderCircle, Monitor, Plus, Smartphone, Upload, Wifi, X } from 'lucide-react'
import { prepare, preparedName } from './image'

type Target = { name: string; placement: string; width: number; height: number; expires_at: number }
type UploadJob = { id: string; state: string; progress: number; error?: string; message?: string }
type Photo = { key: string; uploadID: string; file: File; url: string; state: 'waiting' | 'preparing' | 'sending' | 'forwarding' | 'done' | 'failed'; progress: number; error?: string }
function randomID() { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') }
function loadToken() {
  const fromURL = new URLSearchParams(location.hash.slice(1)).get('t') || ''
  if (fromURL) { try { sessionStorage.setItem('phone-token', fromURL) } catch { /* token remains in memory */ }; history.replaceState(null, '', '/phone'); return fromURL }
  try { return sessionStorage.getItem('phone-token') || '' } catch { return '' }
}
class PhoneError extends Error { constructor(message: string, public status: number) { super(message) } }

export function PhonePage() {
  const [token] = useState(loadToken), [target, setTarget] = useState<Target | null>(null), [loading, setLoading] = useState(true), [connectionError, setConnectionError] = useState(''), [expired, setExpired] = useState(false)
  const [photos, setPhotos] = useState<Photo[]>([]), [caption, setCaption] = useState(''), [fit, setFit] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null), photoRef = useRef(photos), alive = useRef(true), xhrRef = useRef<XMLHttpRequest | null>(null)
  useEffect(() => { photoRef.current = photos }, [photos])
  useEffect(() => () => { alive.current = false; xhrRef.current?.abort(); photoRef.current.forEach(p => URL.revokeObjectURL(p.url)) }, [])
  const call = async <T,>(path: string): Promise<T> => { const response = await fetch(`/phone-api${path}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const text = await response.text(); if (response.status === 410 || response.status === 401) setExpired(true); throw new PhoneError(text, response.status) }; return response.json() }
  const connect = async () => { setLoading(true); setConnectionError(''); if (!token) { setConnectionError('Open “From phone” on your computer and scan the QR code to get started.'); setLoading(false); return }; try { setTarget(await call<Target>('/session')) } catch (e) { setConnectionError(e instanceof PhoneError ? e.message : 'We couldn’t reach your computer. Check your Wi-Fi and make sure Frameo Local is still open.') } finally { setLoading(false) } }
  useEffect(() => { void connect() }, [])
  useEffect(() => { if (!target) return; const timer = setInterval(() => { if (Date.now() >= target.expires_at) setExpired(true) }, 1000); return () => clearInterval(timer) }, [target])
  const update = (key: string, patch: Partial<Photo>) => { if (alive.current) setPhotos(all => all.map(p => p.key === key ? { ...p, ...patch } : p)) }
  const choose = (files: FileList | null) => { if (!files) return; const added = Array.from(files).map(file => ({ key: randomID(), uploadID: randomID(), file, url: URL.createObjectURL(file), state: 'waiting' as const, progress: 0 })); setPhotos(old => { const kept = added.slice(0, Math.max(0, 100 - old.length)); added.slice(kept.length).forEach(p => URL.revokeObjectURL(p.url)); return [...old, ...kept] }); setMessage('') }
  const remove = (key: string) => setPhotos(old => { const p = old.find(p => p.key === key); if (p) URL.revokeObjectURL(p.url); return old.filter(p => p.key !== key) })
  const post = (photo: Photo, data: Blob) => new Promise<UploadJob>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhrRef.current = xhr; xhr.open('POST', '/phone-api/upload'); xhr.timeout = 90000
    xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.setRequestHeader('X-Upload-ID', photo.uploadID)
    xhr.upload.onprogress = e => { if (e.lengthComputable) update(photo.key, { progress: .1 + .4 * e.loaded / e.total }) }
    xhr.onerror = () => reject(new Error('Connection interrupted. Check your Wi-Fi, then retry.'))
    xhr.ontimeout = () => reject(new Error('The connection took too long. You can retry this photo.'))
    xhr.onabort = () => reject(new Error('Transfer stopped.'))
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)) } catch { reject(new Error('Unexpected response from your computer.')) } } else { let msg = xhr.responseText; try { msg = JSON.parse(msg).error || msg } catch { /* plain error */ }; if (xhr.status === 410 || xhr.status === 401) setExpired(true); reject(new PhoneError(msg, xhr.status)) } }
    const form = new FormData(); form.append('photo', data, preparedName(photo.file, data)); form.append('caption', caption); form.append('fit', String(fit)); form.append('captured', String(photo.file.lastModified)); xhr.send(form)
  })
  const send = async () => { if (!target) return; setBusy(true); setMessage(''); const pending = photos.filter(p => p.state !== 'done')
    try { for (const [index, photo] of pending.entries()) {
      if (!alive.current) return
      setMessage(`Sending ${index + 1} of ${pending.length}`)
      try { update(photo.key, { state: 'preparing', progress: .04, error: '' }); const blob = await prepare(photo.file, target); if (!alive.current) return
        update(photo.key, { state: 'sending', progress: .1 }); const job = await post(photo, blob); update(photo.key, { state: 'forwarding', progress: .5 })
        const deadline = Date.now() + 240000
        while (alive.current) { const jobs = await call<UploadJob[]>('/jobs'); const current = jobs.find(j => j.id === job.id)
          if (current?.state === 'succeeded') { update(photo.key, { state: 'done', progress: 1 }); break }
          if (current && current.state !== 'running') { update(photo.key, { uploadID: randomID() }); throw new Error(current.error || 'The transfer was cancelled on your computer.') }
          if (Date.now() > deadline) throw new Error('Still waiting for the frame. Check the desktop app before sending again.')
          update(photo.key, { progress: .5 + .49 * (current?.progress || 0) }); await new Promise(r => setTimeout(r, 850))
        }
      } catch (e) { update(photo.key, { state: 'failed', error: e instanceof Error ? e.message : 'Could not send this photo.' }); setMessage('A photo needs another try. Your completed photos won’t be sent again.'); break }
    } } finally { if (alive.current) setBusy(false) }
  }
  const sent = photos.filter(p => p.state === 'done').length, allDone = photos.length > 0 && sent === photos.length
  const more = () => { photos.forEach(p => URL.revokeObjectURL(p.url)); setPhotos([]); setCaption(''); setMessage(''); input.current?.click() }
  return <div className="phone-app"><header className="phone-page-header"><span className="brand-icon"><Images size={20}/></span><strong>frameo <span>local</span></strong><span className="phone-local-tag"><Wifi size={13}/> Local transfer</span></header>
    <main className="phone-main">
      {loading ? <section className="phone-empty"><LoaderCircle className="spin" size={32}/><h1>Finding your computer…</h1></section> : connectionError || expired ? <section className="phone-empty"><Smartphone size={40}/><h1>{expired ? 'Let’s reconnect' : 'One little connection'}</h1><p>{expired ? 'This phone link has ended. Open “From phone” on your computer for a new QR code. Photos already accepted will keep transferring.' : connectionError}</p>{token && !expired && <button className="primary" onClick={connect}>Try again</button>}</section> : target && <>
        <div className="phone-destination"><span className="device-icon"><Monitor size={22}/></span><span><small>SENDING TO</small><strong>{target.name}</strong><em>{target.placement || 'Your photo frame'}</em></span><CheckCircle2 size={18}/></div>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { choose(e.target.files); e.target.value = '' }}/>
        {allDone ? <section className="phone-done"><span><CheckCircle2 size={52}/></span><h1>They’re on the frame.</h1><p>{sent} {sent === 1 ? 'photo has' : 'photos have'} arrived on {target.name}.<br/>A little closer to home.</p><button className="primary" onClick={more}><Plus size={18}/> Send more photos</button><small>You can close this page when you’re finished.</small></section> : <>
          <div className="phone-intro"><span className="eyebrow">FROM YOUR CAMERA ROLL</span><h1>A few moments.<br/>A lot of meaning.</h1><p>Pick the photos you’d love to see on the frame.</p></div>
          {!photos.length ? <button className="phone-pick" onClick={() => input.current?.click()}><span><ImagePlus size={34}/></span><strong>Choose photos</strong><small>Open your photo library</small><ChevronRight size={18}/></button> : <>
            <div className="phone-selection-heading"><strong>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</strong><button className="text-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={15}/> Add more</button></div>
            <div className="phone-photo-grid">{photos.map(photo => <div className={`phone-photo ${photo.state}`} key={photo.key}><img src={photo.url} alt={photo.file.name} loading="lazy" decoding="async"/>{!busy && photo.state !== 'done' && <button className="phone-remove" aria-label={`Remove ${photo.file.name}`} onClick={() => remove(photo.key)}><X size={14}/></button>}{photo.state === 'done' && <span className="phone-check"><Check size={15}/></span>}{!['waiting', 'done', 'failed'].includes(photo.state) && <div className="phone-photo-progress"><LoaderCircle size={20} className="spin"/><span>{photo.state === 'preparing' ? 'Preparing' : photo.state === 'sending' ? 'To computer' : 'To frame'}</span><progress max={1} value={photo.progress}/></div>}{photo.state === 'failed' && <span className="phone-failed-tag">Try again</span>}</div>)}</div>
            {photos.filter(p => p.error).map(p => <p className="error-inline" role="alert" key={p.key}>{p.file.name}: {p.error}</p>)}
            <label className="phone-field">A little caption <span>optional</span><textarea rows={2} placeholder="The story behind these moments…" value={caption} maxLength={500} disabled={busy} onChange={e => setCaption(e.target.value)}/></label>
            <label className="check-row phone-fit"><input type="checkbox" checked={fit} disabled={busy} onChange={e => setFit(e.target.checked)}/><span>Show the whole photo<small>No centered crop. Every part of the moment.</small></span></label>
            <button className="primary phone-send" disabled={busy} onClick={send}>{busy ? <LoaderCircle size={18} className="spin"/> : <Upload size={18}/>} {busy ? message : photos.some(p => p.state === 'failed') ? 'Retry remaining photos' : `Send ${photos.length - sent} ${photos.length - sent === 1 ? 'photo' : 'photos'}`}</button>
            <p className="phone-send-note" role="status">{busy ? 'Keep this page open until your photos arrive.' : message || 'Your computer will pass them straight to the frame.'}</p>
          </>}
          <div className="phone-path"><Smartphone size={17}/><span>Phone</span><ChevronRight size={13}/><Monitor size={17}/><span>Computer</span><ChevronRight size={13}/><Images size={17}/><span>Frame</span></div>
        </>}
      </>}
    </main><footer className="phone-page-footer">Same Wi-Fi. No account. Just your moments.<br/><span>Keep Frameo Local running on your computer.</span></footer>
  </div>
}
