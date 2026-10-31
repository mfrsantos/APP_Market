import { PRIORIDADES, ajustarAoOrcamento } from "./orcamento.js";
import { identificarRede, normalizar, temConsultaOnline, consultarPrecoCache } from "./redes.js";
import { buscarSupermercados, geocodificarCidade, posicaoDoAparelho } from "./mapas.js";
import { CATEGORIAS, RESTRICOES, gerarLista } from "./gerador.js";
import {
  MAX_MEMBROS,
  descreverFamilia,
  limparMembros,
  membrosDoPerfil,
  novoMembro,
  resumoFamilia,
  rotuloMembro,
  validarMembros,
} from "./familia.js";

const CHAVE_ANTIGA = "appmarket.v1";
const CHAVE_CONTAS = "appmarket.contas";
const CHAVE_SESSAO = "appmarket.sessao";
const CHAVE_REGIAO = "appmarket.regiao";
const chaveUsuario = (id) => `appmarket.u.${id}`;
const PADRAO = {
  perfil: null, // {nome, cidade, estado, adultos, criancas: [idades], restricoes: [], outras}
  lista: [],
  manual: [],
  aba: "sugerida",
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
let tela = sessao ? (estado.lista.length || estado.manual.length ? "lista" : "compra") : contas.length ? "entrar" : "cadastro";
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
  if (dados.perfil) dados.perfil.membros = membrosDoPerfil(dados.perfil);
  const lista = (dados.lista ?? []).map((item) =>
    item.categoria === "limpeza" &&
    (item.prioridade !== "Essencial" || item.adiado)
      ? { ...item, prioridade: "Essencial", adiado: false }
      : item,
  );
  const estadoCarregado = {
    ...PADRAO,
    ...dados,
    lista,
    compra: { ...PADRAO.compra, ...dados.compra },
  };
  if (lista.some((item, indice) => item !== dados.lista?.[indice])) {
    localStorage.setItem(chaveUsuario(id), JSON.stringify(estadoCarregado));
  }
  return estadoCarregado;
}

// --- Rascunho do cadastro/perfil (os campos são sincronizados a cada digitação) ---
const PASSOS_FAMILIA = ["Onde você compra", "Sua família", "Alimentação"];

function novoRascunho(perfil = null, proxy = "") {
  return {
    nome: perfil?.nome ?? "",
    pin: "",
    cidade: perfil?.cidade ?? "Bom Despacho",
    estado: perfil?.estado ?? "MG",
    membros: perfil ? structuredClone(perfil.membros) : [],
    restricoes: [...(perfil?.restricoes ?? [])],
    outras: perfil?.outras ?? "",
    proxy,
    passo: 0,
  };
}

let rascunho = novoRascunho();

function montarPerfil(r) {
  const membros = limparMembros(r.membros);
  const { adultos, criancas } = resumoFamilia(membros);
  return {
    nome: r.nome.trim().slice(0, 40),
    cidade: r.cidade.trim().slice(0, 60),
    estado: r.estado.trim().slice(0, 2).toUpperCase(),
    membros,
    adultos,
    criancas,
    restricoes: r.restricoes.filter((x) => x in RESTRICOES),
    outras: r.outras.trim().slice(0, 120),
  };
}

// Valida só o trecho pedido: passo (0 a 3) ou todos (null)
function validarRascunho(r, passo = null) {
  const em = (p) => passo === null || passo === p;
  if (em(0)) {
    if (!r.nome.trim()) return "Informe seu nome.";
    if (r.pin && !/^\d{4,8}$/.test(r.pin)) return "O PIN deve ter de 4 a 8 números.";
  }
  if (em(1) && !r.cidade.trim()) return "Informe a cidade.";
  if (em(2)) return validarMembros(r.membros);
  return "";
}

function salvar() {
  if (sessao) localStorage.setItem(chaveUsuario(sessao), JSON.stringify(estado));
}

function salvarContas() {
  localStorage.setItem(CHAVE_CONTAS, JSON.stringify(contas));
}

// --- Tema (vale para todo o aparelho) ---
const CHAVE_TEMA = "appmarket.tema";
const escuroDoSistema = matchMedia("(prefers-color-scheme: dark)");

function temaEscuro() {
  const t = localStorage.getItem(CHAVE_TEMA) ?? "auto";
  return t === "escuro" || (t === "auto" && escuroDoSistema.matches);
}

function aplicarTema() {
  const escuro = temaEscuro();
  if (escuro) document.documentElement.dataset.tema = "escuro";
  else delete document.documentElement.dataset.tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", escuro ? "#0f172a" : "#16a34a");
}

function alternarTema() {
  localStorage.setItem(CHAVE_TEMA, temaEscuro() ? "claro" : "escuro");
  aplicarTema();
  render();
}

escuroDoSistema.addEventListener("change", () => {
  aplicarTema();
  render();
});
aplicarTema();

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
  if (!estado.perfil.pendente) carregarRegiao();
}

function sair() {
  rascunho = novoRascunho();
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

const secaoVoce = (r, comPin) => `
  <label>Seu nome <input data-r="nome" required maxlength="40" autocomplete="given-name" value="${esc(r.nome)}"></label>
  ${
    comPin
      ? `<label>PIN de 4 a 8 números (opcional)
          <input data-r="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" value="${esc(r.pin)}"></label>
        <p class="dica">O PIN só impede que outra pessoa abra sua conta neste aparelho.</p>`
      : ""
  }`;

const secaoOnde = (r) => `
  <label>Cidade <input data-r="cidade" required maxlength="60" value="${esc(r.cidade)}"></label>
  <label>Estado (sigla) <input data-r="estado" maxlength="2" value="${esc(r.estado)}"></label>`;

function secaoFamilia(r) {
  const { adultos, criancas } = resumoFamilia(r.membros);
  const cheia = r.membros.length >= MAX_MEMBROS;
  const linhas = r.membros
    .map(
      (m, i) => `
      <div class="membro-linha">
        <span class="avatar">${m.adulto ? "🧑" : "🧒"}</span>
        <input data-m="${i}" data-mc="nome" maxlength="30" placeholder="${m.adulto ? "Nome do adulto" : "Nome da criança"} (opcional)" value="${esc(m.nome)}" aria-label="Nome">
        ${m.adulto ? "" : `<input class="idade" data-m="${i}" data-mc="idade" type="number" min="0" max="17" inputmode="numeric" placeholder="Idade" value="${esc(m.idade)}" aria-label="Idade em anos">`}
        <button type="button" class="remover" data-acao="rem-membro" data-idx="${i}" aria-label="Remover">✕</button>
      </div>`,
    )
    .join("");
  return `
    <div class="membro-linha voce"><span class="avatar">🙋</span><strong>${esc(r.nome.trim() || "Você")}</strong><small>você · adulto</small></div>
    ${linhas}
    <div class="duplo">
      <button type="button" data-acao="add-membro" data-tipo="adulto" ${cheia ? "disabled" : ""}>➕ Adulto</button>
      <button type="button" data-acao="add-membro" data-tipo="crianca" ${cheia ? "disabled" : ""}>➕ Criança</button>
    </div>
    <p class="dica">${adultos} adulto(s) e ${criancas.length} criança(s). Crianças e adolescentes de 0 a 17 anos: a idade ajusta as quantidades.</p>`;
}

function secaoRestricoes(r) {
  const marcadas = new Set(r.restricoes);
  return `
    <fieldset>
      <legend>Alguém da família tem restrição alimentar?</legend>
      ${Object.entries(RESTRICOES)
        .map(([id, nome]) => `<label class="marcar"><input type="checkbox" data-r="restricao" value="${id}" ${marcadas.has(id) ? "checked" : ""}><span>${esc(nome)}</span></label>`)
        .join("")}
    </fieldset>
    <label>Outras restrições (só para lembrar, não altera a lista)
      <input data-r="outras" maxlength="120" value="${esc(r.outras)}"></label>`;
}

function htmlCadastro() {
  return `
    <h1>Criar conta</h1>
    <form data-form="cadastro" class="cartao" novalidate>
      <h2>👋 Como podemos te chamar?</h2>
      ${secaoVoce(rascunho, true)}
      ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
      <button class="primario" type="submit">Criar conta</button>
    </form>
    ${contas.length ? '<button type="button" data-tela="entrar">Já tenho conta</button>' : ""}
    <p class="dica">Seus dados ficam salvos só neste aparelho.</p>`;
}

// Depois de criar a conta: local, família e alimentação, em passos
function htmlFamilia(r) {
  const ultimo = PASSOS_FAMILIA.length - 1;
  const corpo = [
    () => `<h2>📍 Onde você faz suas compras?</h2>${secaoOnde(r)}`,
    () => `<h2>👨‍👩‍👧 Quem faz parte da sua família?</h2>${secaoFamilia(r)}`,
    () => `<h2>🥗 Restrições alimentares</h2>${secaoRestricoes(r)}`,
  ][r.passo]();
  return `
    <h1>Olá, ${esc(r.nome)}!</h1>
    <p class="dica">Vamos conhecer sua família · Passo ${r.passo + 1} de ${PASSOS_FAMILIA.length} · ${PASSOS_FAMILIA[r.passo]}</p>
    <div class="barra"><div style="width:${((r.passo + 1) / PASSOS_FAMILIA.length) * 100}%"></div></div>
    <form data-form="onboarding" class="cartao" novalidate>
      ${corpo}
      ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
      <button class="primario" type="submit">${r.passo === ultimo ? "Concluir ✔" : "Próximo ➜"}</button>
      ${r.passo > 0 ? '<button type="button" data-acao="voltar">⬅ Voltar</button>' : ""}
    </form>
    <button type="button" class="link" data-acao="sair">Sair da conta</button>`;
}

function htmlPerfil() {
  const r = rascunho;
  return `
    <h1>👤 Perfil</h1>
    <form data-form="perfil" novalidate>
      <section class="cartao"><h2>👤 Você</h2>${secaoVoce(r, false)}</section>
      <section class="cartao"><h2>📍 Onde você compra</h2>${secaoOnde(r)}</section>
      <section class="cartao"><h2>👨‍👩‍👧 Sua família</h2>${secaoFamilia(r)}</section>
      <section class="cartao"><h2>🥗 Alimentação</h2>${secaoRestricoes(r)}</section>
      <details class="cartao"><summary>Avançado</summary>
        <label>URL do proxy de preços online (opcional)
          <input data-r="proxy" type="url" placeholder="https://seu-worker.workers.dev" value="${esc(r.proxy)}"></label>
        <p class="dica">Sem proxy os preços online ficam desligados e você informa o preço da prateleira. Veja o README.</p>
      </details>
      ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
      <button class="primario" type="submit">Salvar</button>
    </form>
    <p class="dica">Para refazer a lista com a família atualizada, use a aba Compra.</p>
    <button type="button" data-acao="sair">Sair da conta</button>
    <button type="button" class="perigo" data-acao="apagar">Apagar esta conta e seus dados</button>`;
}

function htmlCompra() {
  const { perfil, compra } = estado;
  const restricoes = perfil.restricoes.map((r) => RESTRICOES[r]).filter(Boolean);
  return `
    <h1>💰 Nova compra</h1>
    <p>Olá, ${esc(perfil.nome)}! 👨‍👩‍👧 Família: ${esc(descreverFamilia(perfil.nome, perfil.membros))}.
      ${restricoes.length ? `Restrições: ${esc(restricoes.join(", "))}.` : ""}</p>
    <form data-form="compra" class="cartao">
      <label>Quanto você quer e pode gastar? (R$) — 0 = sem limite
        <input name="orcamento" type="number" min="0" step="0.01" inputmode="decimal" required value="${compra.orcamento}"></label>
      <label>Compra para quanto tempo?
        <select name="dias">${[[7, "1 semana"], [15, "15 dias"], [30, "1 mês"]]
          .map(([d, nome]) => `<option value="${d}" ${compra.dias === d ? "selected" : ""}>${nome}</option>`)
          .join("")}</select></label>
      <p class="dica">A lista é montada primeiro com alimentação básica e limpeza e higiene, depois os opcionais. O orçamento não aumenta as quantidades; sugestões de economia dependem de preços reais comparáveis. Os preços da lista são estimativas até você informar o valor da prateleira ou haver preço online.</p>
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
  const itensAtivos = estado.lista.filter(itemAtivo);
  const precosReaisCompletos =
    itensAtivos.length > 0 &&
    itensAtivos.every((item) => {
      const { preco, origem } = precoDoItem(estado.mercado, item, true);
      return preco !== null && origem !== "preço estimado";
    });
  const estimativa = itensAtivos.some(
    (item) => precoDoItem(estado.mercado, item, true).origem === "preço estimado",
  )
    ? "Estimativa com preços de referência"
    : "Estimativa parcial";
  const pct = Math.min(100, (previsto / orcamento) * 100);
  let resultado;
  if (previsto <= orcamento) {
    resultado = precosReaisCompletos
      ? `<p class="ok">Total pelos preços informados: ${brl(previsto)} de ${brl(orcamento)}. Sobram ${brl(orcamento - previsto)}.</p>`
      : `<p class="ok">${estimativa}: ${brl(previsto)} de ${brl(orcamento)}. A economia real depende dos preços atualizados dos supermercados.</p>`;
  } else {
    resultado = precosReaisCompletos
      ? `<p class="erro">Total pelos preços informados: ${brl(previsto)} — ${brl(previsto - orcamento)} acima do orçamento.</p>`
      : `<p class="erro">${estimativa}: ${brl(previsto)} — acima do orçamento. Aguarde preços reais para avaliar onde economizar.</p>`;
    if (precosReaisCompletos) {
      const plano = ajustarAoOrcamento(
        itensAtivos.map((i) => ({
          id: i.id,
          produto: i.produto,
          prioridade: i.prioridade,
          categoria: i.categoria,
          quantidade: i.quantidade,
          preco: precoDoItem(estado.mercado, i, true).preco,
          comprado: i.comprado,
        })),
        orcamento,
      );
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
          '<p class="dica">Não há o que reduzir: itens essenciais com quantidade 1 já ultrapassam o orçamento.</p>';
      }
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
        ${
          item.categoria === "limpeza"
            ? '<p class="dica">Item essencial — limpeza e higiene não podem ser adiadas pelo ajuste do orçamento.</p>'
            : `<label>Prioridade (usada no ajuste do orçamento)
                <select data-campo="prioridade" data-id="${item.id}">
                  ${PRIORIDADES.map((p) => `<option ${p === item.prioridade ? "selected" : ""}>${p}</option>`).join("")}
                </select></label>`
        }
        <label class="marcar"><input type="checkbox" data-campo="adiado" data-id="${item.id}" ${item.adiado ? "checked" : ""}>
          <span>Adiar para outra compra</span></label>
        <label>Preço na prateleira (R$) — 0 usa o preço online
          <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="preco" data-id="${item.id}" value="${item.preco}"></label>
        <button class="perigo" data-acao="remover" data-id="${item.id}">🗑️ Remover da lista</button>
      </details>
    </article>`;
}

function htmlSugerida() {
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

function totaisManual() {
  const orcamento = estado.compra.orcamento;
  const comprados = estado.manual.filter((i) => i.comprado);
  const gasto = comprados.reduce((s, i) => s + i.preco * i.quantidade, 0);
  return {
    orcamento,
    gasto,
    restante: orcamento - gasto,
    semPreco: comprados.filter((i) => !(i.preco > 0)).length,
    pendentes: estado.manual.length - comprados.length,
  };
}

function htmlItemManual(item) {
  const subtotal = item.preco > 0 ? ` = ${brl(item.preco * item.quantidade)}` : "";
  return `
    <article class="item ${item.comprado ? "feito" : ""}">
      <label class="marcar"><input type="checkbox" data-campo="m-comprado" data-id="${item.id}" ${item.comprado ? "checked" : ""}>
        <span>${esc(item.produto)}</span></label>
      <div class="sub">${item.quantidade} × ${item.preco > 0 ? brl(item.preco) : "sem preço"}${subtotal}</div>
      <div class="linha-manual">
        <label>Quantidade
          <input type="number" min="1" step="1" inputmode="numeric" data-campo="m-quantidade" data-id="${item.id}" value="${item.quantidade}"></label>
        <label>Preço unitário (R$)
          <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="m-preco" data-id="${item.id}" value="${item.preco || ""}" placeholder="0,00"></label>
      </div>
      <button class="perigo" data-acao="m-remover" data-id="${item.id}">🗑️ Remover</button>
    </article>`;
}

function htmlManual() {
  const t = totaisManual();
  const limite = t.orcamento > 0;
  const pct = limite ? Math.min(100, (t.gasto / t.orcamento) * 100) : 0;
  const estourou = limite && t.gasto > t.orcamento;
  return `
    <form data-form="adicionar-manual" class="adicionar">
      <input name="produto" placeholder="Produto, ex.: Café 500g" maxlength="80" autocomplete="off" required>
      <button class="primario" type="submit">➕</button>
    </form>
    ${aviso ? `<p class="erro">${esc(aviso)}</p>` : ""}
    <div class="cartao">
      <label>💰 Orçamento desta compra (R$) — 0 = sem limite
        <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="orcamento" value="${t.orcamento}"></label>
      ${limite ? `<div class="barra"><div style="width:${pct}%" class="${estourou ? "estouro" : ""}"></div></div>` : ""}
      <div class="metricas tres">
        <div><small>Orçamento</small><strong>${limite ? brl(t.orcamento) : "sem limite"}</strong></div>
        <div><small>Gasto até agora</small><strong>${brl(t.gasto)}</strong></div>
        <div class="${estourou ? "alerta" : ""}"><small>${estourou ? "Passou" : "Resta"}</small><strong>${limite ? brl(Math.abs(t.restante)) : "—"}</strong></div>
      </div>
      ${estourou ? `<p class="erro">Você ultrapassou o orçamento em ${brl(t.gasto - t.orcamento)}.</p>` : ""}
      ${t.semPreco ? `<p class="dica">${t.semPreco} item(ns) marcado(s) como comprado(s) sem preço — informe o valor para entrar na soma.</p>` : ""}
    </div>
    ${estado.manual.map(htmlItemManual).join("")}
    ${estado.manual.some((i) => i.comprado) ? '<button data-acao="m-limpar">Limpar itens comprados</button>' : ""}
    ${estado.manual.length ? "" : '<p class="dica">Adicione os produtos, informe o preço da prateleira e marque como comprado: o total é somado automaticamente.</p>'}`;
}

function htmlLista() {
  const aba = estado.aba;
  return `
    <div class="abas">
      <button data-aba="sugerida" class="${aba === "sugerida" ? "ativo" : ""}">📋 Lista sugerida</button>
      <button data-aba="manual" class="${aba === "manual" ? "ativo" : ""}">✍️ Lista manual</button>
    </div>
    ${aba === "manual" ? htmlManual() : htmlSugerida()}`;
}

function htmlMercados() {
  const comp = comparativo();
  const consultaveis = new Set(comp.map((c) => c.rede.nome));
  const outros = regiao.mercados.filter((m) => !consultaveis.has(m.rede.nome));
  const completos = comp.filter((c) => c.faltando === 0);
  const economia =
    completos.length >= 2
      ? [...completos].sort((a, b) => a.total - b.total)
      : [];
  const melhorPreco = economia[0];
  const piorPreco = economia[economia.length - 1];
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
      ${
        economia.length >= 2 && piorPreco.total > melhorPreco.total
          ? `<p class="ok">Pelos preços online disponíveis, a lista fica ${brl(piorPreco.total - melhorPreco.total)} mais barata em ${esc(melhorPreco.rede.nome)} (${melhorPreco.loja.distanciaKm.toFixed(1)} km) do que em ${esc(piorPreco.rede.nome)}. Comparação válida porque todos os itens têm preço.</p>`
          : ""
      }
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

const botaoTema = () =>
  `<button class="tema" data-acao="tema" aria-label="Alternar tema claro/escuro">${temaEscuro() ? "☀️" : "🌙"}</button>`;

function render() {
  const raiz = document.getElementById("app");
  const rolagem = window.scrollY;
  if (!sessao) {
    raiz.innerHTML = `${botaoTema()}<div class="tela">${tela === "cadastro" || !contas.length ? htmlCadastro() : htmlEntrar()}</div>`;
    window.scrollTo(0, rolagem);
    return;
  }
  if (tela === "entrar" || tela === "cadastro") tela = "compra";
  if (estado.perfil.pendente) {
    if (!rascunho.onboarding) {
      rascunho = novoRascunho(estado.perfil);
      rascunho.onboarding = true;
    }
    raiz.innerHTML = `${botaoTema()}<div class="tela">${htmlFamilia(rascunho)}</div>`;
    window.scrollTo(0, rolagem);
    return;
  }
  const conteudo =
    tela === "mercados"
      ? htmlMercados()
      : tela === "perfil"
        ? htmlPerfil()
        : tela === "compra"
          ? htmlCompra()
          : `<h1>🛒 Lista de Compras</h1>${htmlLista()}`;
  raiz.innerHTML = `
    ${botaoTema()}
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
      categoria: i.categoria,
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
  estado.aba = "sugerida";
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
}

function numero(valor, minimo, inteiro) {
  const n = Number.parseFloat(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) return minimo;
  return Math.max(minimo, inteiro ? Math.round(n) : n);
}

const app = document.getElementById("app");

app.addEventListener("input", (e) => {
  const alvo = e.target;
  if (alvo.dataset.m !== undefined) {
    const membro = rascunho.membros[Number(alvo.dataset.m)];
    if (membro) membro[alvo.dataset.mc] = alvo.value;
    if (alvo.dataset.mc === "idade") alvo.value = alvo.value.slice(0, 2);
    return;
  }
  const campo = alvo.dataset.r;
  if (!campo) return;
  if (campo === "restricao") {
    const sem = rascunho.restricoes.filter((x) => x !== alvo.value);
    rascunho.restricoes = alvo.checked ? [...sem, alvo.value] : sem;
  } else {
    rascunho[campo] = alvo.value;
  }
});

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
  } else if (tipo === "adicionar-manual") {
    const nome = dados.produto.trim().slice(0, 80);
    if (!nome) return;
    if (estado.manual.some((i) => i.produto.toLowerCase() === nome.toLowerCase())) {
      aviso = "Esse produto já está na lista manual.";
    } else {
      aviso = "";
      estado.manual.push({ id: `m${estado.proximoId++}`, produto: nome, quantidade: 1, preco: 0, comprado: false });
    }
    salvar();
    render();
    document.querySelector('[name="produto"]')?.focus();
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
    aviso = validarRascunho(rascunho, 0);
    if (aviso) {
      render();
      return;
    }
    const perfil = { ...montarPerfil(rascunho), cidade: "", estado: "MG", pendente: true };
    const sal = crypto.randomUUID();
    const conta = { id: `u${Date.now().toString(36)}`, nome: perfil.nome, sal, hash: rascunho.pin ? await hashPin(rascunho.pin, sal) : null };
    contas.push(conta);
    salvarContas();
    sessao = conta.id;
    localStorage.setItem(CHAVE_SESSAO, sessao);
    estado = { ...PADRAO, perfil };
    salvar();
    rascunho = novoRascunho();
    aviso = "";
    info = "";
    tela = "compra";
    render();
  } else if (tipo === "onboarding") {
    aviso = validarRascunho(rascunho, rascunho.passo + 1);
    if (!aviso && rascunho.passo < PASSOS_FAMILIA.length - 1) {
      rascunho.passo += 1;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (aviso) {
      render();
      return;
    }
    estado.perfil = montarPerfil(rascunho);
    salvar();
    rascunho = novoRascunho();
    tela = "compra";
    render();
    carregarRegiao();
  } else if (tipo === "perfil") {
    aviso = validarRascunho(rascunho);
    if (aviso) {
      render();
      return;
    }
    const anterior = estado.perfil;
    estado.perfil = montarPerfil(rascunho);
    const conta = contas.find((c) => c.id === sessao);
    if (conta) {
      conta.nome = estado.perfil.nome;
      salvarContas();
    }
    const proxyAnterior = estado.proxy;
    estado.proxy = rascunho.proxy.trim();
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
  const manual = campo.startsWith("m-") ? estado.manual.find((i) => i.id === alvo.dataset.id) : null;
  if (campo.startsWith("m-") && !manual) return;
  switch (campo) {
    case "m-comprado":
      manual.comprado = alvo.checked;
      break;
    case "m-quantidade":
      manual.quantidade = numero(alvo.value, 1, true);
      break;
    case "m-preco":
      manual.preco = numero(alvo.value, 0, false);
      break;
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
      item.prioridade = item.categoria === "limpeza" ? "Essencial" : alvo.value;
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
  if (botao.dataset.aba) {
    estado.aba = botao.dataset.aba;
    aviso = "";
    salvar();
    render();
    return;
  }
  if (botao.dataset.acao === "tema") {
    alternarTema();
    return;
  }
  if (botao.dataset.tela) {
    tela = botao.dataset.tela;
    aviso = "";
    if (tela === "cadastro") rascunho = novoRascunho();
    if (tela === "perfil") rascunho = novoRascunho(estado.perfil, estado.proxy);
    render();
    window.scrollTo(0, 0);
    return;
  }
  switch (botao.dataset.acao) {
    case "add-membro":
      if (rascunho.membros.length < MAX_MEMBROS) rascunho.membros.push(novoMembro(botao.dataset.tipo === "adulto"));
      render();
      {
        const linhas = document.querySelectorAll(".membro-linha:not(.voce)");
        linhas[linhas.length - 1]?.querySelector("input")?.focus();
      }
      return;
    case "rem-membro":
      rascunho.membros.splice(Number(botao.dataset.idx), 1);
      render();
      return;
    case "voltar":
      rascunho.passo = Math.max(0, rascunho.passo - 1);
      aviso = "";
      render();
      window.scrollTo(0, 0);
      return;
    case "remover":
      estado.lista = estado.lista.filter((i) => i.id !== botao.dataset.id);
      abertos.delete(botao.dataset.id);
      break;
    case "m-remover":
      estado.manual = estado.manual.filter((i) => i.id !== botao.dataset.id);
      break;
    case "m-limpar":
      estado.manual = estado.manual.filter((i) => !i.comprado);
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
if (estado.perfil && !estado.perfil.pendente) carregarRegiao();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
