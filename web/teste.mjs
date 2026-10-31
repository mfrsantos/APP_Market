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

import { gerarLista } from "./js/gerador.js";
import { descreverFamilia, limparMembros, membrosDoPerfil, novoMembro, resumoFamilia, validarMembros } from "./js/familia.js";

const kids = [{ nome: "Ana", adulto: false, idade: "7" }, { nome: "", adulto: false, idade: "1" }, { nome: "João", adulto: true, idade: "" }];
assert.deepEqual(resumoFamilia(kids), { adultos: 2, criancas: [7, 1] });
assert.equal(validarMembros(kids), "");
assert.ok(validarMembros([novoMembro(false)]));
assert.ok(validarMembros([{ nome: "", adulto: false, idade: "18" }]));
assert.equal(descreverFamilia("Marcus", kids), "Marcus (você), Ana (7 anos), Criança (1 ano), João");
assert.deepEqual(resumoFamilia(membrosDoPerfil({ adultos: 2, criancas: [3] })), { adultos: 2, criancas: [3] });
assert.deepEqual(limparMembros([{ nome: "  Zé ", adulto: false, idade: "4.4" }]), [{ nome: "Zé", adulto: false, idade: "4" }]);

const nomes = (l) => l.map((i) => i.produto);
const fam = { adultos: 2, criancas: [1, 8], restricoes: [] };
let g = gerarLista(fam, 30);
assert.deepEqual([...new Set(g.map((i) => i.categoria))], ["alimentacao", "limpeza", "opcional"]);
assert.ok(nomes(g).includes("Fralda descartável (pacote)"));
assert.ok(g.every((i) => i.quantidade >= 1 && i.estimativa > 0));
assert.ok(gerarLista(fam, 7).find((i) => i.produto === "Arroz 5kg").quantidade <= g.find((i) => i.produto === "Arroz 5kg").quantidade);
assert.ok(g.find((i) => i.produto === "Leite 1L").quantidade > gerarLista({ adultos: 1, criancas: [], restricoes: [] }, 30).find((i) => i.produto === "Leite 1L").quantidade);

g = nomes(gerarLista({ adultos: 1, criancas: [], restricoes: ["lactose", "gluten", "diabetes", "vegetariano", "ovo"] }, 30));
for (const proibido of ["Leite 1L", "Queijo mussarela 500g", "Iogurte", "Macarrão 500g", "Pão de forma", "Farinha de trigo 1kg", "Açúcar 1kg", "Refrigerante 2L", "Ovos (dúzia)", "Frango 1kg", "Carne bovina 1kg"]) assert.ok(!g.includes(proibido), proibido);
for (const esperado of ["Leite sem lactose 1L", "Macarrão de arroz 500g", "Adoçante 100ml", "Lentilha 500g"]) assert.ok(g.includes(esperado), esperado);

// lista gerada cabe no orçamento, cortando primeiro os opcionais
const base = gerarLista(fam, 30).map((i, n) => ({ id: `i${n}`, produto: i.produto, prioridade: i.prioridade, quantidade: i.quantidade, preco: i.estimativa, comprado: false }));
const custo = base.reduce((s, i) => s + i.preco * i.quantidade, 0);
const plano = ajustarAoOrcamento(base, custo * 0.8);
assert.ok(plano.cabe && plano.total <= custo * 0.8);
assert.ok(plano.mudancas.every((m) => base.find((i) => i.id === m.id).prioridade !== "Essencial") || plano.mudancas.some((m) => base.find((i) => i.id === m.id).prioridade === "Opcional"));

console.log("todos os testes passaram");
