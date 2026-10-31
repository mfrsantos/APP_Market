// Cache do app para funcionar offline dentro do supermercado.
// Aumente a versão ao publicar mudanças nos arquivos abaixo.
const VERSAO = "v6";
const ARQUIVOS = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "js/app.js",
  "js/orcamento.js",
  "js/gerador.js",
  "js/familia.js",
  "js/redes.js",
  "js/mapas.js",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// Arquivos do app: rede primeiro (pega atualizações) e cache como reserva offline.
self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  evento.respondWith(
    fetch(request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(request, copia));
        return resposta;
      })
      .catch(() => caches.match(request).then((guardado) => guardado ?? caches.match("index.html"))),
  );
});
