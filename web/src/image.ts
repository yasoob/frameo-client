// Canvas processing works on an ordinary local HTTP page as well as localhost.
// Image decoding falls back for Safari versions without createImageBitmap.
export async function prepare(file: File, frame: { width: number; height: number }): Promise<Blob> {
  if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} is larger than 100 MB.`)
  let source: ImageBitmap | HTMLImageElement | undefined
  let url = ''
  try {
    try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
    catch {
      url = URL.createObjectURL(file)
      source = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Cannot open ${file.name}. Try a JPEG, PNG or WebP photo.`)); img.src = url })
    }
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    const scale = Math.min(1, Math.max((frame.width || 1280) / width, (frame.height || 800) / height))
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
    if (canvas.width * canvas.height > 50_000_000) throw new Error('This image is too large to prepare.')
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable in this browser.')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    // Safari may return PNG when WebP encoding is unavailable. That's fine:
    // the Go receiver converts PNG/JPEG to WebP without any external runtime.
    const encode = (type: string, quality?: number) => new Promise<Blob | null>(resolve => {
      try { canvas.toBlob(resolve, type, quality) } catch { resolve(null) }
    })
    let blob = await encode('image/webp', .85)
    if (!blob) blob = await encode('image/jpeg', .9)
    if (!blob || !['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) throw new Error('We couldn’t prepare this photo. Try selecting it again.')
    if (blob.size > 32 * 1024 * 1024) throw new Error('Prepared image exceeds 32 MB. Try a smaller photo.')
    return blob
  } finally { if (source && 'close' in source) source.close(); if (url) URL.revokeObjectURL(url) }
}

export function preparedName(file: File, blob: Blob): string {
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp'
  return file.name.replace(/\.[^.]+$/, '') + '.' + extension
}
