"""Consulta de preços online nas redes de supermercado conhecidas.

Cada rede tem um "provedor". Hoje existe o provedor VTEX (catálogo público usado
por várias lojas virtuais). Redes sem provedor configurado aparecem como
"sem consulta online" em vez de exibir preços inventados.

Para habilitar uma nova rede, preencha `dominio` (e `tipo="vtex"`) em REDES.
"""

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request

USER_AGENT = "Mozilla/5.0 APP_Market/1.0"

REDES = [
    {"nome": "Atacadão", "tipo": "vtex", "dominio": "www.atacadao.com.br", "categoria": "Atacarejo", "apelidos": ["atacadao"]},
    {"nome": "Supermercados BH", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["supermercados bh", "supermercado bh", "super bh"]},
    {"nome": "Mart Minas", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["mart minas"]},
    {"nome": "Fidelis Supermercados", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["fidelis"]},
    {"nome": "Oliveira Supermercados", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["oliveira"]},
    {"nome": "VAP Supermercados", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["vap"]},
    {"nome": "Santa Edwiges", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["santa edwiges"]},
    {"nome": "Carrefour", "tipo": None, "dominio": None, "categoria": "Hipermercado", "apelidos": ["carrefour"]},
    {"nome": "Assaí", "tipo": None, "dominio": None, "categoria": "Atacarejo", "apelidos": ["assai"]},
    {"nome": "Pão de Açúcar", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["pao de acucar"]},
    {"nome": "Epa", "tipo": None, "dominio": None, "categoria": "Supermercado", "apelidos": ["epa"]},
]


def _normalizar(texto):
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", sem_acento.lower()).strip()


def identificar_rede(nome_loja):
    """Associa o nome de uma loja do mapa a uma rede conhecida (ou None)."""
    nome = _normalizar(nome_loja)
    for rede in REDES:
        for apelido in rede["apelidos"]:
            if re.search(rf"\b{re.escape(apelido)}\b", nome):
                return rede
    return None


def tem_consulta_online(rede):
    return bool(rede and rede.get("tipo") == "vtex" and rede.get("dominio"))


def _consultar_vtex(dominio, produto, limite=8):
    params = urllib.parse.urlencode({"ft": produto, "_from": 0, "_to": limite - 1})
    url = f"https://{dominio}/api/catalog_system/pub/products/search?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resposta:
        itens = json.loads(resposta.read().decode("utf-8"))

    ofertas = []
    for item in itens:
        for sku in item.get("items", []):
            for vendedor in sku.get("sellers", []):
                oferta = vendedor.get("commertialOffer", {})
                preco = oferta.get("Price") or 0
                if preco > 0 and oferta.get("AvailableQuantity", 0) > 0:
                    ofertas.append(
                        {
                            "descricao": item.get("productName", produto),
                            "marca": item.get("brand", ""),
                            "preco": float(preco),
                            "link": item.get("link", ""),
                        }
                    )
                    break
            else:
                continue
            break
    return ofertas


def consultar_preco(rede, produto):
    """Retorna a oferta mais barata encontrada para o produto, ou None.

    Levanta OSError se a rede não puder ser consultada.
    """
    if not tem_consulta_online(rede):
        return None
    ofertas = _consultar_vtex(rede["dominio"], produto)
    return min(ofertas, key=lambda oferta: oferta["preco"]) if ofertas else None


_CACHE = {}
_VALIDADE_S = 1800


def consultar_preco_cache(rede, produto):
    """Como consultar_preco, mas reaproveita resultados por 30 minutos.

    Retorna (oferta_ou_None, mensagem_de_erro_ou_None).
    """
    chave = (rede["nome"], _normalizar(produto))
    guardado = _CACHE.get(chave)
    if guardado and time.time() - guardado[0] < _VALIDADE_S:
        return guardado[1], None
    try:
        oferta = consultar_preco(rede, produto)
    except (OSError, ValueError) as erro:
        return None, str(erro)
    _CACHE[chave] = (time.time(), oferta)
    return oferta, None
