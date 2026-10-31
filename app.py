import json
from concurrent.futures import ThreadPoolExecutor

import streamlit as st

import localizacao
import precos

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
def registrar_item(produto, quantidade=1, comprado=False, preco_manual=0.0):
    novo_id = f"i{st.session_state['proximo_id']}"
    st.session_state["proximo_id"] += 1
    st.session_state["lista"].append({"id": novo_id, "produto": produto})
    st.session_state[f"c_{novo_id}"] = comprado
    st.session_state[f"q_{novo_id}"] = quantidade
    st.session_state[f"v_{novo_id}"] = preco_manual


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
        registrar_item(
            str(dado["p"]).strip()[:80], quantidade, bool(dado.get("c")), preco_manual
        )


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
        }
        for item in st.session_state["lista"]
    ]


st.title("🛒 Lista de Compras")

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
            cidade = st.text_input("Cidade", value="Bom Despacho")
            estado = st.text_input("Estado (sigla)", value="MG", max_chars=2)
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
pendentes = [i for i in itens if not i["comprado"]]
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

    for item in itens:
        item_id = item["id"]
        preco, origem = preco_do_item(mercado_atual, item, usar_manual=True)
        with st.container(border=True):
            st.checkbox(item["produto"], key=f"c_{item_id}")
            if preco is not None:
                st.caption(
                    f"{item['quantidade']} × {brl(preco)} = "
                    f"{brl(preco * item['quantidade'])} · {origem}"
                )
            else:
                st.caption("Sem preço encontrado")
            with st.expander("Editar"):
                st.number_input("Quantidade", min_value=1, step=1, key=f"q_{item_id}")
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
        }
        for i in itens
    ],
    ensure_ascii=False,
    separators=(",", ":"),
)
