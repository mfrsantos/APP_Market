// Proxy de preços (Cloudflare Workers, plano gratuito).
// O navegador não pode consultar as lojas direto por causa do CORS; este worker
// repassa apenas consultas de catálogo aos domínios permitidos abaixo.
//
// Publicar: https://dash.cloudflare.com > Workers & Pages > Create > Hello World,
// cole este arquivo, publique e informe a URL do worker em Perfil > Avançado.

const DOMINIOS_PERMITIDOS = new Set(["www.atacadao.com.br"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const dominio = url.searchParams.get("dominio") ?? "";
    const termo = (url.searchParams.get("ft") ?? "").slice(0, 80);
    if (!DOMINIOS_PERMITIDOS.has(dominio) || !termo) {
      return new Response("Parâmetros inválidos", { status: 400, headers: CORS });
    }

    const destino =
      `https://${dominio}/api/catalog_system/pub/products/search` +
      `?ft=${encodeURIComponent(termo)}&_from=0&_to=7`;
    const resposta = await fetch(destino, { headers: { "User-Agent": "Mozilla/5.0" } });
    return new Response(resposta.body, {
      status: resposta.status,
      headers: {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=1800",
      },
    });
  },
};
