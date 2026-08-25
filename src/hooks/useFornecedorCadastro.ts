import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Cadastro de fornecedor preenchido pelo próprio fornecedor (SIS-2026-0209).
 *
 * O comprador gera um convite, manda o link no WhatsApp, o fornecedor preenche
 * sem login e o cadastro cai numa fila para aprovação. Só depois de aprovado
 * vira `public.fornecedor`.
 *
 * Toda escrita passa por RPC, como manda o módulo. O lado público não está
 * aqui: ele fala com a Edge Function fornecedor-cadastro-publico, porque quem
 * preenche não tem sessão. Ver
 * supabase/migrations/20260925000003_fornecedor_cadastro_externo.sql.
 */

const sb = supabase as any;

export type StatusPendente = "pendente" | "aprovado" | "reprovado";

export interface ContaBancariaPendente {
  banco_codigo?: string; banco_nome?: string;
  agencia?: string; agencia_digito?: string;
  conta?: string; conta_digito?: string;
  tipo?: string; titular_nome?: string; titular_documento?: string;
  pix_tipo?: string; pix_chave?: string; principal?: boolean;
}

export interface CadastroPendente {
  id: string;
  convite_id: string | null;
  tipo: "pj" | "pf";
  cnpj_cpf: string;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_estadual: string | null;
  cnae_principal: string | null;
  email: string | null;
  email_financeiro: string | null;
  email_nota_fiscal: string | null;
  contato: string | null;
  telefone: string | null;
  telefone_vendedor: string | null;
  cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null;
  formas_pagamento: string[];
  condicao_pagamento: string | null;
  prazo_entrega_dias: number | null;
  devolucao_prazo_dias: number | null;
  devolucao_procedimento: string | null;
  observacoes: string | null;
  contas_bancarias: ContaBancariaPendente[];
  status: StatusPendente;
  motivo_reprovacao: string | null;
  empresa_id: string | null;
  fornecedor_id: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  created_at: string;
}

export interface Convite {
  id: string; token: string; destinatario: string | null; observacao: string | null;
  criado_por_nome: string | null; expira_em: string | null; usado_em: string | null;
  created_at: string;
}

/** Fornecedor já existente com o mesmo CNPJ — decide se a aprovação é atualização. */
export interface FornecedorExistente {
  id: string; empresa_id: string; razao_social: string; ativo: boolean;
}

export const FORMAS_PAGAMENTO = [
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "pix", rotulo: "PIX" },
  { valor: "transferencia", rotulo: "Transferência / TED" },
] as const;

/** Campos que a fila compara quando o CNPJ já existe. */
export const CAMPOS_COMPARAVEIS: { chave: keyof CadastroPendente; rotulo: string }[] = [
  { chave: "razao_social", rotulo: "Razão social" },
  { chave: "nome_fantasia", rotulo: "Nome fantasia" },
  { chave: "inscricao_estadual", rotulo: "Inscrição estadual" },
  { chave: "cnae_principal", rotulo: "CNAE" },
  { chave: "contato", rotulo: "Contato" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "email_financeiro", rotulo: "E-mail financeiro" },
  { chave: "email_nota_fiscal", rotulo: "E-mail da nota fiscal" },
  { chave: "telefone", rotulo: "Telefone" },
  { chave: "telefone_vendedor", rotulo: "Telefone do vendedor" },
  { chave: "cep", rotulo: "CEP" },
  { chave: "logradouro", rotulo: "Logradouro" },
  { chave: "numero", rotulo: "Número" },
  { chave: "complemento", rotulo: "Complemento" },
  { chave: "bairro", rotulo: "Bairro" },
  { chave: "cidade", rotulo: "Cidade" },
  { chave: "uf", rotulo: "UF" },
  { chave: "formas_pagamento", rotulo: "Formas de pagamento" },
  { chave: "condicao_pagamento", rotulo: "Condição de pagamento" },
  { chave: "prazo_entrega_dias", rotulo: "Prazo de entrega (dias)" },
  { chave: "devolucao_prazo_dias", rotulo: "Prazo de devolução (dias)" },
  { chave: "devolucao_procedimento", rotulo: "Procedimento de devolução" },
  { chave: "observacoes", rotulo: "Observações" },
];

/** Só os dígitos — o fornecedor digita com máscara, o cadastro antigo nem sempre tem. */
export function soDigitos(v?: string | null): string {
  return (v ?? "").replace(/\D/g, "");
}

export type Destino =
  | { tipo: "novo"; existeEmOutras: FornecedorExistente[] }
  | { tipo: "atualizacao"; alvo: FornecedorExistente; existeEmOutras: FornecedorExistente[] };

/**
 * Decide se aprovar aquele cadastro cria um fornecedor NOVO ou ATUALIZA o que
 * já existe.
 *
 * A pergunta só tem resposta depois de escolhida a empresa: `public.fornecedor`
 * é UNIQUE (empresa_id, cnpj_cpf), então o MESMO CNPJ pode — e costuma —
 * existir em mais de uma empresa do grupo. Achar o CNPJ em qualquer lugar não
 * basta; tem de ser na empresa que vai receber o cadastro.
 */
export function decidirDestino(
  existentes: FornecedorExistente[],
  empresaId: string | null,
): Destino {
  const alvo = empresaId ? existentes.find((f) => f.empresa_id === empresaId) : undefined;
  const existeEmOutras = existentes.filter((f) => f.empresa_id !== empresaId);
  return alvo ? { tipo: "atualizacao", alvo, existeEmOutras } : { tipo: "novo", existeEmOutras };
}

export function fmtDataHora(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function fmtDoc(v?: string | null): string {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v ?? "—";
}

// ── Fila ─────────────────────────────────────────────────────────────

export function useCadastrosPendentes() {
  return useQuery({
    queryKey: ["fornecedor_cadastro_pendente"],
    queryFn: async (): Promise<CadastroPendente[]> => {
      const { data, error } = await sb
        .from("fornecedor_cadastro_pendente")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConvites() {
  return useQuery({
    queryKey: ["fornecedor_convite"],
    queryFn: async (): Promise<Convite[]> => {
      const { data, error } = await sb
        .from("fornecedor_convite")
        .select("id, token, destinatario, observacao, criado_por_nome, expira_em, usado_em, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Fornecedores já cadastrados com o mesmo CNPJ, em qualquer empresa.
 * É o que a tela usa para avisar "este CNPJ já existe" antes mesmo de o
 * aprovador escolher a empresa.
 */
export function useCnpjExistente(cnpj: string | null) {
  return useQuery({
    queryKey: ["sup_forn_cnpj_existente", cnpj],
    enabled: !!cnpj,
    queryFn: async (): Promise<FornecedorExistente[]> => {
      const { data, error } = await sb.rpc("sup_forn_cnpj_existente", { p_cnpj: cnpj });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    ["fornecedor_cadastro_pendente", "fornecedor_convite", "fornecedor", "sup_fornecedores"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

export function useGerarConvite() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (p: { destinatario?: string; observacao?: string; dias?: number }) => {
      const { data, error } = await sb.rpc("sup_forn_gerar_convite", {
        p_destinatario: p.destinatario ?? null,
        p_observacao: p.observacao ?? null,
        p_dias: p.dias ?? 30,
      });
      if (error) throw error;
      return data as Convite;
    },
    onSuccess: invalidar,
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível gerar o link."),
  });
}

export function useAprovarCadastro() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (p: { id: string; empresaId: string; campos?: string[] | null }) => {
      const { data, error } = await sb.rpc("sup_forn_aprovar", {
        p_id: p.id,
        p_empresa_id: p.empresaId,
        // null = traz tudo que não é nulo. Lista = só o que o aprovador marcou.
        p_campos: p.campos ? Object.fromEntries(p.campos.map((c) => [c, true])) : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Cadastro aprovado.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível aprovar."),
  });
}

export function useReprovarCadastro() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (p: { id: string; motivo: string }) => {
      const { error } = await sb.rpc("sup_forn_reprovar", { p_id: p.id, p_motivo: p.motivo });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Cadastro reprovado.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível reprovar."),
  });
}

/** URL que o comprador manda pro fornecedor. */
export function linkDoConvite(token: string): string {
  return `${window.location.origin}/fornecedor/cadastro/${token}`;
}
