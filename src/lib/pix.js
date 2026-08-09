// PIX "Copia e Cola" (BR Code EMV estático) — 100% client-side, sem gateway.
// Spec: Manual BR Code do Banco Central. QR estático NÃO confirma pagamento;
// a operadora confirma pelo comprovante.

// Remove acentos e limita a caracteres aceitos (nome/cidade do recebedor).
function limpar(txt, max) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .replace(/[^A-Za-z0-9 ]/g, '')                     // só alfanumérico + espaço
    .toUpperCase()
    .trim()
    .slice(0, max)
}

// Campo EMV: id(2) + tamanho(2, com zero à esquerda) + valor.
function campo(id, valor) {
  const tam = String(valor.length).padStart(2, '0')
  return `${id}${tam}${valor}`
}

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF) sobre a string toda incluindo "6304".
function crc16(str) {
  let crc = 0xffff
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Monta o "copia e cola" do PIX.
 * @param {object} p
 * @param {string} p.chave          chave PIX (obrigatória)
 * @param {string} p.nome           nome do recebedor (máx 25)
 * @param {string} p.cidade         cidade do recebedor (máx 15)
 * @param {number} [p.valor]        valor em reais (opcional; se ausente, aberto)
 * @param {string} [p.txid]         identificador (alfanumérico, máx 25; padrão "***")
 * @returns {string} payload BR Code
 */
export function montarPixBRCode({ chave, nome, cidade, valor, txid }) {
  if (!chave) throw new Error('Chave PIX não configurada.')

  const gui = campo('00', 'br.gov.bcb.pix')
  const chaveField = campo('01', String(chave).trim())
  const merchantAccount = campo('26', gui + chaveField)

  const nomeLimpo = limpar(nome, 25) || 'RECEBEDOR'
  const cidadeLimpa = limpar(cidade, 15) || 'CIDADE'

  const ref = (txid && String(txid).replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***'
  const adicional = campo('62', campo('05', ref))

  let payload =
    campo('00', '01') +            // Payload Format Indicator
    campo('01', '11') +            // Point of Initiation (11 = estático/reutilizável)
    merchantAccount +
    campo('52', '0000') +          // Merchant Category Code
    campo('53', '986')             // Moeda: BRL

  if (valor != null && Number(valor) > 0) {
    payload += campo('54', Number(valor).toFixed(2))
  }

  payload +=
    campo('58', 'BR') +
    campo('59', nomeLimpo) +
    campo('60', cidadeLimpa) +
    adicional

  payload += '6304'              // id + tamanho do CRC (o valor vem a seguir)
  return payload + crc16(payload)
}
