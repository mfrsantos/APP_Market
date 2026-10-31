"""Geocodificação e busca de supermercados próximos (OpenStreetMap, sem chave de API)."""

import json
import math
import urllib.parse
import urllib.request

USER_AGENT = "APP_Market/1.0 (comparador de precos pessoal)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)


class ErroLocalizacao(Exception):
    pass


def _requisicao(url, dados=None, timeout=30):
    corpo = urllib.parse.urlencode(dados).encode() if dados else None
    req = urllib.request.Request(url, data=corpo, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resposta:
        return json.loads(resposta.read().decode("utf-8"))


def geocodificar_cidade(cidade, estado=""):
    """Retorna (latitude, longitude, nome completo) da cidade informada."""
    consulta = ", ".join(parte for parte in (cidade.strip(), estado.strip(), "Brasil") if parte)
    params = urllib.parse.urlencode({"q": consulta, "format": "json", "limit": 1})
    try:
        resultados = _requisicao(f"{NOMINATIM_URL}?{params}", timeout=20)
    except OSError as erro:
        raise ErroLocalizacao(f"Não foi possível consultar a localização: {erro}") from erro
    if not resultados:
        raise ErroLocalizacao(f"Cidade não encontrada: {cidade}")
    achado = resultados[0]
    return float(achado["lat"]), float(achado["lon"]), achado["display_name"]


def distancia_km(lat1, lon1, lat2, lon2):
    raio_terra = 6371.0
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * raio_terra * math.asin(math.sqrt(a))


def _buscar_nominatim(lat, lon, raio_km):
    """Contingência quando o Overpass está fora do ar."""
    grau = raio_km / 111.0
    caixa = f"{lon - grau},{lat + grau},{lon + grau},{lat - grau}"
    lojas = {}
    for termo in ("supermercado", "atacadao", "atacarejo"):
        params = urllib.parse.urlencode(
            {"q": termo, "format": "json", "limit": 40, "viewbox": caixa,
             "bounded": 1, "addressdetails": 1}
        )
        for achado in _requisicao(f"{NOMINATIM_URL}?{params}", timeout=20):
            nome = achado.get("name") or achado.get("display_name", "").split(",")[0]
            chave = achado.get("place_id")
            if nome and chave not in lojas:
                rua = achado.get("address", {}).get("road", "")
                lojas[chave] = {
                    "nome": nome, "marca": "", "endereco": rua,
                    "lat": float(achado["lat"]), "lon": float(achado["lon"]),
                    "distancia_km": distancia_km(lat, lon, float(achado["lat"]), float(achado["lon"])),
                }
    return sorted(lojas.values(), key=lambda loja: loja["distancia_km"])


def buscar_supermercados(lat, lon, raio_km=8):
    """Lista supermercados/atacarejos próximos, do mais perto ao mais longe."""
    raio_m = int(raio_km * 1000)
    consulta = (
        "[out:json][timeout:25];("
        f'nwr["shop"~"^(supermarket|wholesale)$"](around:{raio_m},{lat},{lon});'
        ");out center tags 100;"
    )
    ultimo_erro = None
    for url in OVERPASS_URLS:
        try:
            dados = _requisicao(url, {"data": consulta}, timeout=35)
            break
        except OSError as erro:
            ultimo_erro = erro
    else:
        try:
            return _buscar_nominatim(lat, lon, raio_km)
        except OSError as erro:
            raise ErroLocalizacao(
                f"Serviço de mapas indisponível no momento: {erro or ultimo_erro}"
            ) from erro

    lojas = []
    for elemento in dados.get("elements", []):
        tags = elemento.get("tags", {})
        nome = tags.get("name") or tags.get("brand")
        centro = elemento.get("center", elemento)
        if not nome or "lat" not in centro:
            continue
        endereco = " ".join(
            filter(None, (tags.get("addr:street"), tags.get("addr:housenumber")))
        )
        lojas.append(
            {
                "nome": nome,
                "marca": tags.get("brand", ""),
                "endereco": endereco,
                "lat": centro["lat"],
                "lon": centro["lon"],
                "distancia_km": distancia_km(lat, lon, centro["lat"], centro["lon"]),
            }
        )
    return sorted(lojas, key=lambda loja: loja["distancia_km"])
