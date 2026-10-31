# APP_Market

Lista de compras para usar **dentro do supermercado**, no celular. Cadastro, orçamento com ajuste automático, busca de supermercados pela cidade ou pela localização do aparelho e preços online (quando a rede disponibiliza).

## Versão web (principal) — `web/`

HTML + CSS + JavaScript puro (PWA), sem instalar nada. Funciona offline depois do primeiro acesso e pode ser adicionada à tela inicial do celular.

- Cadastro (nome, cidade, estado, orçamento); dados guardados só no aparelho (localStorage).
- Lista editável: marcar comprado, adicionar, alterar quantidade, prioridade (Essencial/Normal/Opcional), adiar e preço da prateleira.
- Orçamento: se a lista passar do valor, sugere reduzir/adiar itens (opcionais primeiro) e aplica com confirmação.
- Supermercados: busca no OpenStreetMap pela cidade ou pela localização do aparelho.

### Testar localmente

```
cd web
python -m http.server 8000
```

Abra `http://localhost:8000`. Lógica: `node web/teste.mjs`.

### Publicar

Qualquer hospedagem estática serve (GitHub Pages, Cloudflare Pages, Netlify). A localização do aparelho exige **https**.

### Preços online (proxy)

O navegador bloqueia (CORS) a consulta direta ao catálogo do Atacadão. Publique `worker/precos-proxy.js` como Cloudflare Worker (gratuito) e informe a URL em **Perfil > Avançado**. As demais redes (Supermercados BH, Mart Minas, Fidelis, Oliveira etc.) não têm catálogo público: use o preço da prateleira.

## Versão Streamlit (alternativa, Python)

`app.py`, `localizacao.py`, `precos.py`, `orcamento.py`. Requer `pip install -r requirements.txt` e `streamlit run app.py`.
