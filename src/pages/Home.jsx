import { Link } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'

// Painel inicial: atalhos para as telas operacionais do dia a dia.
export default function Home() {
  const { org } = useOrg()
  const brandingIncompleto = !org?.pix_chave

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1>Olá, {org?.nome || 'operador'} 👋</h1>
      <p className="sub">Escolha por onde começar. Fluxo: cadastre a estrutura, vincule inquilinos por contrato e registre os recebimentos.</p>

      {brandingIncompleto && (
        <div className="card" style={{ borderColor: 'var(--cor-ouro)' }}>
          <strong>Finalize a configuração</strong>
          <p className="sub">Falta cadastrar sua chave PIX (e cor/logo) para emitir cobranças e recibos.</p>
          <Link to="/config"><button className="ouro">Ir para Configuração</button></Link>
        </div>
      )}

      <div className="linha mt" style={{ flexWrap: 'wrap' }}>
        <Link to="/casas" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Casas &amp; Quartos</strong><p className="sub">gerenciar estrutura →</p>
        </Link>
        <Link to="/inquilinos" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Inquilinos</strong><p className="sub">cadastro de pessoas →</p>
        </Link>
        <Link to="/contratos" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Contratos</strong><p className="sub">inquilino × quarto →</p>
        </Link>
        <Link to="/recebimentos" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Recebimentos</strong><p className="sub">aluguel · recibo · PIX →</p>
        </Link>
        <Link to="/cobranca" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Cobrança</strong><p className="sub">quem deve · WhatsApp →</p>
        </Link>
        <Link to="/vistorias" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Vistoria</strong><p className="sub">checklist · foto · laudo →</p>
        </Link>
        <Link to="/acertos" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Acerto de saída</strong><p className="sub">caução · descontos · recibo →</p>
        </Link>
        <Link to="/manutencao" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Manutenção</strong><p className="sub">ordens de reparo →</p>
        </Link>
        <Link to="/relatorios" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Relatórios</strong><p className="sub">rent roll · margem · inadimplência →</p>
        </Link>
      </div>
    </div>
  )
}
