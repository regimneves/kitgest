// Compressão de imagem no cliente ANTES do upload.
// Foto de celular (4–12MB) trava a fila; reduzimos para ~1600px / JPEG.

function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function carregarImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Comprime um File de imagem.
 * @returns {Promise<{blob: Blob, previa: string, width: number, height: number}>}
 *   blob = JPEG p/ upload; previa = dataURL leve p/ miniatura na tela.
 */
export async function comprimirImagem(file, maxLado = 1600, qualidade = 0.82) {
  const dataUrl = await lerArquivo(file)
  const img = await carregarImg(dataUrl)
  let { width, height } = img
  const maior = Math.max(width, height)
  if (maior > maxLado) {
    const f = maxLado / maior
    width = Math.round(width * f)
    height = Math.round(height * f)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', qualidade))
  const previa = canvas.toDataURL('image/jpeg', 0.7)
  return { blob, previa, width, height }
}

// Blob → dataURL (usado p/ embutir imagem do Storage no PDF do laudo).
export function blobParaDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}
