import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useOrg } from './context/OrgContext'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Config from './pages/Config'
import Home from './pages/Home'
import Casas from './pages/Casas'
import Quartos from './pages/Quartos'
import Inquilinos from './pages/Inquilinos'
import Contratos from './pages/Contratos'
import Recebimentos from './pages/Recebimentos'
import Vistorias from './pages/Vistorias'
import VistoriaEditor from './pages/VistoriaEditor'
import Acertos from './pages/Acertos'
import Manutencao from './pages/Manutencao'
import Composicao from './pages/Composicao'
import Relatorios from './pages/Relatorios'
import Cobranca from './pages/Cobranca'
import ContasPagar from './pages/ContasPagar'
import FluxoCaixa from './pages/FluxoCaixa'
import Alertas from './pages/Alertas'
import Reajustes from './pages/Reajustes'
import Avisos from './pages/Avisos'
import Layout from './components/Layout'

function Splash({ texto = 'Carregando…' }) {
  return <div className="centro"><div className="sub">{texto}</div></div>
}

export default function App() {
  const { session, carregando: authLoad } = useAuth()
  const { org, carregando: orgLoad } = useOrg()

  if (authLoad) return <Splash />
  if (!session) {
    // Sem sessão → login (qualquer rota cai aqui)
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (orgLoad) return <Splash texto="Carregando conta…" />

  // Logado mas sem org → 1ª configuração (bootstrap)
  if (!org) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  // Logado com org → app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/casas" element={<Casas />} />
        <Route path="/casas/:casaId/quartos" element={<Quartos />} />
        <Route path="/casas/:casaId/composicao" element={<Composicao />} />
        <Route path="/inquilinos" element={<Inquilinos />} />
        <Route path="/contratos" element={<Contratos />} />
        <Route path="/recebimentos" element={<Recebimentos />} />
        <Route path="/vistorias" element={<Vistorias />} />
        <Route path="/vistorias/:vistoriaId" element={<VistoriaEditor />} />
        <Route path="/acertos" element={<Acertos />} />
        <Route path="/manutencao" element={<Manutencao />} />
        <Route path="/relatorios" element={<Relatorios />} />
        <Route path="/cobranca" element={<Cobranca />} />
        <Route path="/contas-pagar" element={<ContasPagar />} />
        <Route path="/fluxo-caixa" element={<FluxoCaixa />} />
        <Route path="/alertas" element={<Alertas />} />
        <Route path="/reajustes" element={<Reajustes />} />
        <Route path="/avisos" element={<Avisos />} />
        <Route path="/config" element={<Config />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
