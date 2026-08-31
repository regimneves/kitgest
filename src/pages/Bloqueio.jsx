import { useOrg } from '../context/OrgContext'
import { useAuth } from '../context/AuthContext'

// WhatsApp do suporte (Softia). Ajuste se o número mudar.
const SUPORTE_WHATS = '5534984081020'

export default function Bloqueio() {
  const { org, motivo } = useOrg()
  const { sair, user } = useAuth()

  const vencido = motivo === 'vencido'
  const titulo = vencido ? 'Seu acesso venceu' : 'Acesso suspenso'
  const texto = vencido
    ? 'O período de uso do KitGest chegou ao fim. Seus dados estão guardados — para voltar a usar, é só renovar seu acesso com o suporte.'
    : 'Seu acesso está suspenso no momento. Fale com o suporte para regularizar e liberar novamente.'

  const msg = encodeURIComponent(
    `Olá! Sou ${org?.nome || 'cliente'} do KitGest (${user?.email || ''}) e quero regularizar meu acesso.`
  )
  const link = `https://wa.me/${SUPORTE_WHATS}?text=${msg}`

  return (
    <div className="centro">
      <div className="card stack" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <h1>{titulo}</h1>
        <div className="sub">{texto}</div>
        <a className="ouro mt" href={link} target="_blank" rel="noopener noreferrer"
           style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '12px', borderRadius: 10 }}>
          Falar com o suporte no WhatsApp
        </a>
        <button type="button" className="secundario mt" onClick={sair} style={{ width: '100%' }}>
          Sair
        </button>
      </div>
    </div>
  )
}
