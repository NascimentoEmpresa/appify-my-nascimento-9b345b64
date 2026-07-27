// Mapa fixo Setor -> responsável padrão do Plano de Ações.
// Usado só para sugerir automaticamente o Responsável quando o usuário
// preenche o campo Setor (ver handleSetorChange em Detalhe.tsx). Chave
// normalizada (minúsculo, sem acento, trim) para casar com o texto digitado
// ou escolhido, independente de acentuação/caixa.
//
// Resolve por NOME (via acharUsuarioPorNome, igual ao líder fixo de
// "Gestor"/"Sistemas" em Detalhe.tsx) em vez de profile_id fixo — um id
// errado de cabeça aponta silenciosamente pra pessoa errada (já aconteceu:
// "Sistemas" apontava pro Cassio, o correto é o Iury); por nome, se algo
// não bater, o campo simplesmente não é preenchido, sem risco de vincular
// o usuário errado.

export interface SetorResponsavel {
  nome: string;
}

export const SETOR_RESPONSAVEL_MAP: Record<string, SetorResponsavel> = {
  "compras":                { nome: "cassio raphaelli camargo duarte" },
  "controladoria":          { nome: "yuri rosa" },
  "diretor administrativo": { nome: "fernanda maldaner" },
  "diretor operacional":    { nome: "senilton ramos do nascimento" },
  "financeiro":             { nome: "caroline prisco lopes" },
  "juridico":               { nome: "natalia taborda" },
  "licitacao":              { nome: "lucas de jesus silva" },
  "operacional":            { nome: "daison tavares rodrigues" },
  "padrao":                 { nome: "cassio raphaelli camargo duarte" },
  "presidencia":            { nome: "helena nascimento" },
  "rh":                     { nome: "alessandra aparecida de vargas" },
  "seguranca":              { nome: "milena da cunha castro" },
  "sistemas":               { nome: "iury de jesus silva" },
  "sst":                    { nome: "milena da cunha castro" },
  "treinamentos":           { nome: "francieli silva do nascimento" },
};

export function normalizeSetorNome(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}
