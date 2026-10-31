# APP_Market

Lista de compras para usar **dentro do supermercado**, pelo celular. Encontra os mercados da região
(por cidade ou pela localização do aparelho), consulta preços online quando a rede permite e deixa
você informar o preço real da prateleira.

## Rodar no computador

```
pip install -r requirements.txt
streamlit run app.py
```

## Usar no celular

A localização do aparelho só funciona em endereço **https**, então o caminho recomendado é publicar o app:

1. Acesse https://share.streamlit.io e entre com o GitHub.
2. **Create app** → repositório `APP_Market`, branch `main`, arquivo `app.py`.
3. Abra o link gerado no celular e, no navegador, use **Adicionar à tela inicial**.

Em casa, na mesma rede Wi-Fi, também dá para testar com
`streamlit run app.py --server.address 0.0.0.0` e abrir `http://IP-DO-PC:8501` no celular
(sem localização do aparelho; use a opção "Cidade").

## Como funciona

- **Cadastro**: na primeira abertura o app pede nome, cidade, estado e o valor que você quer gastar.
  Fica salvo apenas no endereço da página, neste aparelho (sem senha e sem servidor). Para mudar,
  toque no seu nome no topo.
- **Orçamento**: o app compara o total previsto (carrinho + itens que faltam) com o valor que você pode gastar.
  Se passar, sugere um ajuste: começa pelos itens **Opcional** (reduz a quantidade e, se preciso, adia o item),
  depois **Normal** e por último **Essencial** (só reduz a quantidade, nunca adia). Você confirma em
  "Aplicar ajuste". Defina a prioridade de cada item em "Editar".
- **Lista**: adicione itens, marque como comprado, ajuste a quantidade e informe o preço da prateleira
  em "Editar". Os totais "Falta comprar" e "No carrinho" usam o mercado escolhido.
- **Mercados**: compara o total entre as redes com consulta online e permite escolher onde comprar.
- A lista fica salva **no endereço da página**; favorite o link para não perdê-la ao recarregar.
- Preços online (loja virtual) podem diferir da loja física: confira na prateleira.

## Redes com consulta de preços

Configuradas em `precos.py` (`REDES`). Hoje só o Atacadão tem consulta online; as demais aparecem como
"sem consulta online" e aceitam o preço informado manualmente.
