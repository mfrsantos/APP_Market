// Redes conhecidas e consulta de preços online (catálogo público VTEX).
// O navegador não pode consultar essas lojas direto (CORS); a consulta passa
// por um proxy próprio (veja worker/precos-proxy.js) informado em Perfil > Avançado.

export const REDES = [
  { nome: "Atacadão", dominio: "www.atacadao.com.br", categoria: "Atacarejo", apelidos: ["atacadao"] },
  { nome: "Supermercados BH", dominio: null, categoria: "Supermercado", apelidos: ["supermercados bh", "supermercado bh", "super bh"] },
  { nome: "Mart Minas", dominio: null, categoria: "Supermercado", apelidos: ["mart minas"] },
  { nome: "Fidelis Supermercados", dominio: null, categoria: "Supermercado", apelidos: ["fidelis"] },
  { nome: "Oliveira Supermercados", dominio: null, categoria: "Supermercado", apelidos: ["oliveira"] },
  { nome: "VAP Supermercados", dominio: null, categoria: "Supermercado", apelidos: ["vap"] },
  { nome: "Santa Edwiges", dominio: null, categoria: "Supermercado", apelidos: ["santa edwiges"] },
  { nome: "Carrefour", dominio: null, categoria: "Hipermercado", apelidos: ["carrefour"] },
  { nome: "Assaí", dominio: null, categoria: "Atacarejo", apelidos: ["assai"] },
  { nome: "Pão de Açúcar", dominio: null, categoria: "Supermercado", apelidos: ["pao de acucar"] },
  { nome: "Epa", dominio: null, categoria: "Supermercado", apelidos: ["epa"] },
];

export function normalizar(texto) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function identificarRede(nomeLoja) {
  const nome = normalizar(nomeLoja);
  return (
    REDES.find((rede) =>
      rede.apelidos.some((apelido) => new RegExp(`\\b${apelido}\\b`).test(nome)),
    ) ?? null
  );
}

export function temConsultaOnline(rede, proxy) {
  return Boolean(rede?.dominio && proxy);
}

export function extrairOfertas(itens, produto) {
  const ofertas = [];
  for (const item of itens) {
    for (const sku of item.items ?? []) {
      for (const vendedor of sku.sellers ?? []) {
        const oferta = vendedor.commertialOffer ?? {};
        if (oferta.Price > 0 && oferta.AvailableQuantity > 0) {
          ofertas.push({
            descricao: item.productName ?? produto,
            marca: item.brand ?? "",
            preco: Number(oferta.Price),
            link: item.link ?? "",
          });
          break;
        }
      }
    }
  }
  return ofertas;
}

export async function consultarPreco(rede, produto, proxy) {
  const url = new URL(proxy);
  url.searchParams.set("dominio", rede.dominio);
  url.searchParams.set("ft", produto);
  const resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const ofertas = extrairOfertas(await resposta.json(), produto);
  return ofertas.length ? ofertas.reduce((a, b) => (b.preco < a.preco ? b : a)) : null;
}

const VALIDADE_MS = 30 * 60 * 1000;

// Retorna {oferta, erro}; resultados ficam guardados por 30 minutos.
export async function consultarPrecoCache(rede, produto, proxy) {
  const chave = `appmarket.preco.${rede.nome}|${normalizar(produto)}`;
  try {
    const guardado = JSON.parse(localStorage.getItem(chave) ?? "null");
    if (guardado && Date.now() - guardado.t < VALIDADE_MS) {
      return { oferta: guardado.oferta, erro: null };
    }
  } catch {
    /* cache inválido: ignora */
  }
  try {
    const oferta = await consultarPreco(rede, produto, proxy);
    try {
      localStorage.setItem(chave, JSON.stringify({ t: Date.now(), oferta }));
    } catch {
      /* sem espaço: segue sem cache */
    }
    return { oferta, erro: null };
  } catch (erro) {
    return { oferta: null, erro: erro.message };
  }
}
