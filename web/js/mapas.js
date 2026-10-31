// Geocodificação e busca de supermercados (OpenStreetMap, sem chave de API).

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export async function geocodificarCidade(cidade, uf) {
  const q = [cidade.trim(), uf.trim(), "Brasil"].filter(Boolean).join(", ");
  const url = `${NOMINATIM}?${new URLSearchParams({ q, format: "json", limit: "1" })}`;
  let resultados;
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    resultados = await resposta.json();
  } catch (erro) {
    throw new Error(`Não foi possível consultar a localização: ${erro.message}`);
  }
  if (!resultados.length) throw new Error(`Cidade não encontrada: ${cidade}`);
  const [achado] = resultados;
  return { lat: Number(achado.lat), lon: Number(achado.lon), descricao: achado.display_name };
}

export function posicaoDoAparelho() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este aparelho não oferece localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error("Permissão de localização negada ou indisponível.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  });
}

async function buscarNominatim(lat, lon, raioKm) {
  const grau = raioKm / 111;
  const caixa = `${lon - grau},${lat + grau},${lon + grau},${lat - grau}`;
  const lojas = new Map();
  for (const termo of ["supermercado", "atacadao", "atacarejo"]) {
    const params = new URLSearchParams({
      q: termo, format: "json", limit: "40", viewbox: caixa, bounded: "1", addressdetails: "1",
    });
    const resposta = await fetch(`${NOMINATIM}?${params}`, { signal: AbortSignal.timeout(20000) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    for (const achado of await resposta.json()) {
      const nome = achado.name || (achado.display_name ?? "").split(",")[0];
      if (nome && !lojas.has(achado.place_id)) {
        lojas.set(achado.place_id, {
          nome,
          lat: Number(achado.lat),
          lon: Number(achado.lon),
          distanciaKm: distanciaKm(lat, lon, Number(achado.lat), Number(achado.lon)),
        });
      }
    }
  }
  return [...lojas.values()].sort((a, b) => a.distanciaKm - b.distanciaKm);
}

// Lista supermercados/atacarejos próximos, do mais perto ao mais longe.
export async function buscarSupermercados(lat, lon, raioKm = 10) {
  const consulta =
    `[out:json][timeout:25];(nwr["shop"~"^(supermarket|wholesale)$"]` +
    `(around:${Math.round(raioKm * 1000)},${lat},${lon}););out center tags 100;`;
  for (const url of OVERPASS) {
    try {
      const resposta = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: consulta }),
        signal: AbortSignal.timeout(35000),
      });
      if (!resposta.ok) continue;
      const { elements = [] } = await resposta.json();
      return elements
        .map((e) => {
          const nome = e.tags?.name || e.tags?.brand;
          const centro = e.center ?? e;
          if (!nome || centro.lat == null) return null;
          return {
            nome,
            lat: centro.lat,
            lon: centro.lon,
            distanciaKm: distanciaKm(lat, lon, centro.lat, centro.lon),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanciaKm - b.distanciaKm);
    } catch {
      /* tenta o próximo servidor */
    }
  }
  try {
    return await buscarNominatim(lat, lon, raioKm);
  } catch (erro) {
    throw new Error(`Serviço de mapas indisponível no momento: ${erro.message}`);
  }
}
