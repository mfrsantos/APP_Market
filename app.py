import streamlit as st

# Configuração da página do aplicativo
st.set_page_config(
    page_title="Comparador de Preços de Supermercado", page_icon="🛒", layout="wide"
)

# --- BASE DE DADOS SIMULADA (Exemplo para Bom Despacho e região) ---
# Em um sistema real, estes dados viriam de um Banco de Dados.
dados_mercados = [
    {
        "Supermercado": "Supermercado Economia",
        "Tipo": "Supermercado",
        "Cidade": "Bom Despacho",
        "Itens": {
            "Arroz 5kg": [
                {"marca": "Prato Fino", "preco": 28.50},
                {"marca": "Tio João", "preco": 32.00},
            ],
            "Feijão 1kg": [{"marca": "Carioca Camil", "preco": 7.50}],
            "Leite 1L": [{"marca": "Itambé", "preco": 5.20}],
            "Óleo de Soja 900ml": [{"marca": "Liza", "preco": 6.80}],
        },
    },
    {
        "Supermercado": "Hipermercado Central",
        "Tipo": "Hipermercado",
        "Cidade": "Bom Despacho",
        "Itens": {
            "Arroz 5kg": [
                {"marca": "Prato Fino", "preco": 29.90},
                {"marca": "Tio João", "preco": 31.00},
            ],
            "Feijão 1kg": [{"marca": "Carioca Camil", "preco": 7.20}],
            "Leite 1L": [{"marca": "Itambé", "preco": 4.90}],
            "Óleo de Soja 900ml": [{"marca": "Liza", "preco": 6.50}],
        },
    },
    {
        "Supermercado": "Atacarejo Bom Preço",
        "Tipo": "Atacarejo",
        "Cidade": "Bom Despacho",
        "Itens": {
            "Arroz 5kg": [
                {"marca": "Prato Fino", "preco": 27.00},
                {"marca": "Tio João", "preco": 30.50},
            ],
            "Feijão 1kg": [{"marca": "Carioca Camil", "preco": 6.90}],
            "Leite 1L": [{"marca": "Itambé", "preco": 5.00}],
            "Óleo de Soja 900ml": [{"marca": "Liza", "preco": 6.20}],
        },
    },
]

# --- INTERFACE DO USUÁRIO ---
st.title("🛒 Comparador Inteligente de Compras")
st.write(
    "Monte sua lista, acompanhe as compras e compare os preços dos produtos "
    "que ainda faltam."
)
st.caption(
    "Preços demonstrativos, sem consulta online configurada. A lista e os "
    "valores ficam disponíveis durante esta sessão do aplicativo."
)

produtos_disponiveis = sorted(
    {produto for mercado in dados_mercados for produto in mercado["Itens"]}
)

if "lista_compras" not in st.session_state:
    st.session_state["lista_compras"] = [
        {
            "id": f"catalogo-{indice}",
            "produto": produto,
            "quantidade": 1,
            "comprado": False,
        }
        for indice, produto in enumerate(produtos_disponiveis)
    ]
    st.session_state["proximo_item_id"] = len(produtos_disponiveis)
    for item in st.session_state["lista_compras"]:
        st.session_state[f"comprado_{item['id']}"] = item["comprado"]
        st.session_state[f"quantidade_{item['id']}"] = item["quantidade"]

st.sidebar.header("1. Localização")
cidades_disponiveis = sorted({mercado["Cidade"] for mercado in dados_mercados})
cidade_usuario = st.sidebar.selectbox("Cidade", cidades_disponiveis)

st.subheader("📝 Sua lista de compras")
with st.form("adicionar_item_form", clear_on_submit=True):
    novo_produto = st.text_input(
        "Adicionar produto",
        placeholder="Ex.: Café 500g",
    )
    adicionar_item = st.form_submit_button("Adicionar à lista")

if adicionar_item:
    nome_normalizado = novo_produto.strip()
    itens_atuais = st.session_state["lista_compras"]
    ja_existe = any(
        item["produto"].casefold() == nome_normalizado.casefold()
        for item in itens_atuais
    )
    if not nome_normalizado:
        st.warning("Digite o nome do produto que deseja adicionar.")
    elif ja_existe:
        st.warning(
            "Esse produto já está na lista. Altere a quantidade no próprio item."
        )
    else:
        item_id = st.session_state["proximo_item_id"]
        itens_atuais.append(
            {
                "id": f"personalizado-{item_id}",
                "produto": nome_normalizado,
                "quantidade": 1,
                "comprado": False,
            }
        )
        st.session_state[f"comprado_personalizado-{item_id}"] = False
        st.session_state[f"quantidade_personalizado-{item_id}"] = 1
        st.session_state["proximo_item_id"] = item_id + 1
        st.session_state["lista_compras"] = itens_atuais

if st.session_state["lista_compras"]:
    itens_removidos = []
    for item in st.session_state["lista_compras"]:
        coluna_comprado, coluna_produto, coluna_quantidade, coluna_remover = (
            st.columns([0.8, 3, 1, 0.8])
        )
        item["comprado"] = coluna_comprado.checkbox(
            "Comprado",
            key=f"comprado_{item['id']}",
        )
        coluna_produto.write(item["produto"])
        item["quantidade"] = coluna_quantidade.number_input(
            "Qtd.",
            min_value=1,
            step=1,
            key=f"quantidade_{item['id']}",
        )
        if coluna_remover.button("Remover", key=f"remover_{item['id']}"):
            itens_removidos.append(item["id"])

    if itens_removidos:
        st.session_state["lista_compras"] = [
            item
            for item in st.session_state["lista_compras"]
            if item["id"] not in itens_removidos
        ]
        st.rerun()
else:
    st.info("Sua lista está vazia. Adicione um produto para começar.")

itens_pendentes = [
    item for item in st.session_state["lista_compras"] if not item["comprado"]
]
mercados_cidade = [
    mercado
    for mercado in dados_mercados
    if mercado["Cidade"] == cidade_usuario
]
produtos_com_preco = [
    item
    for item in itens_pendentes
    if any(item["produto"] in mercado["Itens"] for mercado in mercados_cidade)
]
produtos_sem_preco = [
    item for item in itens_pendentes if item not in produtos_com_preco
]

if produtos_sem_preco:
    nomes_sem_preco = ", ".join(item["produto"] for item in produtos_sem_preco)
    st.info(
        f"Sem preço cadastrado para: {nomes_sem_preco}. Esses itens permanecem "
        "na sua lista, mas não entram na comparação."
    )

if not itens_pendentes:
    st.success("Todos os produtos da lista foram marcados como comprados.")
elif produtos_com_preco:
    resultados = []

    for mercado in mercados_cidade:
        custo_total = 0.0
        detalhes_itens = []

        for item in produtos_com_preco:
            ofertas = mercado["Itens"].get(item["produto"])
            if not ofertas:
                break

            info_produto = min(ofertas, key=lambda oferta: oferta["preco"])
            subtotal = info_produto["preco"] * item["quantidade"]
            custo_total += subtotal
            detalhes_itens.append(
                {
                    "Produto": item["produto"],
                    "Marca": info_produto["marca"],
                    "Quantidade": item["quantidade"],
                    "Preço Unitário": f"R$ {info_produto['preco']:.2f}",
                    "Subtotal": f"R$ {subtotal:.2f}",
                }
            )
        else:
            resultados.append(
                {
                    "Supermercado": mercado["Supermercado"],
                    "Tipo": mercado["Tipo"],
                    "Custo Total": custo_total,
                    "Detalhes": detalhes_itens,
                }
            )

    if resultados:
        resultados.sort(key=lambda resultado: resultado["Custo Total"])
        st.subheader("📊 Comparativo de custo total")
        st.dataframe(
            [
                {
                    "Supermercado": resultado["Supermercado"],
                    "Tipo": resultado["Tipo"],
                    "Custo Total": f"R$ {resultado['Custo Total']:.2f}",
                }
                for resultado in resultados
            ],
            hide_index=True,
        )

        nomes_mercados = [resultado["Supermercado"] for resultado in resultados]
        if (
            st.session_state.get("mercado_selecionado")
            not in nomes_mercados
        ):
            st.session_state["mercado_selecionado"] = nomes_mercados[0]

        st.subheader("🛒 Onde você vai comprar?")
        mercado_escolhido = st.selectbox(
            "Selecione o mercado para acompanhar sua compra",
            nomes_mercados,
            key="mercado_selecionado",
        )
        compra_atual = next(
            resultado
            for resultado in resultados
            if resultado["Supermercado"] == mercado_escolhido
        )
        st.success(
            f"Total atualizado no **{mercado_escolhido}**: "
            f"R$ {compra_atual['Custo Total']:.2f}"
        )

        if len(resultados) > 1:
            menor_total = resultados[0]["Custo Total"]
            maior_total = resultados[-1]["Custo Total"]
            economia = maior_total - menor_total
            st.info(f"Diferença em relação à opção mais cara: R$ {economia:.2f}.")

        st.subheader(f"🔍 Itens no {mercado_escolhido}")
        st.dataframe(compra_atual["Detalhes"], hide_index=True)
        st.caption(
            "Os totais são recalculados automaticamente quando você altera a "
            "lista ou as quantidades. Produtos adicionados sem preço cadastrado "
            "são avisados acima e não entram no total."
        )
    else:
        st.warning(
            "Nenhum estabelecimento possui todos os produtos comparáveis "
            "disponíveis na cidade informada."
        )
else:
    st.info("Adicione produtos com preços cadastrados para comparar os mercados.")