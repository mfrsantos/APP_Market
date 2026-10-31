// Gera a lista de compras a partir da família, das restrições e do período.
// Os preços são ESTIMATIVAS de referência (editáveis), não preços confirmados de mercado.

export const RESTRICOES = {
  lactose: "Sem lactose",
  gluten: "Sem glúten",
  vegetariano: "Vegetariano",
  diabetes: "Diabetes (sem açúcar)",
  ovo: "Alergia a ovo",
};

export const CATEGORIAS = {
  alimentacao: { titulo: "🍚 Alimentação básica", prioridade: "Essencial" },
  limpeza: { titulo: "🧼 Limpeza e higiene", prioridade: "Essencial" },
  opcional: { titulo: "🍫 Opcionais", prioridade: "Opcional" },
  extra: { titulo: "➕ Adicionados por mim", prioridade: "Normal" },
};

// tipo: eq = por adulto equivalente/mês · pessoa = por pessoa/mês · casa = por domicílio/mês
// evitar: restrições que removem o item · troca: restrição -> item substituto · requer: só entra com a restrição
const CATALOGO = [
  { produto: "Arroz 5kg", cat: "alimentacao", tipo: "eq", base: 0.8, preco: 28 },
  { produto: "Feijão 1kg", cat: "alimentacao", tipo: "eq", base: 2, preco: 8 },
  { produto: "Macarrão 500g", cat: "alimentacao", tipo: "eq", base: 2, preco: 5, evitar: ["gluten"], troca: { gluten: "Macarrão de arroz 500g" } },
  { produto: "Óleo de soja 900ml", cat: "alimentacao", tipo: "eq", base: 0.7, preco: 7.5 },
  { produto: "Sal 1kg", cat: "alimentacao", tipo: "casa", base: 0.4, preco: 3 },
  { produto: "Açúcar 1kg", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 5, evitar: ["diabetes"], troca: { diabetes: "Adoçante 100ml" } },
  { produto: "Café 500g", cat: "alimentacao", tipo: "eq", base: 0.8, preco: 20 },
  { produto: "Farinha de trigo 1kg", cat: "alimentacao", tipo: "casa", base: 1, preco: 6, evitar: ["gluten"] },
  { produto: "Fubá 1kg", cat: "alimentacao", tipo: "casa", base: 1, preco: 5 },
  { produto: "Leite 1L", cat: "alimentacao", tipo: "eq", base: 8, preco: 5.5, evitar: ["lactose"], troca: { lactose: "Leite sem lactose 1L" } },
  { produto: "Ovos (dúzia)", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 14, evitar: ["ovo"] },
  { produto: "Frango 1kg", cat: "alimentacao", tipo: "eq", base: 3, preco: 16, evitar: ["vegetariano"] },
  { produto: "Carne bovina 1kg", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 38, evitar: ["vegetariano"] },
  { produto: "Lentilha 500g", cat: "alimentacao", tipo: "eq", base: 1, preco: 7, requer: ["vegetariano"] },
  { produto: "Grão-de-bico 500g", cat: "alimentacao", tipo: "eq", base: 1, preco: 8, requer: ["vegetariano"] },
  { produto: "Proteína de soja 400g", cat: "alimentacao", tipo: "eq", base: 1, preco: 9, requer: ["vegetariano"] },
  { produto: "Pão de forma", cat: "alimentacao", tipo: "eq", base: 1, preco: 9, evitar: ["gluten"] },
  { produto: "Margarina 500g", cat: "alimentacao", tipo: "casa", base: 1, preco: 8 },
  { produto: "Queijo mussarela 500g", cat: "alimentacao", tipo: "eq", base: 1, preco: 24, evitar: ["lactose"] },
  { produto: "Molho de tomate 340g", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 3 },
  { produto: "Banana (kg)", cat: "alimentacao", tipo: "eq", base: 3, preco: 6 },
  { produto: "Maçã (kg)", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 9 },
  { produto: "Tomate (kg)", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 8 },
  { produto: "Cebola (kg)", cat: "alimentacao", tipo: "eq", base: 1, preco: 6 },
  { produto: "Batata (kg)", cat: "alimentacao", tipo: "eq", base: 1.5, preco: 6 },
  { produto: "Cenoura (kg)", cat: "alimentacao", tipo: "eq", base: 1, preco: 5 },
  { produto: "Alface (unidade)", cat: "alimentacao", tipo: "eq", base: 3, preco: 4 },
  { produto: "Alho 100g", cat: "alimentacao", tipo: "casa", base: 1, preco: 4 },

  { produto: "Detergente 500ml", cat: "limpeza", tipo: "casa", base: 3, preco: 3 },
  { produto: "Sabão em pó 1kg", cat: "limpeza", tipo: "casa", base: 1, preco: 14 },
  { produto: "Sabão em barra (pacote)", cat: "limpeza", tipo: "casa", base: 0.5, preco: 9 },
  { produto: "Água sanitária 2L", cat: "limpeza", tipo: "casa", base: 1, preco: 6 },
  { produto: "Desinfetante 2L", cat: "limpeza", tipo: "casa", base: 1, preco: 8 },
  { produto: "Esponja de cozinha (3 un)", cat: "limpeza", tipo: "casa", base: 1, preco: 4 },
  { produto: "Saco de lixo (rolo)", cat: "limpeza", tipo: "casa", base: 1, preco: 8 },
  { produto: "Papel higiênico (12 rolos)", cat: "limpeza", tipo: "pessoa", base: 0.4, preco: 22 },
  { produto: "Sabonete (unidade)", cat: "limpeza", tipo: "pessoa", base: 3, preco: 2.5 },
  { produto: "Creme dental", cat: "limpeza", tipo: "pessoa", base: 1, preco: 5 },
  { produto: "Shampoo", cat: "limpeza", tipo: "pessoa", base: 0.5, preco: 14 },

  { produto: "Refrigerante 2L", cat: "opcional", tipo: "eq", base: 3, preco: 9, evitar: ["diabetes"] },
  { produto: "Suco em pó/caixa", cat: "opcional", tipo: "eq", base: 3, preco: 6, evitar: ["diabetes"] },
  { produto: "Biscoito", cat: "opcional", tipo: "eq", base: 3, preco: 5, evitar: ["gluten", "diabetes"] },
  { produto: "Chocolate", cat: "opcional", tipo: "eq", base: 2, preco: 8, evitar: ["diabetes"] },
  { produto: "Iogurte", cat: "opcional", tipo: "eq", base: 4, preco: 6, evitar: ["lactose"] },
  { produto: "Cereal matinal", cat: "opcional", tipo: "eq", base: 1, preco: 14, evitar: ["gluten", "diabetes"] },
  { produto: "Salgadinho", cat: "opcional", tipo: "eq", base: 2, preco: 7 },
  { produto: "Sorvete 1,5L", cat: "opcional", tipo: "eq", base: 1, preco: 22, evitar: ["lactose", "diabetes"] },
];

const SUBSTITUTOS = {
  "Macarrão de arroz 500g": { cat: "alimentacao", preco: 9 },
  "Adoçante 100ml": { cat: "alimentacao", preco: 8 },
  "Leite sem lactose 1L": { cat: "alimentacao", preco: 7.5 },
};

export function equivalenteAdulto(idade) {
  if (idade <= 2) return 0.3;
  if (idade <= 6) return 0.5;
  if (idade <= 12) return 0.75;
  return 1;
}

export function pesosDaFamilia(perfil) {
  const criancas = perfil.criancas ?? [];
  const adultos = Math.max(1, perfil.adultos ?? 1);
  return {
    pessoas: adultos + criancas.length,
    eq: adultos + criancas.reduce((s, idade) => s + equivalenteAdulto(idade), 0),
  };
}

export function gerarLista(perfil, dias = 30) {
  const restricoes = new Set(perfil.restricoes ?? []);
  const { pessoas, eq } = pesosDaFamilia(perfil);
  const fatorCasa = Math.min(1 + 0.2 * (pessoas - 1), 2.5);
  const periodo = dias / 30;
  const qtd = (item) => {
    const bruto = item.base * periodo * (item.tipo === "eq" ? eq : item.tipo === "pessoa" ? pessoas : fatorCasa);
    return Math.max(1, Math.round(bruto));
  };

  const itens = [];
  const juntar = (produto, cat, quantidade, preco) => {
    const existente = itens.find((i) => i.produto === produto);
    if (existente) return;
    itens.push({ produto, categoria: cat, prioridade: CATEGORIAS[cat].prioridade, quantidade, estimativa: preco });
  };

  for (const def of CATALOGO) {
    if (def.requer && !def.requer.some((r) => restricoes.has(r))) continue;
    const bloqueio = (def.evitar ?? []).find((r) => restricoes.has(r));
    if (bloqueio) {
      const sub = def.troca?.[bloqueio];
      if (sub) juntar(sub, SUBSTITUTOS[sub].cat, qtd(def), SUBSTITUTOS[sub].preco);
      continue;
    }
    juntar(def.produto, def.cat, qtd(def), def.preco);
  }

  const bebes = (perfil.criancas ?? []).filter((idade) => idade <= 2).length;
  if (bebes) juntar("Fralda descartável (pacote)", "limpeza", Math.max(1, Math.round(3 * periodo * bebes)), 40);

  const ordem = Object.keys(CATEGORIAS);
  return itens.sort((a, b) => ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria));
}
