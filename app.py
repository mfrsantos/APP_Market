from concurrent.futures import ThreadPoolExecutor

import streamlit as st

import localizacao
import precos

try:
    from streamlit_geolocation import streamlit_geolocation
except ImportError:
    streamlit_geolocation = None

st.set_page_config(
    page_title="Comparador de Preços de Supermercado", page_icon="🛒", layout="wide"
)

PRODUTOS_INICIAIS = ["Arroz 5kg", "Feijão 1kg", "Leite 1L", "Óleo de Soja 900ml"]


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


st.title("🛒 Comparador Inteligente de Compras")
st.write(
    "Encontre os supermercados da sua região, monte a lista e acompanhe o "
    "custo no mercado escolhido."
)

# --- LOCALIZAÇÃO ---
st.sidebar.header("1. Localização")
origem = st.sidebar.radio(
    "Como localizar os supermercados?",
    ["Informar cidade", "Usar localização do aparelho"],
)
raio_km = st.sidebar.slider("Raio de busca (km)", 2, 30, 10)

coordenadas = None
local_descricao = ""
try:
    if origem == "Usar localização do aparelho":
        if streamlit_geolocation is None:
            st.sidebar.warning(
                "Instale o pacote `streamlit-geolocation` (pip install -r "
                "requirements.txt) para usar a localização do aparelho."
            )
        else:
            with st.sidebar:
                posicao = streamlit_geolocation()
            if posicao and posicao.get("latitude") is not None:
                coordenadas = (posicao["latitude"], posicao["longitude"])
                local_descricao = "sua localização atual"
            else:
                st.sidebar.info(
                    "Clique no ícone acima e permita o acesso à localização no navegador."
                )
    else:
        cidade_usuario = st.sidebar.text_input("Cidade", value="Bom Despacho")
        estado_usuario = st.sidebar.text_input("Estado (sigla)", value="MG", max_chars=2)
        if cidade_usuario.strip():
            lat, lon, nome_local = geocodificar(cidade_usuario, estado_usuario)
            coordenadas = (lat, lon)
            local_descricao = nome_local
except localizacao.ErroLocalizacao as erro:
    st.sidebar.error(str(erro))

mercados = []
if coordenadas:
    try:
        with st.spinner("Buscando supermercados na região..."):
            lojas = supermercados_proximos(*coordenadas, raio_km)
        mercados = mercados_da_regiao(lojas)
    except localizacao.ErroLocalizacao as erro:
        st.sidebar.error(str(erro))

if coordenadas and not mercados:
    st.warning(
        "Nenhuma rede conhecida foi encontrada nesse raio. Aumente o raio de "
        "busca ou tente outra cidade."
    )
    st.stop()
if not coordenadas:
    st.info("Informe uma cidade ou permita a localização do aparelho para começar.")
    st.stop()

st.sidebar.success(f"{len(mercados)} rede(s) encontrada(s) perto de {local_descricao}.")

# --- LISTA DE COMPRAS ---
if "lista_compras" not in st.session_state:
    st.session_state["lista_compras"] = [
        {"id": f"inicial-{i}", "produto": produto, "quantidade": 1, "comprado": False}
        for i, produto in enumerate(PRODUTOS_INICIAIS)
    ]
    st.session_state["proximo_item_id"] = len(PRODUTOS_INICIAIS)
    for item in st.session_state["lista_compras"]:
        st.session_state[f"comprado_{item['id']}"] = False
        st.session_state[f"quantidade_{item['id']}"] = 1

st.subheader("📝 Sua lista de compras")
with st.form("adicionar_item_form", clear_on_submit=True):
    novo_produto = st.text_input("Adicionar produto", placeholder="Ex.: Café 500g")
    adicionar_item = st.form_submit_button("Adicionar à lista")

if adicionar_item:
    nome = novo_produto.strip()
    itens_atuais = st.session_state["lista_compras"]
    if not nome:
        st.warning("Digite o nome do produto que deseja adicionar.")
    elif any(item["produto"].casefold() == nome.casefold() for item in itens_atuais):
        st.warning("Esse produto já está na lista. Altere a quantidade no próprio item.")
    else:
        item_id = st.session_state["proximo_item_id"]
        novo_id = f"personalizado-{item_id}"
        itens_atuais.append(
            {"id": novo_id, "produto": nome, "quantidade": 1, "comprado": False}
        )
        st.session_state[f"comprado_{novo_id}"] = False
        st.session_state[f"quantidade_{novo_id}"] = 1
        st.session_state["proximo_item_id"] = item_id + 1

itens_removidos = []
for item in st.session_state["lista_compras"]:
    col_comprado, col_produto, col_qtd, col_remover = st.columns([0.8, 3, 1, 0.8])
    item["comprado"] = col_comprado.checkbox("Comprado", key=f"comprado_{item['id']}")
    col_produto.write(item["produto"])
    item["quantidade"] = col_qtd.number_input(
        "Qtd.", min_value=1, step=1, key=f"quantidade_{item['id']}"
    )
    if col_remover.button("Remover", key=f"remover_{item['id']}"):
        itens_removidos.append(item["id"])

if itens_removidos:
    st.session_state["lista_compras"] = [
        item
        for item in st.session_state["lista_compras"]
        if item["id"] not in itens_removidos
    ]
    st.rerun()

if not st.session_state["lista_compras"]:
    st.info("Sua lista está vazia. Adicione um produto para começar.")
    st.stop()

itens_pendentes = [i for i in st.session_state["lista_compras"] if not i["comprado"]]
if not itens_pendentes:
    st.success("Todos os produtos da lista foram marcados como comprados.")
    st.stop()

# --- PREÇOS (consulta automática a cada mudança na lista; resultados em cache) ---
consultaveis = [m for m in mercados if precos.tem_consulta_online(m["rede"])]
sem_consulta = [m for m in mercados if not precos.tem_consulta_online(m["rede"])]

tarefas = [(m, item) for m in consultaveis for item in itens_pendentes]
with st.spinner("Atualizando preços..."):
    with ThreadPoolExecutor(max_workers=6) as pool:
        respostas = list(
            pool.map(
                lambda t: precos.consultar_preco_cache(t[0]["rede"], t[1]["produto"]),
                tarefas,
            )
        )

resultados = {}
for (mercado, item), (oferta, erro) in zip(tarefas, respostas):
    rede_nome = mercado["rede"]["nome"]
    dados = resultados.setdefault(
        rede_nome, {"mercado": mercado, "linhas": [], "total": 0.0, "faltando": 0}
    )
    if oferta:
        subtotal = oferta["preco"] * item["quantidade"]
        dados["total"] += subtotal
        dados["linhas"].append(
            {
                "Produto": item["produto"],
                "Encontrado como": oferta["descricao"],
                "Marca": oferta["marca"],
                "Quantidade": item["quantidade"],
                "Preço Unitário": f"R$ {oferta['preco']:.2f}",
                "Subtotal": f"R$ {subtotal:.2f}",
            }
        )
    else:
        dados["faltando"] += 1
        dados["linhas"].append(
            {
                "Produto": item["produto"],
                "Encontrado como": "Erro na consulta" if erro else "Não encontrado",
                "Marca": "",
                "Quantidade": item["quantidade"],
                "Preço Unitário": "—",
                "Subtotal": "—",
            }
        )

st.subheader("📊 Supermercados da região")
quadro = [
    {
        "Supermercado": nome,
        "Tipo": d["mercado"]["rede"]["categoria"],
        "Distância": f"{d['mercado']['loja']['distancia_km']:.1f} km",
        "Custo Total": f"R$ {d['total']:.2f}",
        "Itens sem preço": d["faltando"],
    }
    for nome, d in sorted(
        resultados.items(), key=lambda par: (par[1]["faltando"], par[1]["total"])
    )
]
quadro += [
    {
        "Supermercado": m["rede"]["nome"],
        "Tipo": m["rede"]["categoria"],
        "Distância": f"{m['loja']['distancia_km']:.1f} km",
        "Custo Total": "Sem consulta online",
        "Itens sem preço": "—",
    }
    for m in sem_consulta
]
st.dataframe(quadro, hide_index=True)

if not resultados:
    st.warning(
        "Nenhuma das redes encontradas tem consulta online de preços configurada "
        "ainda. Configure o `dominio` delas em `precos.py`."
    )
    st.stop()

# --- MERCADO ESCOLHIDO ---
st.subheader("🛒 Onde você vai comprar?")
opcoes = list(resultados)
if st.session_state.get("mercado_selecionado") not in opcoes:
    st.session_state["mercado_selecionado"] = opcoes[0]
escolhido = st.selectbox(
    "Selecione o mercado para acompanhar sua compra", opcoes, key="mercado_selecionado"
)
dados = resultados[escolhido]
st.success(f"Total atualizado no **{escolhido}**: R$ {dados['total']:.2f}")
if dados["faltando"]:
    st.warning(
        f"{dados['faltando']} item(ns) sem preço encontrado nesse mercado; "
        "não entram no total. Tente um nome de produto mais simples."
    )
st.dataframe(dados["linhas"], hide_index=True)
st.caption(
    "Preços consultados na loja virtual da rede e mantidos por 30 minutos. Podem "
    "diferir dos valores da loja física da sua cidade; confirme antes de comprar. "
    "Itens novos são consultados automaticamente."
)
