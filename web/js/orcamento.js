// Ajuste da lista de compras a um orçamento.
// 1) Opcional: reduz a quantidade até 1 e, se preciso, adia o item.
// 2) Normal: mesma regra.
// 3) Essencial: só reduz a quantidade até 1; nunca adia.
// Itens no carrinho contam como gasto fixo; itens sem preço ficam fora da conta.

export const PRIORIDADES = ["Essencial", "Normal", "Opcional"];

// itens: [{id, produto, prioridade, quantidade, preco (unitário ou null), comprado}]
// Retorna {mudancas: [{id, produto, de, para}], total, cabe}; para === 0 significa adiar.
export function ajustarAoOrcamento(itens, orcamento) {
  const gasto = itens
    .filter((i) => i.comprado && i.preco)
    .reduce((soma, i) => soma + i.preco * i.quantidade, 0);

  const pendentes = new Map(
    itens
      .filter((i) => !i.comprado && i.preco && i.quantidade > 0)
      .map((i) => [i.id, { ...i }]),
  );
  const original = new Map([...pendentes].map(([id, i]) => [id, i.quantidade]));

  const totalPendente = () =>
    [...pendentes.values()].reduce((s, i) => s + i.preco * i.quantidade, 0);
  const estourou = () => gasto + totalPendente() > orcamento + 1e-9;
  const maior = (lista) =>
    lista.reduce((a, b) => (b.preco * b.quantidade > a.preco * a.quantidade ? b : a));

  for (const prioridade of [...PRIORIDADES].reverse()) {
    const grupo = [...pendentes.values()].filter((i) => {
      const prioridadeEfetiva = i.categoria === "limpeza" ? "Essencial" : i.prioridade;
      return prioridadeEfetiva === prioridade;
    });
    while (estourou()) {
      const reduziveis = grupo.filter((i) => i.quantidade > 1);
      if (!reduziveis.length) break;
      maior(reduziveis).quantidade -= 1;
    }
    if (prioridade === "Essencial") continue;
    while (estourou()) {
      const restantes = grupo.filter((i) => i.quantidade > 0);
      if (!restantes.length) break;
      maior(restantes).quantidade = 0;
    }
  }

  const mudancas = [...pendentes]
    .filter(([id, i]) => i.quantidade !== original.get(id))
    .map(([id, i]) => ({ id, produto: i.produto, de: original.get(id), para: i.quantidade }));

  return { mudancas, total: gasto + totalPendente(), cabe: !estourou() };
}
