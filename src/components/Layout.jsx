import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { useOnline } from '../lib/useOnline'

// Shell básico do app. Nas próximas fases: celular = bottom nav operacional,
// PC = sidebar de retaguarda. Aqui fica o topo comum + navegação mínima.
export default function Layout() {
  const { sair, user } = useAuth()
  const { org } = useOrg()
  const online = useOnline()

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        background: 'var(--cor-primaria)', color: '#fff'
      }}>
        {org?.logo_url
          ? <img src={org.logo_url} alt="logo" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
          : <span style={{ fontWeight: 700, color: 'var(--cor-ouro)' }}>KG</span>}
        <strong style={{ flex: 1 }}>{org?.nome || 'KitGest'}</strong>
        <button className="secundario" onClick={sair} title={user?.email}>Sair</button>
      </header>

      {!online && (
        <div style={{
          background: '#f97316', color: '#fff', padding: '8px 16px',
          fontSize: '.85rem', textAlign: 'center'
        }}>
          📴 Sem conexão — você pode continuar; suas alterações são enviadas ao servidor assim que a internet voltar.
        </div>
      )}

      <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '10px 16px', borderBottom: '1px solid var(--borda)' }}>
        <NavLink to="/" end style={navStyle}>Início</NavLink>
        <NavLink to="/casas" style={navStyle}>Casas</NavLink>
        <NavLink to="/inquilinos" style={navStyle}>Inquilinos</NavLink>
        <NavLink to="/contratos" style={navStyle}>Contratos</NavLink>
        <NavLink to="/recebimentos" style={navStyle}>Receber</NavLink>
        <NavLink to="/vistorias" style={navStyle}>Vistoria</NavLink>
        <NavLink to="/acertos" style={navStyle}>Acerto</NavLink>
        <NavLink to="/manutencao" style={navStyle}>Manutenção</NavLink>
        <NavLink to="/relatorios" style={navStyle}>Relatórios</NavLink>
        <NavLink to="/config" style={navStyle}>Configuração</NavLink>
      </nav>

      <main style={{ flex: 1, padding: 16 }}>
        <Outlet />
      </main>
    </div>
  )
}

const navStyle = ({ isActive }) => ({
  color: isActive ? 'var(--cor-ouro)' : 'var(--texto-fraco)',
  textDecoration: 'none',
  fontWeight: isActive ? 700 : 400,
  padding: '6px 4px'
})
