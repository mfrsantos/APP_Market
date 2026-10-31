import { PRIORIDADES, ajustarAoOrcamento } from "./orcamento.js";
import { identificarRede, normalizar, temConsultaOnline, consultarPrecoCache } from "./redes.js";
import { buscarSupermercados, geocodificarCidade, posicaoDoAparelho } from "./mapas.js";
import { CATEGORIAS, RESTRICOES, gerarLista } from "./gerador.js";

const CHAVE_ANTIGA = "appmarket.v1";
const CHAVE_CONTAS = "appmarket.contas";
const CHAVE_SESSAO = "appmarket.sessao";
const CHAVE_REGIAO = "appmarket.regiao";
const chaveUsuario = (id) => `appmarket.u.${id}`;
const PADRAO = {
  perfil: null, // {nome, cidade, estado, adultos, criancas: [idades], restricoes: [], outras}
  lista: [],
  compra: { orcamento: 0, dias: 30 },
  mercado: null,
  proxy: "",
  origem: "cidade",
  raio: 10,
  proximoId: 1,
};

function lerJson(chave, padrao) {
  try {
    return JSON.parse(localStorage.getItem(chave) ?? "null") ?? padrao;
  } catch {
    return padrao;
  }
}

let contas = lerContas();
let sessao = localStorage.getItem(CHAVE_SESSAO);
if (sessao && !contas.some((c) => c.id === sessao)) sessao = null;
let estado = sessao ? carregarUsuario(sessao) : { ...PADRAO };
let tela = sessao ? "compra" : contas.length ? "entrar" : "cadastro";
let regiao = { status: "ocioso", mercados: [], descricao: "", erro: "" };
const ofertas = new Map(); // "rede|produto" -> {oferta, erro} | {pendente: true}
const abertos = new Set(); // itens com o painel "Editar" aberto
let aviso = "";
let info = "";

function lerContas() {
  const guardadas = lerJson(CHAVE_CONTAS, null);
  if (guardadas) return guardadas;
  // migra os dados da versão anterior (sem login) para uma conta local sem PIN
  const antigo = lerJson(CHAVE_ANTIGA, null);
  if (!antigo?.perfil) return [];
  const { orcamento, ...resto } = antigo.perfil;
  const id = "u1";
  const migrado = { ...PADRAO, ...antigo, perfil: { adultos: 1, criancas: [], restricoes: [], outras: "", ...resto }, compra: { orcamento: orcamento ?? 0, dias: 30 } };
  localStorage.setItem(chaveUsuario(id), JSON.stringify(migrado));
  const lista = [{ id, nome: resto.nome, sal: "", hash: null }];
  localStorage.setItem(CHAVE_CONTAS, JSON.stringify(lista));
  localStorage.removeItem(CHAVE_ANTIGA);
  return lista;
}

function carregarUsuario(id) {
  const dados = lerJson(chaveUsuario(id), {});
  return { ...PADRAO, ...dados, compra: { ...PADRAO.compra, ...dados.compra } };
}

function salvar() {
  if (sessao) localStorage.setItem(chaveUsuario(sessao), JSON.stringify(estado));
}

function salvarContas() {
  localStorage.setItem(CHAVE_CONTAS, JSON.stringify(contas));
}

async function hashPin(pin, sal) {
  const bytes = new TextEncoder().encode(`${sal}:${pin}`);
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function entrarNaConta(id) {
  sessao = id;
  localStorage.setItem(CHAVE_SESSAO, id);
  estado = carregarUsuario(id);
  ofertas.clear();
  regiao = { status: "ocioso", mercados: [], descricao: "", erro: "" };
  tela = "compra";
  aviso = "";
  info = "";
  carregarRegiao();
}

function sair() {
  sessao = null;
  localStorage.removeItem(CHAVE_SESSAO);
  estado = { ...PADRAO };
  ofertas.clear();
  tela = contas.length ? "entrar" : "cadastro";
}

const brl = (valor) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

const esc = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const chaveOferta = (rede, produto) => `${rede}|${normalizar(produto)}`;
const itemAtivo = (i) => !i.adiado;

// --- Preços ---
function precoDoItem(nomeRede, item, usarManual) {
  if (usarManual && item.preco > 0) return { preco: item.preco, origem: "preço da prateleira" };
  const resposta = ofertas.get(chaveOferta(nomeRede, item.produto));
  if (resposta?.oferta) return { preco: resposta.oferta.preco, origem: "preço online" };
  if (usarManual && item.estimativa > 0) return { preco: item.estimativa, origem: "preço estimado" };
  return { preco: null, origem: "" };
}

function redesConsultaveis() {
  return regiao.mercados.filter((m) => temConsultaOnline(m.rede, estado.proxy));
}

async function atualizarPrecos() {
  if (!estado.proxy) return;
  const tarefas = [];
  for (const { rede } of redesConsultaveis()) {
    for (const item of estado.lista) {
      const chave = chaveOferta(rede.nome, item.produto);
      if (ofertas.has(chave)) continue;
      ofertas.set(chave, { pendente: true });
      tarefas.push(
        consultarPrecoCache(rede, item.produto, estado.proxy).then((r) => ofertas.set(chave, r)),
      );
    }
  }
  if (tarefas.length) {
    await Promise.all(tarefas);
    render();
  }
}

// --- Região (supermercados próximos) ---
function agruparPorRede(lojas) {
  const mercados = new Map();
  for (const loja of lojas) {
    const rede = identificarRede(loja.nome);
    if (rede && !mercados.has(rede.nome)) mercados.set(rede.nome, { rede, loja });
  }
  return [...mercados.values()].sort((a, b) => a.loja.distanciaKm - b.loja.distanciaKm);
}

async function carregarRegiao(forcar = false) {
  const { perfil, origem, raio } = estado;
  if (!perfil) return;
  const chave = `${origem}|${perfil.cidade}|${perfil.estado}|${raio}`;
  if (!forcar && origem === "cidade") {
    try {
      const cache = JSON.parse(localStorage.getItem(CHAVE_REGIAO) ?? "null");
      if (cache?.chave === chave && Date.now() - cache.t < 3600000) {
        regiao = { status: "ok", mercados: cache.mercados, descricao: cache.descricao, erro: "" };
        escolherMercadoPadrao();
        render();
        atualizarPrecos();
        return;
      }
    } catch {
      /* cache inválido */
    }
  }
  regiao = { status: "carregando", mercados: [], descricao: "", erro: "" };
  render();
  try {
    const ponto =
      origem === "aparelho"
        ? { ...(await posicaoDoAparelho()), descricao: "sua localização" }
        : await geocodificarCidade(perfil.cidade, perfil.estado);
    const mercados = agruparPorRede(await buscarSupermercados(ponto.lat, ponto.lon, raio));
    regiao = { status: "ok", mercados, descricao: ponto.descricao, erro: "" };
    if (origem === "cidade") {
      localStorage.setItem(
        CHAVE_REGIAO,
        JSON.stringify({ chave, t: Date.now(), mercados, descricao: ponto.descricao }),
      );
    }
  } catch (erro) {
    regiao = { status: "erro", mercados: [], descricao: "", erro: erro.message };
  }
  escolherMercadoPadrao();
  render();
  atualizarPrecos();
}

function escolherMercadoPadrao() {
  const nomes = regiao.mercados.map((m) => m.rede.nome);
  if (!nomes.includes(estado.mercado)) {
    const consultavel = redesConsultaveis()[0];
    estado.mercado = consultavel?.rede.nome ?? nomes[0] ?? null;
    salvar();
  }
}

// --- Cálculos ---
function totais() {
  let falta = 0;
  let carrinho = 0;
  let semPreco = 0;
  for (const item of estado.lista.filter(itemAtivo)) {
    const { preco } = precoDoItem(estado.mercado, item, true);
    if (preco === null) {
      if (!item.comprado) semPreco += 1;
      continue;
    }
    if (item.comprado) carrinho += preco * item.quantidade;
    else falta += preco * item.quantidade;
  }
  return { falta, carrinho, semPreco };
}

function comparativo() {
  const pendentes = estado.lista.filter((i) => !i.comprado && itemAtivo(i));
  return redesConsultaveis()
    .map(({ rede, loja }) => {
      let total = 0;
      let faltando = 0;
      for (const item of pendentes) {
        const { preco } = precoDoItem(rede.nome, item, false);
        if (preco === null) faltando += 1;
        else total += preco * item.quantidade;
      }
      return { rede, loja, total, faltando };
    })
    .sort((a, b) => a.faltando - b.faltando || a.total - b.total);
}

// --- Telas ---
function htmlEntrar() {
  return `
    <h1>🛒 Lista de Compras</h1>
    <form data-form="entrar" class="cartao">
      <label>Conta
        <select name="conta">${contas.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}</select></label>
      <label>PIN (se você definiu um)
        <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"></label>
      ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
      <button class="primario" type="submit">Entrar</button>
    </form>
    <button data-tela="cadastro">Criar nova conta</button>
    <p class="dica">As contas ficam só neste aparelho (sem servidor). O PIN apenas impede que outra pessoa abra sua conta aqui.</p>`;
}

function camposPerfil(perfil = {}) {
  const marcadas = new Set(perfil.restricoes ?? []);
  return `
    <label>Cidade <input name="cidade" required maxlength="60" value="${esc(perfil.cidade ?? "Bom Despacho")}"></label>
    <label>Estado (sigla) <input name="estado" maxlength="2" value="${esc(perfil.estado ?? "MG")}"></label>
    <label>Adultos (13 anos ou mais)
      <input name="adultos" type="number" min="1" max="20" inputmode="numeric" required value="${perfil.adultos ?? 1}"></label>
    <label>Idades das crianças (até 12 anos, separadas por vírgula; deixe vazio se não houver)
      <input name="criancas" inputmode="text" placeholder="ex.: 2, 7" value="${esc((perfil.criancas ?? []).join(", "))}"></label>
    <fieldset>
      <legend>Restrições alimentares da família</legend>
      ${Object.entries(RESTRICOES)
        .map(([id, nome]) => `<label class="marcar"><input type="checkbox" name="restricoes" value="${id}" ${marcadas.has(id) ? "checked" : ""}><span>${esc(nome)}</span></label>`)
        .join("")}
    </fieldset>
    <label>Outras restrições (só para lembrar, não altera a lista)
      <input name="outras" maxlength="120" value="${esc(perfil.outras ?? "")}"></label>`;
}

function htmlCadastro() {
  return `
    <h1>👋 Criar conta</h1>
    <p>Conte sobre sua família para o app montar a lista de compras.</p>
    <form data-form="cadastro" class="cartao">
      <label>Seu nome <input name="nome" required maxlength="40"></label>
      <label>PIN de 4 a 8 números (opcional)
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="new-password"></label>
      ${camposPerfil()}
      ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
      <button class="primario" type="submit">Criar conta e entrar</button>
    </form>
    ${contas.length ? '<button data-tela="entrar">Já tenho conta</button>' : ""}
    <p class="dica">Seus dados ficam salvos só neste aparelho.</p>`;
}

function htmlPerfil() {
  return `
    <h1>👤 Perfil</h1>
    <form data-form="perfil" class="cartao">
      <label>Seu nome <input name="nome" required maxlength="40" value="${esc(estado.perfil.nome)}"></label>
      ${camposPerfil(estado.perfil)}
      <details><summary>Avançado</summary>
        <label>URL do proxy de preços online (opcional)
          <input name="proxy" type="url" placeholder="https://seu-worker.workers.dev" value="${esc(estado.proxy)}"></label>
        <p class="dica">Sem proxy os preços online ficam desligados e você informa o preço da prateleira. Veja o README.</p>
      </details>
      <button class="primario" type="submit">Salvar</button>
    </form>
    <p class="dica">Para refazer a lista com a família atualizada, use a aba Compra.</p>
    <button data-acao="sair">Sair da conta</button>
    <button class="perigo" data-acao="apagar">Apagar esta conta e seus dados</button>`;
}

function htmlCompra() {
  const { perfil, compra } = estado;
  const criancas = perfil.criancas.length ? `${perfil.criancas.length} criança(s) (${perfil.criancas.join(", ")} anos)` : "sem crianças";
  const restricoes = perfil.restricoes.map((r) => RESTRICOES[r]).filter(Boolean);
  return `
    <h1>💰 Nova compra</h1>
    <p>Olá, ${esc(perfil.nome)}! Família: ${perfil.adultos} adulto(s), ${criancas}.
      ${restricoes.length ? `Restrições: ${esc(restricoes.join(", "))}.` : ""}</p>
    <form data-form="compra" class="cartao">
      <label>Quanto você quer e pode gastar? (R$) — 0 = sem limite
        <input name="orcamento" type="number" min="0" step="0.01" inputmode="decimal" required value="${compra.orcamento}"></label>
      <label>Compra para quanto tempo?
        <select name="dias">${[[7, "1 semana"], [15, "15 dias"], [30, "1 mês"]]
          .map(([d, nome]) => `<option value="${d}" ${compra.dias === d ? "selected" : ""}>${nome}</option>`)
          .join("")}</select></label>
      <p class="dica">A lista é montada primeiro com alimentação básica, depois limpeza e higiene e, por fim, os opcionais — cortando o que não couber no valor. Os preços são estimativas até você informar o valor da prateleira ou o preço online.</p>
      ${estado.lista.length ? '<p class="erro">Gerar uma nova lista substitui a lista atual.</p>' : ""}
      <button class="primario" type="submit">Gerar lista</button>
    </form>
    ${estado.lista.length ? '<button data-tela="lista">Continuar lista atual</button>' : ""}`;
}

function htmlOrcamento(t) {
  const orcamento = estado.compra.orcamento;
  const campo = `
    <label>💰 Quanto posso gastar (R$) — 0 = sem limite
      <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="orcamento" value="${orcamento}"></label>`;
  if (!(orcamento > 0) || !estado.lista.length) return `<div class="cartao">${campo}</div>`;

  const previsto = t.falta + t.carrinho;
  const pct = Math.min(100, (previsto / orcamento) * 100);
  let resultado;
  if (previsto <= orcamento) {
    resultado = `<p class="ok">Previsto: ${brl(previsto)} de ${brl(orcamento)}. Sobram ${brl(orcamento - previsto)}.</p>`;
  } else {
    const plano = ajustarAoOrcamento(
      estado.lista.filter(itemAtivo).map((i) => ({
        id: i.id,
        produto: i.produto,
        prioridade: i.prioridade,
        quantidade: i.quantidade,
        preco: precoDoItem(estado.mercado, i, true).preco,
        comprado: i.comprado,
      })),
      orcamento,
    );
    resultado = `<p class="erro">Previsto: ${brl(previsto)} — ${brl(previsto - orcamento)} acima do orçamento.</p>`;
    if (plano.mudancas.length) {
      resultado += `
        <div class="ajuste"><strong>Ajuste sugerido</strong> (começa pelos itens opcionais):
          <ul>${plano.mudancas
            .map((m) => `<li>${esc(m.produto)}: ${m.para === 0 ? "adiar para outra compra" : `${m.de} → ${m.para}`}</li>`)
            .join("")}</ul>
          <p class="dica">${
            plano.cabe
              ? `Com o ajuste o total fica em ${brl(plano.total)}.`
              : `Mesmo assim o total é ${brl(plano.total)}: os itens essenciais ultrapassam o orçamento.`
          }</p>
          <button class="primario" data-acao="ajustar">✅ Aplicar ajuste</button>
        </div>`;
    } else {
      resultado +=
        '<p class="dica">Não há o que reduzir: itens essenciais com quantidade 1 já ultrapassam o orçamento, ou faltam preços.</p>';
    }
  }
  return `<div class="cartao">${campo}<div class="barra"><div style="width:${pct}%" class="${previsto > orcamento ? "estouro" : ""}"></div></div>${resultado}</div>`;
}

function htmlItem(item) {
  const { preco, origem } = precoDoItem(estado.mercado, item, true);
  let sub;
  if (item.adiado) sub = "⏸️ Adiado — fora desta compra";
  else if (preco !== null) sub = `${item.quantidade} × ${brl(preco)} = ${brl(preco * item.quantidade)} · ${origem}`;
  else sub = "Sem preço encontrado";
  return `
    <article class="item ${item.comprado ? "feito" : ""} ${item.adiado ? "adiado" : ""}">
      <label class="marcar"><input type="checkbox" data-campo="comprado" data-id="${item.id}" ${item.comprado ? "checked" : ""}>
        <span>${esc(item.produto)}</span></label>
      <div class="sub">${sub}</div>
      <details data-id="${item.id}" ${abertos.has(item.id) ? "open" : ""}>
        <summary>Editar</summary>
        <label>Quantidade
          <input type="number" min="1" step="1" inputmode="numeric" data-campo="quantidade" data-id="${item.id}" value="${item.quantidade}"></label>
        <label>Prioridade (usada no ajuste do orçamento)
          <select data-campo="prioridade" data-id="${item.id}">
            ${PRIORIDADES.map((p) => `<option ${p === item.prioridade ? "selected" : ""}>${p}</option>`).join("")}
          </select></label>
        <label class="marcar"><input type="checkbox" data-campo="adiado" data-id="${item.id}" ${item.adiado ? "checked" : ""}>
          <span>Adiar para outra compra</span></label>
        <label>Preço na prateleira (R$) — 0 usa o preço online
          <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="preco" data-id="${item.id}" value="${item.preco}"></label>
        <button class="perigo" data-acao="remover" data-id="${item.id}">🗑️ Remover da lista</button>
      </details>
    </article>`;
}

function htmlLista() {
  const t = totais();
  const itens = estado.lista;
  return `
    <form data-form="adicionar" class="adicionar">
      <input name="produto" placeholder="Adicionar produto, ex.: Café 500g" maxlength="80" autocomplete="off" required>
      <button class="primario" type="submit">➕</button>
    </form>
    ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
    ${
      estado.mercado
        ? `<p class="dica">Comprando em: <strong>${esc(estado.mercado)}</strong></p>`
        : itens.length
          ? '<p class="dica">Abra a aba Mercados para escolher onde vai comprar.</p>'
          : ""
    }
    ${
      itens.length
        ? `<div class="metricas"><div><small>Falta comprar</small><strong>${brl(t.falta)}</strong></div>
           <div><small>No carrinho</small><strong>${brl(t.carrinho)}</strong></div></div>
           ${t.semPreco ? `<p class="dica">${t.semPreco} item(ns) sem preço — abra “Editar” e informe o valor da prateleira.</p>` : ""}`
        : ""
    }
    ${info ? `<p class="ok">${esc(info)}</p>` : ""}
    ${htmlOrcamento(t)}
    ${Object.entries(CATEGORIAS)
      .map(([cat, { titulo }]) => {
        const doGrupo = itens.filter((i) => (CATEGORIAS[i.categoria] ? i.categoria : "extra") === cat);
        return doGrupo.length ? `<h3>${titulo}</h3>${doGrupo.map(htmlItem).join("")}` : "";
      })
      .join("")}
    ${itens.some((i) => i.comprado) ? '<button data-acao="limpar">Limpar itens comprados</button>' : ""}
    ${itens.length ? "" : '<p class="dica">Sua lista está vazia. Adicione um produto acima.</p>'}
    <p class="dica">Os preços online podem diferir da loja física. Confira na prateleira e, se mudar, informe o valor em “Editar”.</p>`;
}

function htmlMercados() {
  const comp = comparativo();
  const consultaveis = new Set(comp.map((c) => c.rede.nome));
  const outros = regiao.mercados.filter((m) => !consultaveis.has(m.rede.nome));
  let corpo;
  if (regiao.status === "carregando") corpo = '<p class="dica">Buscando supermercados na região…</p>';
  else if (regiao.status === "erro") corpo = `<p class="erro">${esc(regiao.erro)}</p>`;
  else if (!regiao.mercados.length) corpo = '<p class="dica">Nenhuma rede conhecida encontrada nesse raio. Aumente o raio ou tente outra cidade.</p>';
  else {
    const linha = (m, detalhe) => `
      <label class="mercado">
        <input type="radio" name="mercado" data-campo="mercado" value="${esc(m.rede.nome)}" ${estado.mercado === m.rede.nome ? "checked" : ""}>
        <span><strong>${esc(m.rede.nome)}</strong> · ${m.loja.distanciaKm.toFixed(1)} km<br><small>${detalhe}</small></span>
      </label>`;
    corpo = `<p class="dica">Perto de ${esc(regiao.descricao)}. Escolha onde vai comprar:</p>
      ${comp.map((c) => linha(c, `${brl(c.total)}${c.faltando ? ` · ${c.faltando} sem preço` : ""}`)).join("")}
      ${outros.map((m) => linha(m, "sem consulta online — use o preço da prateleira")).join("")}
      ${!comp.length ? `<p class="dica">${estado.proxy ? "Nenhuma rede encontrada tem consulta online." : "Preços online desligados: configure o proxy em Perfil > Avançado."}</p>` : ""}`;
  }
  return `
    <h2>Supermercados da região</h2>
    <div class="cartao">
      <label>Localizar por
        <select data-campo="origem">
          <option value="cidade" ${estado.origem === "cidade" ? "selected" : ""}>Cidade do cadastro (${esc(estado.perfil.cidade)})</option>
          <option value="aparelho" ${estado.origem === "aparelho" ? "selected" : ""}>Localização do aparelho</option>
        </select></label>
      <label>Raio de busca
        <select data-campo="raio">${[2, 5, 10, 20, 30]
          .map((r) => `<option value="${r}" ${estado.raio === r ? "selected" : ""}>${r} km</option>`)
          .join("")}</select></label>
      <button data-acao="buscar">🔄 Buscar de novo</button>
    </div>
    ${corpo}`;
}

function render() {
  const raiz = document.getElementById("app");
  const rolagem = window.scrollY;
  if (!sessao) {
    raiz.innerHTML = `<div class="tela">${tela === "cadastro" || !contas.length ? htmlCadastro() : htmlEntrar()}</div>`;
    window.scrollTo(0, rolagem);
    return;
  }
  if (tela === "entrar" || tela === "cadastro") tela = "compra";
  const conteudo =
    tela === "mercados"
      ? htmlMercados()
      : tela === "perfil"
        ? htmlPerfil()
        : tela === "compra"
          ? htmlCompra()
          : `<h1>🛒 Lista de Compras</h1>${htmlLista()}`;
  raiz.innerHTML = `
    <div class="tela">${conteudo}</div>
    <nav>
      ${[["lista", "🛒", "Lista"], ["mercados", "📊", "Mercados"], ["compra", "💰", "Compra"], ["perfil", "👤", estado.perfil.nome]]
        .map(([id, icone, nome]) => `<button data-tela="${id}" class="${tela === id ? "ativo" : ""}">${icone}<span>${esc(nome)}</span></button>`)
        .join("")}
    </nav>`;
  window.scrollTo(0, rolagem);
}

// --- Eventos ---
function itemPorId(id) {
  return estado.lista.find((i) => i.id === id);
}

function adicionarItem(nome) {
  const limpo = nome.trim().slice(0, 80);
  if (!limpo) return "Digite o nome do produto.";
  if (estado.lista.some((i) => i.produto.toLowerCase() === limpo.toLowerCase())) return "Esse produto já está na lista.";
  estado.lista.push({
    id: `i${estado.proximoId++}`,
    produto: limpo,
    quantidade: 1,
    comprado: false,
    preco: 0,
    prioridade: "Normal",
    adiado: false,
    categoria: "extra",
    estimativa: 0,
  });
  return "";
}

function resumoDoAjuste(plano) {
  const adiados = plano.mudancas.filter((m) => m.para === 0).length;
  const reduzidos = plano.mudancas.length - adiados;
  return `Ajuste ao orçamento: ${adiados} item(ns) adiado(s) e ${reduzidos} com quantidade reduzida.`;
}

function planoDoOrcamento() {
  return ajustarAoOrcamento(
    estado.lista.filter(itemAtivo).map((i) => ({
      id: i.id,
      produto: i.produto,
      prioridade: i.prioridade,
      quantidade: i.quantidade,
      preco: precoDoItem(estado.mercado, i, true).preco,
      comprado: i.comprado,
    })),
    estado.compra.orcamento,
  );
}

function aplicarAjuste() {
  const plano = planoDoOrcamento();
  for (const m of plano.mudancas) {
    const item = itemPorId(m.id);
    if (m.para === 0) item.adiado = true;
    else item.quantidade = m.para;
  }
  return plano;
}

function criarCompra(orcamento, dias) {
  estado.compra = { orcamento, dias };
  estado.lista = gerarLista(estado.perfil, dias).map((base) => ({
    id: `i${estado.proximoId++}`,
    produto: base.produto,
    quantidade: base.quantidade,
    comprado: false,
    preco: 0,
    prioridade: base.prioridade,
    adiado: false,
    categoria: base.categoria,
    estimativa: base.estimativa,
  }));
  info = "";
  if (orcamento > 0) {
    const plano = aplicarAjuste();
    info = plano.mudancas.length ? resumoDoAjuste(plano) : "Toda a lista cabe no seu orçamento.";
    if (!plano.cabe) info += " Mesmo assim os itens essenciais passam do valor informado.";
  }
}

function numero(valor, minimo, inteiro) {
  const n = Number.parseFloat(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) return minimo;
  return Math.max(minimo, inteiro ? Math.round(n) : n);
}

const app = document.getElementById("app");

function lerPerfil(fd) {
  const criancas = String(fd.get("criancas") ?? "")
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 17)
    .map(Math.round)
    .slice(0, 12);
  return {
    cidade: String(fd.get("cidade")).trim().slice(0, 60),
    estado: String(fd.get("estado") ?? "").trim().slice(0, 2).toUpperCase(),
    adultos: numero(fd.get("adultos"), 1, true),
    criancas,
    restricoes: fd.getAll("restricoes").filter((r) => r in RESTRICOES),
    outras: String(fd.get("outras") ?? "").trim().slice(0, 120),
  };
}

app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const dados = Object.fromEntries(fd);
  const tipo = form.dataset.form;
  if (tipo === "adicionar") {
    aviso = adicionarItem(dados.produto);
    salvar();
    render();
    document.querySelector('[name="produto"]')?.focus();
    atualizarPrecos();
  } else if (tipo === "entrar") {
    const conta = contas.find((c) => c.id === dados.conta);
    if (!conta) return;
    if (conta.hash && (await hashPin(dados.pin, conta.sal)) !== conta.hash) {
      aviso = "PIN incorreto.";
      render();
      return;
    }
    aviso = "";
    entrarNaConta(conta.id);
    render();
  } else if (tipo === "cadastro") {
    const nome = dados.nome.trim().slice(0, 40);
    const pin = (dados.pin ?? "").trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      aviso = "O PIN deve ter de 4 a 8 números.";
      render();
      return;
    }
    const sal = crypto.randomUUID();
    const conta = { id: `u${Date.now().toString(36)}`, nome, sal, hash: pin ? await hashPin(pin, sal) : null };
    contas.push(conta);
    salvarContas();
    sessao = conta.id;
    localStorage.setItem(CHAVE_SESSAO, sessao);
    estado = { ...PADRAO, perfil: { nome, ...lerPerfil(fd) } };
    salvar();
    aviso = "";
    info = "";
    tela = "compra";
    render();
    carregarRegiao();
  } else if (tipo === "perfil") {
    const anterior = estado.perfil;
    estado.perfil = { nome: dados.nome.trim().slice(0, 40), ...lerPerfil(fd) };
    const conta = contas.find((c) => c.id === sessao);
    if (conta) {
      conta.nome = estado.perfil.nome;
      salvarContas();
    }
    const proxyAnterior = estado.proxy;
    estado.proxy = (dados.proxy ?? "").trim();
    if (estado.proxy !== proxyAnterior) ofertas.clear();
    salvar();
    tela = "lista";
    render();
    if (anterior.cidade !== estado.perfil.cidade || regiao.status === "ocioso") carregarRegiao();
    else atualizarPrecos();
  } else if (tipo === "compra") {
    criarCompra(numero(dados.orcamento, 0, false), Number(dados.dias) || 30);
    salvar();
    tela = "lista";
    render();
    window.scrollTo(0, 0);
    atualizarPrecos();
  }
});

app.addEventListener("change", (e) => {
  const alvo = e.target;
  const campo = alvo.dataset.campo;
  if (!campo) return;
  const item = alvo.dataset.id ? itemPorId(alvo.dataset.id) : null;
  switch (campo) {
    case "comprado":
    case "adiado":
      item[campo] = alvo.checked;
      break;
    case "quantidade":
      item.quantidade = numero(alvo.value, 1, true);
      break;
    case "preco":
      item.preco = numero(alvo.value, 0, false);
      break;
    case "prioridade":
      item.prioridade = alvo.value;
      break;
    case "orcamento":
      estado.compra.orcamento = numero(alvo.value, 0, false);
      info = "";
      break;
    case "mercado":
      estado.mercado = alvo.value;
      break;
    case "origem":
      estado.origem = alvo.value;
      salvar();
      carregarRegiao(true);
      return;
    case "raio":
      estado.raio = Number(alvo.value);
      salvar();
      carregarRegiao(true);
      return;
  }
  salvar();
  render();
});

app.addEventListener(
  "toggle",
  (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    if (e.target.open) abertos.add(id);
    else abertos.delete(id);
  },
  true,
);

app.addEventListener("click", (e) => {
  const botao = e.target.closest("button");
  if (!botao) return;
  if (botao.dataset.tela) {
    tela = botao.dataset.tela;
    aviso = "";
    render();
    window.scrollTo(0, 0);
    return;
  }
  switch (botao.dataset.acao) {
    case "remover":
      estado.lista = estado.lista.filter((i) => i.id !== botao.dataset.id);
      abertos.delete(botao.dataset.id);
      break;
    case "limpar":
      estado.lista = estado.lista.filter((i) => !i.comprado);
      break;
    case "ajustar":
      info = resumoDoAjuste(aplicarAjuste());
      break;
    case "buscar":
      carregarRegiao(true);
      return;
    case "sair":
      sair();
      render();
      return;
    case "apagar":
      if (!confirm("Apagar esta conta, a lista e os preços guardados neste aparelho?")) return;
      localStorage.removeItem(chaveUsuario(sessao));
      contas = contas.filter((c) => c.id !== sessao);
      salvarContas();
      sair();
      render();
      return;
    default:
      return;
  }
  salvar();
  render();
});

render();
if (estado.perfil) carregarRegiao();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
