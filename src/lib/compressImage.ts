/**
 * 이미지를 클라이언트에서 리사이즈 & 압축하여 base64 반환 (legacy API)
 */
export function compressImage(file: File, maxWidth = 1200, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width
        let h = img.height
        // 긴 변 기준 클램프 — 세로로 긴 스크린샷(예: 900x9000)이 폭만 검사하면
        // 무축소로 통과해 업로드가 비대해짐 (2026-07-10 전수점검 C14)
        const longSide = Math.max(w, h)
        if (longSide > maxWidth) {
          const scale = maxWidth / longSide
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        if (w < 1) w = 1
        if (h < 1) h = 1
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported')); return }
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve(dataUrl)
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * 이미지를 클라이언트에서 리사이즈 & 압축하여 Blob 반환.
 * fetch(dataUrl) 우회 (CSP connect-src 'self' 환경에서 data: URI fetch 차단되는 이슈 회피).
 */
export function compressImageToBlob(file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width
        let h = img.height
        // 긴 변 기준 클램프 — 세로로 긴 스크린샷(예: 900x9000)이 폭만 검사하면
        // 무축소로 통과해 업로드가 비대해짐 (2026-07-10 전수점검 C14)
        const longSide = Math.max(w, h)
        if (longSide > maxWidth) {
          const scale = maxWidth / longSide
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        if (w < 1) w = 1
        if (h < 1) h = 1
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas not supported')); return }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
          'image/jpeg',
          quality,
        )
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}
