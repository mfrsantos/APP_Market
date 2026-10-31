import assert from "node:assert/strict";
import { ajustarAoOrcamento } from "./js/orcamento.js";
import { extrairOfertas, identificarRede, normalizar, temConsultaOnline } from "./js/redes.js";
import { distanciaKm } from "./js/mapas.js";

const it = (id, prioridade, quantidade, preco, comprado = false) => ({ id, produto: id, prioridade, quantidade, preco, comprado });
const itens = [it("arroz", "Essencial", 2, 20), it("biscoito", "Opcional", 3, 5), it("suco", "Normal", 2, 8), it("sem", "Normal", 1, null)];

let r = ajustarAoOrcamento(itens, 60);
assert.deepEqual(r.mudancas, [{ id: "biscoito", produto: "biscoito", de: 3, para: 0 }]);
assert.equal(r.total, 56);
assert.ok(r.cabe);

r = ajustarAoOrcamento(itens, 10);
assert.equal(r.total, 20);
assert.ok(!r.cabe);
assert.equal(r.mudancas.find((m) => m.id === "arroz").para, 1);

r = ajustarAoOrcamento([it("a", "Normal", 1, 10, true), it("b", "Normal", 2, 10)], 25);
assert.equal(r.total, 20);
assert.ok(r.cabe);
assert.deepEqual(ajustarAoOrcamento(itens, 1000).mudancas, []);

assert.equal(identificarRede("Atacadão Bom Despacho").nome, "Atacadão");
assert.equal(identificarRede("Supermercado BH").nome, "Supermercados BH");
assert.equal(identificarRede("Mercadinho X"), null);
assert.equal(normalizar("Óleo de Soja"), "oleo de soja");
assert.ok(temConsultaOnline(identificarRede("Atacadão"), "https://x"));
assert.ok(!temConsultaOnline(identificarRede("Atacadão"), ""));
assert.ok(!temConsultaOnline(identificarRede("Mart Minas"), "https://x"));

const ofertas = extrairOfertas(
  [
    { productName: "Arroz A", brand: "X", items: [{ sellers: [{ commertialOffer: { Price: 19, AvailableQuantity: 5 } }] }] },
    { productName: "Arroz B", items: [{ sellers: [{ commertialOffer: { Price: 0, AvailableQuantity: 5 } }] }] },
    { productName: "Arroz C", items: [{ sellers: [{ commertialOffer: { Price: 10, AvailableQuantity: 0 } }] }] },
  ],
  "arroz",
);
assert.equal(ofertas.length, 1);
assert.equal(ofertas[0].preco, 19);

const d = distanciaKm(-19.7375, -45.2517, -19.7375, -45.2517 + 0.1);
assert.ok(d > 10 && d < 11.5, d);

console.log("todos os testes passaram");
