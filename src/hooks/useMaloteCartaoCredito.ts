import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0224: Submódulo Cartão de Crédito (Financeiro > Gestão
// Financeira), para conferência de faturas. "tipo_forma_pagamento" liga o
// cartão ao valor de malote_tipo_forma_pagamento usado em
// malote_despesa.forma_pagamento (confirmado lendo CriarDespesa.tsx — o
// Select de forma de pagamento da despesa usa esse catálogo, não
// malote_forma_pagamento) — é o que permite casar os lançamentos do
// Malote com o cartão certo.
//
// Banco/Bandeira viram catálogo de verdade (malote_cartao_banco/
// malote_cartao_bandeira) com logo próprio, gerenciável dentro da própria
// tela de Cartão de Crédito — dropdown fechado, sem texto livre (pedido
// do usuário).

const BUCKET_LOGOS = "cartao-logos";

export function urlLogoCartao(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(BUCKET_LOGOS).getPublicUrl(path).data.publicUrl;
}

export interface CartaoCatalogoItem {
  id: string;
  nome: string;
  logo_path: string | null;
  ativo: boolean;
}

function useCatalogoCartao(tabela: "malote_cartao_banco" | "malote_cartao_bandeira", key: string) {
  return useQuery({
    queryKey: [key],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(tabela)
        .select("id, nome, logo_path, ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CartaoCatalogoItem[];
    },
  });
}

function useSalvarCatalogoCartao(tabela: "malote_cartao_banco" | "malote_cartao_bandeira", key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nome, arquivo }: { nome: string; arquivo: File | null }) => {
      let logo_path: string | undefined;
      if (arquivo) {
        const ext = arquivo.name.split(".").pop() ?? "png";
        const path = `${tabela === "malote_cartao_banco" ? "bancos" : "bandeiras"}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET_LOGOS).upload(path, arquivo, { upsert: true });
        if (uploadError) throw uploadError;
        logo_path = path;
      }
      const payload: Record<string, unknown> = { nome: nome.trim() };
      if (logo_path) payload.logo_path = logo_path;
      const { error } = await (supabase as any).from(tabela).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

function useAtualizarStatusCatalogoCartao(tabela: "malote_cartao_banco" | "malote_cartao_bandeira", key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any).from(tabela).update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  });
}

const BANCOS_KEY = "malote_cartao_banco";
const BANDEIRAS_KEY = "malote_cartao_bandeira";

export const useCartaoBancos = () => useCatalogoCartao("malote_cartao_banco", BANCOS_KEY);
export const useSalvarCartaoBanco = () => useSalvarCatalogoCartao("malote_cartao_banco", BANCOS_KEY);
export const useAtualizarStatusCartaoBanco = () => useAtualizarStatusCatalogoCartao("malote_cartao_banco", BANCOS_KEY);

export const useCartaoBandeiras = () => useCatalogoCartao("malote_cartao_bandeira", BANDEIRAS_KEY);
export const useSalvarCartaoBandeira = () => useSalvarCatalogoCartao("malote_cartao_bandeira", BANDEIRAS_KEY);
export const useAtualizarStatusCartaoBandeira = () => useAtualizarStatusCatalogoCartao("malote_cartao_bandeira", BANDEIRAS_KEY);

export interface CartaoCredito {
  id: string;
  nome_cartao: string;
  tipo_forma_pagamento: string;
  empresa_id: string;
  banco_id: string;
  bandeira_id: string;
  dia_fechamento: number;
  dia_vencimento: number;
  limite: number;
  ativo: boolean;
  // SIS-2026-0255 (achado testando import de fatura): mais de um cartão
  // cadastrado pode ter o MESMO titular em bancos diferentes (ex. "HELENA"
  // no Banrisul e no Banco do Brasil) — usuário confundiu qual selecionar
  // guiando só pelo nome. 4 últimos dígitos, visível no cadastro e no
  // Select de import.
  final_cartao: string | null;
}

const KEY = "malote_cartao_credito";
const COLUMNS = "id, nome_cartao, tipo_forma_pagamento, empresa_id, banco_id, bandeira_id, dia_fechamento, dia_vencimento, limite, ativo, final_cartao";

export function useCartoesCredito() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_cartao_credito")
        .select(COLUMNS)
        .order("nome_cartao");
      if (error) throw error;
      return (data ?? []) as CartaoCredito[];
    },
  });
}

interface SalvarCartaoCreditoInput {
  id?: string;
  nome_cartao: string;
  tipo_forma_pagamento: string;
  empresa_id: string;
  banco_id: string;
  bandeira_id: string;
  dia_fechamento: number;
  dia_vencimento: number;
  limite: number;
  ativo: boolean;
  final_cartao: string | null;
}

export function useSalvarCartaoCredito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarCartaoCreditoInput) => {
      const payload = { ...input, nome_cartao: input.nome_cartao.trim() };
      const { error } = await (supabase as any).from("malote_cartao_credito").upsert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// Exclusão de verdade (não é "inativar") — a RLS já restringe por
// can_access(..., 'financeiro-cartao-credito', 'excluir'), a burocracia
// extra (digitar o nome do cartão de novo) é só no frontend, ver
// BotaoExcluirCartao em CartaoCredito.tsx.
export function useExcluirCartaoCredito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_cartao_credito").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// Regra 5 do Anexo 1 (SIS-2026-0224): se o dia do pagamento for menor ou
// igual ao fechamento, entra na fatura do próprio mês; se for maior, entra
// na fatura do mês seguinte. Retorna "YYYY-MM".
export function calcularFatura(dataPagamento: string, diaFechamento: number): string {
  const data = new Date(dataPagamento + "T00:00:00");
  let ano = data.getFullYear();
  let mes = data.getMonth(); // 0-indexado
  if (data.getDate() > diaFechamento) {
    mes += 1;
    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
}
