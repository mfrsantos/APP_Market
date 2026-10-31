# APP_Market

Lista de compras para usar **dentro do supermercado**, no celular. Cadastro, orçamento com ajuste automático, busca de supermercados pela cidade ou pela localização do aparelho e preços online (quando a rede disponibiliza).

## Versão web (principal) — `web/`

HTML + CSS + JavaScript puro (PWA), sem instalar nada. Funciona offline depois do primeiro acesso e pode ser adicionada à tela inicial do celular.

- Conta local: nome, PIN opcional, cidade, estado, adultos, idades das crianças e restrições alimentares (sem lactose, sem glúten, vegetariano, diabetes, alergia a ovo). Dados guardados só no aparelho (localStorage); contas antigas são migradas.
- Nova compra: após entrar, você informa o valor e o período (1 semana, 15 dias ou 1 mês). A lista é gerada para a família (crianças pesam menos que adultos; fraldas para menores de 3 anos), nesta ordem: **alimentação básica e limpeza/higiene (itens essenciais) → opcionais**, respeitando as restrições. O orçamento não altera as quantidades; sugestões de economia devem se basear em preços reais comparáveis dos supermercados próximos, não nas estimativas da lista.
- Cadastro: só nome e PIN (opcional). Em seguida, em passos: cidade/estado, família (adultos e crianças com nome opcional e idade) e restrições alimentares.
- Os preços iniciais são **estimativas de referência** (marcadas como "preço estimado") até você informar o preço da prateleira ou haver preço online.
- Lista de compras em duas abas: **Lista sugerida** (gerada pelo app) e **Lista manual** (você adiciona os produtos e informa quantidade e preço na loja; o gasto é somado automaticamente e mostra quanto resta do orçamento, ou quanto passou).
- Tema claro/escuro: botão ☀️/🌙 no topo (segue o tema do aparelho até você escolher).
- Lista editável: marcar comprado, adicionar, alterar quantidade, prioridade, adiar e preço da prateleira.
- Orçamento: compara o total com o valor informado; só sugere reduzir/adiar itens quando há preços reais para todos os produtos ativos.
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