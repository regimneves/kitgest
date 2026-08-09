import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { entrar, cadastrar } = useAuth()
  const [modo, setModo] = useState('entrar')   // entrar | cadastrar
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErro(''); setMsg(''); setBusy(true)
    try {
      if (modo === 'entrar') {
        const { error } = await entrar(email, senha)
        if (error) throw error
        // AuthContext detecta a sessão e o App troca de tela.
      } else {
        const { error } = await cadastrar(email, senha)
        if (error) throw error
        setMsg('Conta criada. Se a confirmação por e-mail estiver ligada, confirme antes de entrar.')
        setModo('entrar')
      }
    } catch (err) {
      setErro(traduz(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="centro">
      <form className="card stack" onSubmit={submit}>
        <div className="marca">
          <div className="badge">KG</div>
          <div>
            <h1>KitGest</h1>
            <div className="sub" style={{ margin: 0 }}>Gestão de kitnets</div>
          </div>
        </div>

        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" value={email} autoComplete="email"
               onChange={e => setEmail(e.target.value)} required />

        <label htmlFor="senha">Senha</label>
        <input id="senha" type="password" value={senha} autoComplete="current-password"
               onChange={e => setSenha(e.target.value)} required minLength={6} />

        {erro && <div className="erro">{erro}</div>}
        {msg && <div className="ok">{msg}</div>}

        <button className="ouro mt" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>

        <div className="sub mt" style={{ textAlign: 'center', margin: 0 }}>
          {modo === 'entrar' ? 'Ainda não tem conta? ' : 'Já tem conta? '}
          <a href="#" onClick={e => { e.preventDefault(); setErro(''); setMsg(''); setModo(modo === 'entrar' ? 'cadastrar' : 'entrar') }}>
            {modo === 'entrar' ? 'Criar conta' : 'Entrar'}
          </a>
        </div>
      </form>
    </div>
  )
}

function traduz(m = '') {
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.'
  if (/already registered/i.test(m)) return 'Este e-mail já tem conta.'
  if (/password should be/i.test(m)) return 'A senha precisa de pelo menos 6 caracteres.'
  return m
}
