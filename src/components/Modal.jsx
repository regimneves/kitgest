// Modal simples reutilizável (fecha no backdrop e no botão ✕).
export default function Modal({ titulo, children, onFechar }) {
  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
        display: 'grid', placeItems: 'center', padding: 16, zIndex: 50
      }}
    >
      <div
        className="card"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ flex: 1, fontSize: '1.2rem' }}>{titulo}</h1>
          <button className="secundario" onClick={onFechar} aria-label="Fechar"
                  style={{ padding: '6px 12px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
