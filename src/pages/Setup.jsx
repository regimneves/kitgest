import { useState } from 'react'
import { useOrg } from '../context/OrgContext'
import { useAuth } from '../context/AuthContext'

// 1ª configuração: cria a org (bootstrap_org) e vincula o usuário como dono.
export default function Setup() {
  const { criarOrg } = useOrg()
  const { sair } = useAuth()
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErro(''); setBusy(true)
    try {
      await criarOrg(nome.trim() || null)
      // OrgContext recarrega e o App entra no app; o resto do branding
      // (cor, logo, PIX) é preenchido na tela de Configuração.
    } catch (err) {
      setErro(err.message || 'Não foi possível criar a conta.')
      setBusy(false)
    }
  }

  return (
    <div className="centro">
      <form className="card stack" onSubmit={submit}>
        <h1>Bem-vindo 👋</h1>
        <div className="sub">Vamos criar a conta da sua operação. Você ajusta cor, logo e PIX depois.</div>

        <label htmlFor="nome">Nome da operação</label>
        <input id="nome" value={nome} placeholder="Ex.: Kitnets da Regiane"
               onChange={e => setNome(e.target.value)} autoFocus />

        {erro && <div className="erro">{erro}</div>}

        <button className="ouro mt" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Criando…' : 'Criar conta'}
        </button>
        <button type="button" className="secundario mt" onClick={sair} style={{ width: '100%' }}>
          Sair
        </button>
      </form>
    </div>
  )
}
