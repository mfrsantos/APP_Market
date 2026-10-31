"""Ajuste da lista de compras a um orçamento.

Regras (da menos para a mais importante):
1. Itens "Opcional": reduz a quantidade até 1 e, se preciso, adia o item.
2. Itens "Normal": mesma regra.
3. Itens "Essencial": só reduz a quantidade até 1; nunca adia.
Itens já no carrinho contam como gasto fixo; itens sem preço não entram na conta.
"""

PRIORIDADES = ("Essencial", "Normal", "Opcional")


def ajustar_ao_orcamento(itens, orcamento):
    """Calcula as mudanças necessárias para a compra caber no orçamento.

    Cada item: {"id", "produto", "prioridade", "quantidade", "preco" (unitário ou
    None), "comprado"}. Retorna um dicionário com:
      - "mudancas": lista de {"id", "produto", "de", "para"} (para == 0 significa adiar)
      - "total": total previsto após o ajuste (carrinho + pendentes com preço)
      - "cabe": se o total ficou dentro do orçamento
    """
    gasto = sum(
        i["preco"] * i["quantidade"] for i in itens if i["comprado"] and i["preco"]
    )
    pendentes = {
        i["id"]: dict(i)
        for i in itens
        if not i["comprado"] and i["preco"] and i["quantidade"] > 0
    }
    original = {k: v["quantidade"] for k, v in pendentes.items()}

    def total_pendente():
        return sum(v["preco"] * v["quantidade"] for v in pendentes.values())

    def estourou():
        return gasto + total_pendente() > orcamento + 1e-9

    for prioridade in reversed(PRIORIDADES):
        grupo = [v for v in pendentes.values() if v["prioridade"] == prioridade]
        while estourou():
            reduziveis = [v for v in grupo if v["quantidade"] > 1]
            if not reduziveis:
                break
            maior = max(reduziveis, key=lambda v: v["preco"] * v["quantidade"])
            maior["quantidade"] -= 1
        if prioridade == "Essencial":
            continue
        while estourou():
            restantes = [v for v in grupo if v["quantidade"] > 0]
            if not restantes:
                break
            maior = max(restantes, key=lambda v: v["preco"] * v["quantidade"])
            maior["quantidade"] = 0

    mudancas = [
        {
            "id": k,
            "produto": v["produto"],
            "de": original[k],
            "para": v["quantidade"],
        }
        for k, v in pendentes.items()
        if v["quantidade"] != original[k]
    ]
    return {
        "mudancas": mudancas,
        "total": gasto + total_pendente(),
        "cabe": not estourou(),
    }
