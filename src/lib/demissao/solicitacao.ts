// Solicitação de Demissão — as regras que as três telas compartilham.
//
// O encarregado abre, o operacional decide e o RH conclui. Como são três
// telas diferentes lendo a mesma tabela, o que define o fluxo (as opções dos
// campos, os status e quem pode agir em cada um) mora aqui — assim o painel
// do RH não pode discordar do formulário do encarregado sobre o que é uma
// solicitação válida.

export const TABELA = "SISTEMA_SOLICITACOES_DEMISSAO";
export const TABELA_ANEXOS = "SISTEMA_SOL_DEMISSAO_ANEXOS";
export const BUCKET = "demissoes-docs";

// ── Opções dos campos ────────────────────────────────────────────────
export const MOTIVOS_SOLICITACAO = [
  "Pedido de demissão pelo colaborador",
  "Desligamento por justa causa",
  "Desligamento sem justa causa",
  "Término de contrato de experiência",
  "Abandono de emprego",
  "Outro",
] as const;

export const MOTIVOS_PEDIDO = [
  "Insatisfação salarial",
  "Proposta de outro emprego",
  "Problemas pessoais/familiares",
  "Insatisfação com o ambiente de trabalho",
  "Mudança de cidade",
  "Problemas de saúde",
  "Aposentadoria",
  "Abandono de emprego",
  "Falta grave/indisciplina",
  "Não informado",
  "Outro",
] as const;

export const TERMINOS_EXPERIENCIA = [
  "Não se aplica",
  "Dentro do período de experiência (até 30 dias)",
  "Dentro do período de experiência (até 90 dias)",
  "Após período de experiência",
  "Outro",
] as const;

export const MODELOS_AVISO = [
  "Aviso Prévio Trabalhado",
  "Aviso Prévio Indenizado",
  "Dispensa do Aviso Prévio",
  "Não se aplica",
  "Término de contrato (ausência e dispensa)",
] as const;

// ── Documentos ───────────────────────────────────────────────────────
// O teto de 10 MB é o mesmo do bucket: validar aqui faz o erro aparecer no
// formulário, em vez de voltar como um 413 sem explicação depois do upload.
export const MAX_ARQUIVO_BYTES = 10 * 1024 * 1024;
export const EXTENSOES_ACEITAS = [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"];
export const ACCEPT_ANEXO = EXTENSOES_ACEITAS.join(",");

/** Diz por que o arquivo não serve, ou null se está tudo certo. */
export function erroDoArquivo(f: File): string | null {
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (!EXTENSOES_ACEITAS.includes(ext)) {
    return `"${f.name}": formato não aceito. Envie ${EXTENSOES_ACEITAS.join(", ")}.`;
  }
  if (f.size > MAX_ARQUIVO_BYTES) {
    return `"${f.name}": ${(f.size / 1024 / 1024).toFixed(1)} MB — o limite é 10 MB por arquivo.`;
  }
  return null;
}

// ── Status ───────────────────────────────────────────────────────────
// O status é o andamento do pedido, não um campo livre: quem muda é sempre
// uma ação de tela (aprovar, reprovar, concluir), nunca digitação.
export type Status =
  | "Pendente Operacional"
  | "Reprovada"
  | "Pendente RH"
  | "Pendente SST"
  | "Concluída"
  | "Cancelada";

export const STATUS_TODOS: Status[] = [
  "Pendente Operacional", "Pendente RH", "Pendente SST", "Concluída", "Reprovada", "Cancelada",
];

/** Cor do selo de status — a mesma régua nas três telas. */
export function corDoStatus(status: string): string {
  const cores: Record<string, string> = {
    "Pendente Operacional": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente RH": "bg-purple-100 text-purple-700 border-purple-200",
    "Pendente SST": "bg-cyan-100 text-cyan-800 border-cyan-200",
    "Concluída": "bg-green-100 text-green-700 border-green-200",
    "Reprovada": "bg-red-100 text-red-700 border-red-200",
    "Cancelada": "bg-slate-100 text-slate-600 border-slate-200",
  };
  return cores[status] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

/** O que ainda falta acontecer, em uma frase, para quem só acompanha. */
export function explicaStatus(status: string): string {
  const textos: Record<string, string> = {
    "Pendente Operacional": "Aguardando a aprovação do Operacional.",
    "Pendente RH": "Aprovada pelo Operacional. Aguardando o RH concluir.",
    "Pendente SST": "O RH concluiu. O SST vai marcar o ASO demissional.",
    "Concluída": "ASO demissional marcado. Desligamento concluído.",
    "Reprovada": "O Operacional reprovou — veja o motivo.",
    "Cancelada": "A solicitação foi cancelada.",
  };
  return textos[status] ?? "";
}

// ── A solicitação ────────────────────────────────────────────────────
export interface SolicitacaoDemissao {
  id: number;
  solicitante_nome: string | null;
  solicitante_email: string | null;
  data_solicitacao: string | null;

  colaborador_id: number | null;
  colaborador_nome: string | null;
  colaborador_cpf: string | null;
  colaborador_posto: string | null;
  colaborador_cargo: string | null;
  colaborador_filial: string | null;
  colaborador_admissao: string | null;
  colaborador_telefone: string | null;
  colaborador_email: string | null;
  contrato: string | null;
  contrato_id: number | null;
  escala: string | null;

  motivo_solicitacao: string | null;
  motivo_pedido: string | null;
  relato: string | null;

  termino_experiencia: string | null;
  data_aviso: string | null;
  modelo_aviso: string | null;

  status: string;
  operacional_por: string | null;
  operacional_em: string | null;
  operacional_motivo: string | null;
  rh_por: string | null;
  rh_em: string | null;
  rh_observacao: string | null;

  // ASO demissional. Os nomes são os MESMOS do ASO de admissão
  // (WA_CURRICULOS.sst_*) de propósito: quem trabalha no SST preenche a mesma
  // ficha nas duas pontas, e um dia dá para juntar as telas sem renomear
  // coluna nenhuma.
  sst_data_exame: string | null;
  sst_hora_exame: string | null;
  sst_local_exame: string | null;
  sst_maps_url: string | null;
  sst_observacao: string | null;
  sst_por: string | null;
  sst_em: string | null;

  criado_em: string | null;
  atualizado_em: string | null;
}

export interface AnexoDemissao {
  id: number;
  solicitacao_id: number;
  nome: string;
  storage_path: string;
  tamanho: number | null;
  tipo: string | null;
  criado_em: string | null;
}

// ── Formatação ───────────────────────────────────────────────────────
export function fmtData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T12:00:00" : iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString("pt-BR");
}

export function fmtDataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtTamanho(bytes?: number | null): string {
  if (!bytes) return "";
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * Link para abrir o local do ASO no Google Maps — a mesma regra do ASO de
 * admissão: vale o link exato que o SST colou; sem ele, cai na busca pelo
 * texto do local. Null quando não há nem um nem outro.
 */
export function linkDoLocalASO(s: {
  sst_maps_url?: string | null; sst_local_exame?: string | null;
}): string | null {
  const url = String(s.sst_maps_url ?? "").trim();
  if (url) return url;
  const local = String(s.sst_local_exame ?? "").trim();
  return local ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}` : null;
}

/** "12/03/2026 às 09:00 · Clínica X" — o ASO em uma linha. */
export function resumoDoASO(s: {
  sst_data_exame?: string | null; sst_hora_exame?: string | null; sst_local_exame?: string | null;
}): string {
  if (!s.sst_data_exame) return "—";
  const hora = s.sst_hora_exame ? ` às ${s.sst_hora_exame}` : "";
  const local = s.sst_local_exame ? ` · ${s.sst_local_exame}` : "";
  return `${fmtData(s.sst_data_exame)}${hora}${local}`;
}

/** (00) 00000-0000 enquanto digita — o banco guarda o que aparece na tela. */
export function mascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.replace(/^(\d{0,2})/, "($1");
  if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, "($1) $2");
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

export const telefoneCompleto = (v: string) => v.replace(/\D/g, "").length >= 10;
export const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
