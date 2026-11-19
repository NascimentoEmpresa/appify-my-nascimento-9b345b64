// Cargos oferecidos no "Cargo" da Admissão (Solicitar Vaga), a partir do
// catálogo do contrato.
//
// 19/11/2026 — Pablo: no UFFS REALEZA o Quadro de Postos tem "LAV. DE ROUPAS
// A MÁQUINA - REALEZA", "RECEPCIONISTA - REALEZA" e "TRADUTOR/INTERPRETE DE
// LIBRAS - REALEZA", todos com "função não escolhida" — e nenhum aparecia no
// Cargo, porque a lista era só de FUNÇÕES (sup_funcao). Posto da Planilha de
// Custo sem função nenhuma sumia.
//
// Agora: toda função ativa do contrato (como antes) + cada posto da planilha
// que NÃO tem função. O posto entra como cargo com o nome limpo (sem o
// " - REALEZA" que repete o contrato) e grava posto_id, com funcao_id vazio —
// exatamente o que o "Vínculo com o catálogo" aceita para posto sem função
// ("Posto sem função no catálogo"), então a validação e o V.A/V.T do posto
// seguem iguais. Posto que já tem função não duplica: aparece pelas funções.

export interface FuncaoCargo { id: string; posto_id: string; nome: string; posto_nome: string }
export interface PostoCargo { id: string; nome: string }

export interface OpcaoCargo {
  /** Valor do <select>: o id da função, ou "p:<posto_id>" para posto sem função. */
  valor: string;
  rotulo: string;
  /** O que vai para vaga.cargo. */
  cargo: string;
  posto_id: string;
  funcao_id: string;
}

const PREFIXO_POSTO = "p:";

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * "LAV. DE ROUPAS A MÁQUINA - REALEZA" no contrato "1074 - UFFS REALEZA -
 * 041/2021" → "LAV. DE ROUPAS A MÁQUINA". Só corta o último " - X" quando X
 * está no nome do contrato; senão o nome fica como está ("PORTARIA - BLOCO A").
 */
export function nomeCargoDoPosto(posto: string, contrato: string): string {
  const nome = String(posto ?? "").trim();
  const m = nome.match(/^(.*\S)\s+-\s+([^-]+)$/);
  if (!m) return nome;
  const sufixo = normalizar(m[2]);
  if (sufixo && normalizar(contrato).includes(sufixo)) return m[1].trim();
  return nome;
}

export const valorDoPosto = (postoId: string) => PREFIXO_POSTO + postoId;
export const ehValorDePosto = (v: string) => v.startsWith(PREFIXO_POSTO);

export function opcoesDeCargo(funcoes: FuncaoCargo[], postos: PostoCargo[], contrato: string): OpcaoCargo[] {
  const repetidos = new Set(funcoes.map(f => f.nome).filter((n, i, a) => a.indexOf(n) !== i));
  const deFuncao: OpcaoCargo[] = funcoes.map(f => ({
    valor: f.id,
    rotulo: repetidos.has(f.nome) ? `${f.nome} — ${f.posto_nome}` : f.nome,
    cargo: f.nome, posto_id: f.posto_id, funcao_id: f.id,
  }));
  const comFuncao = new Set(funcoes.map(f => f.posto_id));
  const nomesFuncao = new Set(funcoes.map(f => normalizar(f.nome)));
  const dePosto: OpcaoCargo[] = postos
    .filter(p => p.id && !comFuncao.has(p.id))
    .map(p => {
      const cargo = nomeCargoDoPosto(p.nome, contrato);
      // Nome igual ao de uma função de outro posto: o posto entra no rótulo.
      const rotulo = nomesFuncao.has(normalizar(cargo)) ? `${cargo} — ${p.nome}` : cargo;
      return { valor: valorDoPosto(p.id), rotulo, cargo, posto_id: p.id, funcao_id: "" };
    });
  return [...deFuncao, ...dePosto].sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/** Valor do <select> de Cargo para o que a vaga tem gravado hoje. */
export function valorCargoSelecionado(
  vaga: { cargo: string; posto_id: string; funcao_id: string },
  opcoes: OpcaoCargo[],
): string {
  if (vaga.funcao_id) return vaga.funcao_id;
  if (vaga.posto_id && opcoes.some(o => o.valor === valorDoPosto(vaga.posto_id) && o.cargo === vaga.cargo)) {
    return valorDoPosto(vaga.posto_id);
  }
  return vaga.cargo ? "q:" + vaga.cargo : "";
}
