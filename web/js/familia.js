// Família = "Você" (adulto, dono da conta) + membros adicionais, cada um com nome opcional.
// Crianças/adolescentes precisam de idade (0 a 17); ela define quanto cada um "pesa" na lista.

export const MAX_MEMBROS = 15;

export const novoMembro = (adulto) => ({ nome: "", adulto, idade: "" });

export function resumoFamilia(membros) {
  return {
    adultos: 1 + membros.filter((m) => m.adulto).length,
    criancas: membros.filter((m) => !m.adulto).map((m) => Math.round(Number(m.idade))),
  };
}

export function validarMembros(membros) {
  for (const m of membros) {
    if (m.adulto) continue;
    const n = Number(m.idade);
    if (m.idade === "" || m.idade == null || !Number.isFinite(n) || n < 0 || n > 17) {
      return "Informe a idade (de 0 a 17 anos) de cada criança.";
    }
  }
  return "";
}

// Perfis salvos antes desta versão só tinham a contagem de adultos e as idades.
export function membrosDoPerfil(perfil) {
  if (Array.isArray(perfil.membros)) return perfil.membros;
  const adultos = Math.max(0, (perfil.adultos ?? 1) - 1);
  return [
    ...Array.from({ length: adultos }, () => novoMembro(true)),
    ...(perfil.criancas ?? []).map((idade) => ({ nome: "", adulto: false, idade: String(idade) })),
  ];
}

export const rotuloIdade = (n) => (Number(n) === 1 ? "1 ano" : `${n} anos`);

export function rotuloMembro(m) {
  const nome = m.nome?.trim();
  if (m.adulto) return nome || "Adulto";
  return `${nome || "Criança"} (${rotuloIdade(m.idade)})`;
}

export const descreverFamilia = (nomeDoUsuario, membros) =>
  [`${nomeDoUsuario} (você)`, ...membros.map(rotuloMembro)].join(", ");

export function limparMembros(membros) {
  return membros.slice(0, MAX_MEMBROS).map((m) => ({
    nome: String(m.nome ?? "").trim().slice(0, 30),
    adulto: Boolean(m.adulto),
    idade: m.adulto ? "" : String(Math.round(Number(m.idade))),
  }));
}
