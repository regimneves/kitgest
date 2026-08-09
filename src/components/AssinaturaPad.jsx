import { useRef, useEffect, useState } from 'react'

// Pad de assinatura (dedo/mouse). Expõe onChange(dataURL|null) quando muda.
// O pai decide quando fazer upload (no salvar).
export default function AssinaturaPad({ valorInicial, onChange }) {
  const canvasRef = useRef(null)
  const desenhando = useRef(false)
  const [temTraco, setTemTraco] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // resolução física (nítida em telas retina)
    const escala = window.devicePixelRatio || 1
    const larguraCss = canvas.clientWidth
    const alturaCss = 160
    canvas.width = larguraCss * escala
    canvas.height = alturaCss * escala
    const ctx = canvas.getContext('2d')
    ctx.scale(escala, escala)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, larguraCss, alturaCss)
    if (valorInicial) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, larguraCss, alturaCss)
      img.src = valorInicial
      setTemTraco(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function ponto(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const t = e.touches?.[0]
    const cx = (t ? t.clientX : e.clientX) - rect.left
    const cy = (t ? t.clientY : e.clientY) - rect.top
    return { cx, cy }
  }

  function inicio(e) {
    e.preventDefault()
    desenhando.current = true
    const ctx = canvasRef.current.getContext('2d')
    const { cx, cy } = ponto(e)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
  }
  function mover(e) {
    if (!desenhando.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { cx, cy } = ponto(e)
    ctx.lineTo(cx, cy)
    ctx.stroke()
    if (!temTraco) setTemTraco(true)
  }
  function fim() {
    if (!desenhando.current) return
    desenhando.current = false
    onChange?.(canvasRef.current.toDataURL('image/png'))
  }

  function limpar() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.clientWidth, 160)
    setTemTraco(false)
    onChange?.(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 160, border: '1px solid var(--borda)', borderRadius: 8, touchAction: 'none', background: '#fff' }}
        onMouseDown={inicio} onMouseMove={mover} onMouseUp={fim} onMouseLeave={fim}
        onTouchStart={inicio} onTouchMove={mover} onTouchEnd={fim}
      />
      <div className="linha" style={{ marginTop: 6 }}>
        <span className="sub" style={{ flex: 1 }}>{temTraco ? 'Assinado.' : 'Assine no quadro acima.'}</span>
        <button type="button" className="secundario" onClick={limpar}>Limpar</button>
      </div>
    </div>
  )
}
