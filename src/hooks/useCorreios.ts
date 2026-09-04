import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ponte com a API dos Correios, sempre pela Edge Function `correios`.
 *
 * O código de acesso do CWS NUNCA chega ao browser — ele é secret da function.
 * Aqui só trafega o que a tela precisa mostrar.
 */

export interface SituacaoObjeto {
  codigo: string;
  /** Preenchida quando o objeto não existe ou não é do contrato da empresa. */
  mensagem: string | null;
  descricao: string | null;
  data: string | null;
  local: string | null;
  entregue: boolean;
}

export interface EnderecoCep {
  cep: string;
  logradouro: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** O SRO aceita no máximo 50 códigos por chamada. */
const LOTE = 50;

export async function rastrearObjetos(codigos: string[]): Promise<SituacaoObjeto[]> {
  const limpos = [...new Set(codigos.map((c) => (c ?? "").trim().toUpperCase()).filter(Boolean))];
  if (limpos.length === 0) return [];

  const out: SituacaoObjeto[] = [];
  for (let i = 0; i < limpos.length; i += LOTE) {
    const { data, error } = await supabase.functions.invoke("correios", {
      body: { acao: "rastrear", codigos: limpos.slice(i, i + LOTE) },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    out.push(...(data?.objetos ?? []));
  }
  return out;
}

/**
 * Situação dos objetos, indexada por código.
 *
 * `staleTime` alto de propósito: os Correios atualizam os eventos algumas
 * vezes por dia, não a cada minuto. Refazer a consulta a cada foco da janela
 * gastaria chamada à toa e deixaria a tela piscando sem nada mudar.
 */
export function useRastreioEmLote(codigos: string[], enabled = true) {
  const chave = [...new Set(codigos.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["correios_rastro", chave],
    enabled: enabled && chave.length > 0,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Rastreio é acessório: a tela de pedidos funciona sem ele. Uma falha aqui
    // não pode virar retentativa em cascata na fila inteira.
    retry: false,
    queryFn: async () => {
      const lista = await rastrearObjetos(chave);
      return Object.fromEntries(lista.map((o) => [o.codigo, o])) as Record<string, SituacaoObjeto>;
    },
  });
}

export interface Cotacao {
  produto: string;
  /** Formato brasileiro ("129,47"), como os Correios devolvem. */
  precoTotal: string | null;
  precoProduto: string | null;
  adicionais: { codigo: string; valor: string }[];
  pesoCobradoKg: string | null;
  prazoDias: number | null;
  prazoAte: string | null;
}

export interface PedidoCotacao {
  cepOrigem: string;
  cepDestino: string;
  pesoKg: number;
  comprimento: number;
  largura: number;
  altura: number;
  valorDeclarado?: number;
}

/**
 * Preço e prazo ANTES de postar — é simulação, não exige objeto nenhum.
 *
 * Hoje o Compras só descobre o custo quando o cupom imprime no balcão, com o
 * dinheiro já gasto. Validado em 04/09/2026 contra o cupom real do objeto
 * AD867127447BR: a API devolveu 125,23 + 4,24 = 129,47, os três idênticos ao
 * impresso na agência.
 */
export async function cotarFrete(pedido: PedidoCotacao): Promise<Cotacao> {
  const { data, error } = await supabase.functions.invoke("correios", {
    body: { acao: "cotar", cotacao: pedido },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as Cotacao;
}

/** "129,47" → 129.47. Os Correios devolvem no formato brasileiro. */
export function precoParaNumero(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const n = Number(String(valor).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function buscarCep(cep: string): Promise<EnderecoCep> {
  const { data, error } = await supabase.functions.invoke("correios", {
    body: { acao: "cep", cep },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as EnderecoCep;
}

/**
 * Situação em texto curto + cor, para o badge do card.
 *
 * Os Correios devolvem a frase inteira ("Objeto aguardando retirada na Caixa
 * Postal"), que não cabe num badge. O encurtamento preserva o que muda a ação
 * de quem lê: entregue, parado esperando alguém, ou a caminho.
 */
export function resumirSituacao(s: SituacaoObjeto | undefined): { texto: string; classe: string } | null {
  if (!s) return null;
  if (s.mensagem) {
    return { texto: s.mensagem, classe: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  }
  if (!s.descricao) return null;

  const d = s.descricao;
  if (s.entregue) {
    return { texto: "Entregue", classe: "border-emerald-400/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" };
  }
  // "Aguardando retirada" é o estado que mais dói na operação: o material
  // chegou na cidade e está parado esperando alguém buscar. Merece âmbar.
  if (/aguardando retirada/i.test(d)) {
    return { texto: "Aguardando retirada", classe: "border-amber-400/50 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" };
  }
  if (/n[ãa]o entregue|devolv|extravi|roubo|avaria/i.test(d)) {
    return { texto: d, classe: "border-red-400/50 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" };
  }
  if (/transfer[êe]ncia|encaminhado|postado|sa[íi]u para entrega/i.test(d)) {
    const texto = /sa[íi]u para entrega/i.test(d) ? "Saiu para entrega"
      : /postado/i.test(d) ? "Postado"
      : "Em trânsito";
    return { texto, classe: "border-blue-400/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300" };
  }
  return { texto: d, classe: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
}
