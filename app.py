import json
from concurrent.futures import ThreadPoolExecutor

import streamlit as st

import localizacao
import precos
from orcamento import PRIORIDADES, ajustar_ao_orcamento

try:
    from streamlit_geolocation import streamlit_geolocation
except ImportError:
    streamlit_geolocation = None

st.set_page_config(
    page_title="Lista de Compras",
    page_icon="🛒",
    layout="centered",
    initial_sidebar_state="collapsed",
)
st.markdown(
    "<style>.block-container{padding-top:1.5rem;padding-bottom:3rem}</style>",
    unsafe_allow_html=True,
)


def brl(valor):
    texto = f"{valor:,.2f}"
    return "R$ " + texto.replace(",", "X").replace(".", ",").replace("X", ".")


@st.cache_data(ttl=3600, show_spinner=False)
def geocodificar(cidade, estado):
    return localizacao.geocodificar_cidade(cidade, estado)


@st.cache_data(ttl=3600, show_spinner=False)
def supermercados_proximos(lat, lon, raio_km):
    return localizacao.buscar_supermercados(lat, lon, raio_km)


def mercados_da_regiao(lojas):
    """Agrupa as lojas encontradas por rede conhecida, mantendo a mais próxima."""
    mercados = {}
    for loja in lojas:
        rede = precos.identificar_rede(loja["nome"])
        if rede and rede["nome"] not in mercados:
            mercados[rede["nome"]] = {"rede": rede, "loja": loja}
    return sorted(mercados.values(), key=lambda m: m["loja"]["distancia_km"])


# --- LISTA (guardada na URL para sobreviver a recarregamentos no celular) ---
def registrar_item(
    produto,
    quantidade=1,
    comprado=False,
    preco_manual=0.0,
    prioridade="Normal",
    adiado=False,
):
    novo_id = f"i{st.session_state['proximo_id']}"
    st.session_state["proximo_id"] += 1
    st.session_state["lista"].append({"id": novo_id, "produto": produto})
    st.session_state[f"c_{novo_id}"] = comprado
    st.session_state[f"q_{novo_id}"] = quantidade
    st.session_state[f"v_{novo_id}"] = preco_manual
    st.session_state[f"p_{novo_id}"] = prioridade
    st.session_state[f"a_{novo_id}"] = adiado


def carregar_lista_da_url():
    try:
        bruto = json.loads(st.query_params.get("lista", "[]"))
    except ValueError:
        return
    if not isinstance(bruto, list):
        return
    for dado in bruto[:100]:
        if not isinstance(dado, dict) or not str(dado.get("p", "")).strip():
            continue
        try:
            quantidade = max(1, int(dado.get("q", 1)))
            preco_manual = max(0.0, float(dado.get("v", 0)))
        except (TypeError, ValueError):
            continue
        prioridade = dado.get("r") if dado.get("r") in PRIORIDADES else "Normal"
        registrar_item(
            str(dado["p"]).strip()[:80],
            quantidade,
            bool(dado.get("c")),
            preco_manual,
            prioridade,
            bool(dado.get("a")),
        )


# --- CADASTRO (guardado na URL; sem senha, apenas neste aparelho/link) ---
def carregar_perfil_da_url():
    try:
        dado = json.loads(st.query_params.get("perfil", "{}"))
        if not isinstance(dado, dict) or not str(dado.get("n", "")).strip():
            return None
        return {
            "nome": str(dado["n"]).strip()[:40],
            "cidade": str(dado.get("c", "")).strip()[:60],
            "estado": str(dado.get("e", "")).strip()[:2].upper(),
            "orcamento": max(0.0, float(dado.get("o", 0))),
        }
    except (ValueError, TypeError):
        return None


def salvar_perfil(perfil):
    st.session_state["perfil"] = perfil
    st.query_params["perfil"] = json.dumps(
        {
            "n": perfil["nome"],
            "c": perfil["cidade"],
            "e": perfil["estado"],
            "o": perfil["orcamento"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def atualizar_orcamento():
    perfil = dict(st.session_state["perfil"])
    perfil["orcamento"] = float(st.session_state.get("orcamento_input", 0.0))
    salvar_perfil(perfil)


def ajustar_lista(mudancas):
    for mudanca in mudancas:
        if mudanca["para"] == 0:
            st.session_state[f"a_{mudanca['id']}"] = True
        else:
            st.session_state[f"q_{mudanca['id']}"] = mudanca["para"]


if "lista" not in st.session_state:
    st.session_state["lista"] = []
    st.session_state["proximo_id"] = 0
    carregar_lista_da_url()


def adicionar_item():
    nome = st.session_state.get("novo_produto", "").strip()[:80]
    lista = st.session_state["lista"]
    if not nome:
        st.session_state["aviso"] = "Digite o nome do produto."
    elif any(i["produto"].casefold() == nome.casefold() for i in lista):
        st.session_state["aviso"] = "Esse produto já está na lista."
    else:
        registrar_item(nome)


def remover_item(item_id):
    st.session_state["lista"] = [
        i for i in st.session_state["lista"] if i["id"] != item_id
    ]


def remover_comprados():
    st.session_state["lista"] = [
        i
        for i in st.session_state["lista"]
        if not st.session_state.get(f"c_{i['id']}", False)
    ]


def itens_com_estado():
    return [
        {
            **item,
            "comprado": st.session_state.get(f"c_{item['id']}", False),
            "quantidade": st.session_state.get(f"q_{item['id']}", 1),
            "preco_manual": st.session_state.get(f"v_{item['id']}", 0.0),
            "prioridade": st.session_state.get(f"p_{item['id']}", "Normal"),
            "adiado": st.session_state.get(f"a_{item['id']}", False),
        }
        for item in st.session_state["lista"]
    ]


def formulario_cadastro(perfil_atual, chave):
    with st.form(chave):
        nome_cad = st.text_input("Seu nome", value=perfil_atual.get("nome", ""))
        cidade_cad = st.text_input("Cidade", value=perfil_atual.get("cidade", "Bom Despacho"))
        estado_cad = st.text_input(
            "Estado (sigla)", value=perfil_atual.get("estado", "MG"), max_chars=2
        )
        orcamento_cad = st.number_input(
            "Quanto você quer e pode gastar nesta compra? (R$) — 0 = sem limite",
            min_value=0.0,
            step=10.0,
            format="%.2f",
            value=float(perfil_atual.get("orcamento", 0.0)),
        )
        enviado = st.form_submit_button("Salvar", type="primary")
    if enviado:
        if not nome_cad.strip() or not cidade_cad.strip():
            st.error("Informe seu nome e sua cidade.")
        else:
            salvar_perfil(
                {
                    "nome": nome_cad.strip()[:40],
                    "cidade": cidade_cad.strip()[:60],
                    "estado": estado_cad.strip()[:2].upper(),
                    "orcamento": float(orcamento_cad),
                }
            )
            st.session_state["orcamento_input"] = float(orcamento_cad)
            st.rerun()


if "perfil" not in st.session_state:
    perfil_salvo = carregar_perfil_da_url()
    if perfil_salvo:
        st.session_state["perfil"] = perfil_salvo

if "perfil" not in st.session_state:
    st.title("👋 Bem-vindo!")
    st.write("Faça seu cadastro para começar a montar suas compras.")
    formulario_cadastro({}, "cadastro_form")
    st.caption(
        "Seus dados ficam salvos apenas no endereço desta página, neste aparelho. "
        "Não há senha nem servidor: favorite o link para manter seu cadastro."
    )
    st.stop()

perfil = st.session_state["perfil"]
st.title("🛒 Lista de Compras")
with st.expander(f"👤 {perfil['nome']} · {perfil['cidade']}/{perfil['estado']}"):
    formulario_cadastro(perfil, "editar_cadastro_form")

# --- LOCALIZAÇÃO ---
coordenadas = None
local_descricao = ""
with st.expander("📍 Onde você está?", expanded="coordenadas" not in st.session_state):
    origem = st.radio(
        "Localizar supermercados por",
        ["Cidade", "Localização do aparelho"],
        horizontal=True,
    )
    raio_km = st.slider("Raio de busca (km)", 2, 30, 10)
    try:
        if origem == "Localização do aparelho":
            if streamlit_geolocation is None:
                st.warning(
                    "Instale `streamlit-geolocation` (pip install -r requirements.txt)."
                )
            else:
                posicao = streamlit_geolocation()
                if posicao and posicao.get("latitude") is not None:
                    coordenadas = (posicao["latitude"], posicao["longitude"])
                    local_descricao = "sua localização"
                else:
                    st.info(
                        "Toque no ícone acima e permita o acesso à localização. "
                        "No celular isso exige que o app esteja em endereço https."
                    )
        else:
            cidade = st.text_input("Cidade", value=perfil["cidade"])
            estado = st.text_input("Estado (sigla)", value=perfil["estado"], max_chars=2)
            if cidade.strip():
                lat, lon, local_descricao = geocodificar(cidade, estado)
                coordenadas = (lat, lon)
    except localizacao.ErroLocalizacao as erro:
        st.error(str(erro))

mercados = []
if coordenadas:
    st.session_state["coordenadas"] = coordenadas
    try:
        with st.spinner("Buscando supermercados na região..."):
            mercados = mercados_da_regiao(supermercados_proximos(*coordenadas, raio_km))
    except localizacao.ErroLocalizacao as erro:
        st.error(str(erro))

# --- PREÇOS ONLINE (consulta automática a cada mudança na lista; com cache) ---
itens = itens_com_estado()
pendentes = [i for i in itens if not i["comprado"] and not i["adiado"]]
consultaveis = [m for m in mercados if precos.tem_consulta_online(m["rede"])]

tarefas = [(m["rede"], i) for m in consultaveis for i in itens]
ofertas = {}
if tarefas:
    with st.spinner("Atualizando preços..."):
        with ThreadPoolExecutor(max_workers=6) as pool:
            respostas = list(
                pool.map(
                    lambda t: precos.consultar_preco_cache(t[0], t[1]["produto"]), tarefas
                )
            )
    for (rede, item), resposta in zip(tarefas, respostas):
        ofertas[(rede["nome"], item["id"])] = resposta


def preco_do_item(nome_rede, item, usar_manual):
    """Retorna (preço unitário ou None, origem)."""
    if usar_manual and item["preco_manual"] > 0:
        return item["preco_manual"], "preço da prateleira"
    oferta, _erro = ofertas.get((nome_rede, item["id"]), (None, None))
    if oferta:
        return oferta["preco"], "preço online"
    return None, ""


comparativo = []
for mercado in consultaveis:
    nome = mercado["rede"]["nome"]
    total, faltando = 0.0, 0
    for item in pendentes:
        preco, _ = preco_do_item(nome, item, usar_manual=False)
        if preco is None:
            faltando += 1
        else:
            total += preco * item["quantidade"]
    comparativo.append({"mercado": mercado, "total": total, "faltando": faltando})
comparativo.sort(key=lambda c: (c["faltando"], c["total"]))

nomes_mercados = [m["rede"]["nome"] for m in mercados]
if st.session_state.get("mercado_selecionado") not in nomes_mercados:
    st.session_state["mercado_selecionado"] = (
        comparativo[0]["mercado"]["rede"]["nome"]
        if comparativo
        else (nomes_mercados[0] if nomes_mercados else None)
    )
mercado_atual = st.session_state["mercado_selecionado"]

aba_lista, aba_mercados = st.tabs(["🛒 Lista", "📊 Mercados"])

# --- ABA LISTA ---
with aba_lista:
    with st.form("adicionar_item_form", clear_on_submit=True):
        st.text_input("Adicionar produto", key="novo_produto", placeholder="Ex.: Café 500g")
        st.form_submit_button("➕ Adicionar", on_click=adicionar_item)
    if st.session_state.get("aviso"):
        st.warning(st.session_state.pop("aviso"))

    if mercado_atual:
        st.caption(f"Comprando em: **{mercado_atual}**")
    elif itens:
        st.caption("Informe sua localização para ver os preços dos mercados.")

    total_falta, total_carrinho, sem_preco = 0.0, 0.0, 0
    for item in itens:
        if item["adiado"]:
            continue
        preco, _ = preco_do_item(mercado_atual, item, usar_manual=True)
        if preco is None:
            if not item["comprado"]:
                sem_preco += 1
            continue
        subtotal = preco * item["quantidade"]
        if item["comprado"]:
            total_carrinho += subtotal
        else:
            total_falta += subtotal

    if itens:
        col_falta, col_carrinho = st.columns(2)
        col_falta.metric("Falta comprar", brl(total_falta))
        col_carrinho.metric("No carrinho", brl(total_carrinho))
        if sem_preco:
            st.caption(
                f"{sem_preco} item(ns) sem preço — abra “Editar” e informe o valor da prateleira."
            )

    # --- ORÇAMENTO ---
    if "orcamento_input" not in st.session_state:
        st.session_state["orcamento_input"] = perfil["orcamento"]
    st.number_input(
        "💰 Quanto posso gastar (R$) — 0 = sem limite",
        min_value=0.0,
        step=10.0,
        format="%.2f",
        key="orcamento_input",
        on_change=atualizar_orcamento,
    )
    orcamento = perfil["orcamento"]
    if orcamento > 0 and itens:
        previsto = total_carrinho + total_falta
        st.progress(min(previsto / orcamento, 1.0))
        if previsto <= orcamento:
            st.success(
                f"Previsto: {brl(previsto)} de {brl(orcamento)}. "
                f"Sobram {brl(orcamento - previsto)}."
            )
        else:
            st.error(
                f"Previsto: {brl(previsto)} — {brl(previsto - orcamento)} acima do orçamento."
            )
            plano = ajustar_ao_orcamento(
                [
                    {
                        "id": i["id"],
                        "produto": i["produto"],
                        "prioridade": i["prioridade"],
                        "quantidade": i["quantidade"],
                        "preco": preco_do_item(mercado_atual, i, usar_manual=True)[0],
                        "comprado": i["comprado"],
                    }
                    for i in itens
                    if not i["adiado"]
                ],
                orcamento,
            )
            if plano["mudancas"]:
                with st.container(border=True):
                    st.write("**Ajuste sugerido** (começa pelos itens opcionais):")
                    for m in plano["mudancas"]:
                        acao = "adiar para outra compra" if m["para"] == 0 else f"{m['de']} → {m['para']}"
                        st.write(f"- {m['produto']}: {acao}")
                    if plano["cabe"]:
                        st.caption(f"Com o ajuste o total fica em {brl(plano['total'])}.")
                    else:
                        st.caption(
                            f"Mesmo assim o total é {brl(plano['total'])}: os itens "
                            "essenciais ultrapassam o orçamento."
                        )
                    st.button(
                        "✅ Aplicar ajuste",
                        on_click=ajustar_lista,
                        args=(plano["mudancas"],),
                    )
            else:
                st.caption(
                    "Não há o que reduzir: itens essenciais com quantidade 1 já "
                    "ultrapassam o orçamento, ou faltam preços."
                )

    for item in itens:
        item_id = item["id"]
        preco, origem = preco_do_item(mercado_atual, item, usar_manual=True)
        with st.container(border=True):
            st.checkbox(item["produto"], key=f"c_{item_id}")
            if item["adiado"]:
                st.caption("⏸️ Adiado — fora desta compra")
            elif preco is not None:
                st.caption(
                    f"{item['quantidade']} × {brl(preco)} = "
                    f"{brl(preco * item['quantidade'])} · {origem}"
                )
            else:
                st.caption("Sem preço encontrado")
            with st.expander("Editar"):
                st.number_input("Quantidade", min_value=1, step=1, key=f"q_{item_id}")
                st.selectbox(
                    "Prioridade (usada no ajuste do orçamento)",
                    PRIORIDADES,
                    key=f"p_{item_id}",
                )
                st.checkbox("Adiar para outra compra", key=f"a_{item_id}")
                st.number_input(
                    "Preço na prateleira (R$) — 0 usa o preço online",
                    min_value=0.0,
                    step=0.1,
                    format="%.2f",
                    key=f"v_{item_id}",
                )
                st.button(
                    "🗑️ Remover da lista",
                    key=f"remover_{item_id}",
                    on_click=remover_item,
                    args=(item_id,),
                )

    if any(i["comprado"] for i in itens):
        st.button("Limpar itens comprados", on_click=remover_comprados)
    if not itens:
        st.info("Sua lista está vazia. Adicione um produto acima.")
    st.caption(
        "Os preços online podem diferir da loja física. Confira na prateleira e, "
        "se mudar, informe o valor em “Editar”. A lista fica salva no endereço "
        "da página: adicione-o aos favoritos para não perdê-la."
    )

# --- ABA MERCADOS ---
with aba_mercados:
    if not mercados:
        st.info("Informe sua cidade ou localização em “Onde você está?”.")
    else:
        st.caption(f"Perto de {local_descricao}")
        if not pendentes:
            st.info("Não há itens pendentes para comparar.")
        linhas = [
            {
                "Mercado": c["mercado"]["rede"]["nome"],
                "Distância": f"{c['mercado']['loja']['distancia_km']:.1f} km",
                "Total": brl(c["total"]),
                "Sem preço": c["faltando"],
            }
            for c in comparativo
        ] + [
            {
                "Mercado": m["rede"]["nome"],
                "Distância": f"{m['loja']['distancia_km']:.1f} km",
                "Total": "sem consulta online",
                "Sem preço": "—",
            }
            for m in mercados
            if m not in consultaveis
        ]
        if pendentes:
            st.dataframe(linhas, hide_index=True, width="stretch")
        if not consultaveis:
            st.warning(
                "Nenhuma rede encontrada tem consulta online configurada. Você "
                "ainda pode escolher o mercado e informar os preços da prateleira."
            )
        st.selectbox("Onde você vai comprar?", nomes_mercados, key="mercado_selecionado")

st.query_params["lista"] = json.dumps(
    [
        {
            "p": i["produto"],
            "q": i["quantidade"],
            "c": i["comprado"],
            "v": i["preco_manual"],
            "r": i["prioridade"],
            "a": i["adiado"],
        }
        for i in itens
    ],
    ensure_ascii=False,
    separators=(",", ":"),
)
