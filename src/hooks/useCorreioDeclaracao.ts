import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hojeISO } from "@/hooks/useSupPedidos";

// O schema chega por migrations aplicadas manualmente antes da regeneração de
// types.ts; este cast segue o padrão dos demais hooks de Suprimentos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface ItemDeclaracaoCorreio {
  id?: string;
  conteudo: string;
  quantidade: number;
  valor: number | null;
  ordem: number;
}

export interface CamposDestinatario {
  dest_nome: string;
  dest_cnpj: string;
  dest_endereco: string;
  dest_complemento: string;
  dest_bairro: string;
  dest_cidade: string;
  dest_uf: string;
  dest_cep: string;
}

export interface DeclaracaoCorreio extends CamposDestinatario {
  id?: string;
  empresa_id: string;
  numero?: string;
  pedido_id: string | null;
  pedido_protocolo: string;
  rem_nome: string;
  rem_cnpj: string;
  rem_endereco: string;
  rem_complemento: string;
  rem_bairro: string;
  rem_cidade: string;
  rem_uf: string;
  rem_cep: string;
  rem_caixa_postal: string;
  peso_total_kg: number | null;
  assinatura_cidade: string;
  assinatura_data: string;
  criado_por?: string | null;
  criado_por_nome?: string | null;
  created_at?: string;
  updated_at?: string;
  sup_correio_declaracao_item: ItemDeclaracaoCorreio[];
}

function normalizarDeclaracao(d: DeclaracaoCorreio): DeclaracaoCorreio {
  return {
    ...d,
    pedido_protocolo: d.pedido_protocolo ?? "",
    rem_nome: d.rem_nome ?? "",
    rem_cnpj: d.rem_cnpj ?? "",
    rem_endereco: d.rem_endereco ?? "",
    rem_complemento: d.rem_complemento ?? "",
    rem_bairro: d.rem_bairro ?? "",
    rem_cidade: d.rem_cidade ?? "",
    rem_uf: d.rem_uf ?? "",
    rem_cep: d.rem_cep ?? "",
    rem_caixa_postal: d.rem_caixa_postal ?? "",
    dest_nome: d.dest_nome ?? "",
    dest_cnpj: d.dest_cnpj ?? "",
    dest_endereco: d.dest_endereco ?? "",
    dest_complemento: d.dest_complemento ?? "",
    dest_bairro: d.dest_bairro ?? "",
    dest_cidade: d.dest_cidade ?? "",
    dest_uf: d.dest_uf ?? "",
    dest_cep: d.dest_cep ?? "",
    assinatura_cidade: d.assinatura_cidade ?? "",
    assinatura_data: d.assinatura_data ?? "",
    sup_correio_declaracao_item: d.sup_correio_declaracao_item ?? [],
  };
}

interface PedidoParaDeclaracao {
  id: string;
  pedido_id: string;
  empresa_id: string;
  contrato_nome: string;
  sup_pedido_item: Array<{
    id: string;
    nome_item: string;
    tamanho: string | null;
    litros: string | null;
    quantidade: number;
    ordem: number;
  }>;
}

/**
 * Esta é a única costura entre pedido/contrato e os campos de destinatário.
 * Hoje contratos ainda não têm endereço: só o nome é preenchido. Quando a
 * frente paralela acrescentar logradouro/complemento/bairro/cidade/UF/CEP e
 * CNPJ, muda-se esta função — formulário e impressão permanecem intocados.
 */
export function preencherDestinatario(pedido: PedidoParaDeclaracao): CamposDestinatario {
  return {
    dest_nome: pedido.contrato_nome ?? "",
    dest_cnpj: "",
    dest_endereco: "",
    dest_complemento: "",
    dest_bairro: "",
    dest_cidade: "",
    dest_uf: "",
    dest_cep: "",
  };
}

export function novaDeclaracao(empresaId = ""): DeclaracaoCorreio {
  return {
    empresa_id: empresaId,
    pedido_id: null,
    pedido_protocolo: "",
    rem_nome: "",
    rem_cnpj: "",
    rem_endereco: "",
    rem_complemento: "",
    rem_bairro: "",
    rem_cidade: "",
    rem_uf: "",
    rem_cep: "",
    rem_caixa_postal: "",
    ...preencherDestinatario({
      id: "", pedido_id: "", empresa_id: empresaId, contrato_nome: "", sup_pedido_item: [],
    }),
    peso_total_kg: null,
    assinatura_cidade: "",
    assinatura_data: hojeISO(),
    sup_correio_declaracao_item: [
      { conteudo: "", quantidade: 1, valor: null, ordem: 0 },
    ],
  };
}

function descricaoItem(item: PedidoParaDeclaracao["sup_pedido_item"][number]) {
  const detalhes = [item.tamanho && `Tam. ${item.tamanho}`, item.litros && `${item.litros} L`]
    .filter(Boolean)
    .join(" · ");
  return detalhes ? `${item.nome_item} (${detalhes})` : item.nome_item;
}

export async function buscarPedidoParaDeclaracao(protocolo: string): Promise<DeclaracaoCorreio> {
  const { data: pedido, error } = await sb
    .from("sup_pedido")
    .select("id, pedido_id, empresa_id, contrato_nome, sup_pedido_item(id, nome_item, tamanho, litros, quantidade, ordem)")
    .eq("pedido_id", protocolo.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  if (!pedido) throw new Error("ID interno não encontrado.");

  const { data: empresa, error: erroEmpresa } = await sb
    .from("empresas")
    .select("razao_social, cnpj")
    .eq("id", pedido.empresa_id)
    .single();
  if (erroEmpresa) throw erroEmpresa;

  const { data: tags, error: erroTags } = await sb.rpc("sup_est_tags_do_pedido", {
    p_pedido_id: pedido.id,
  });
  if (erroTags) throw erroTags;

  const maiorValor = new Map<string, number>();
  for (const tag of tags ?? []) {
    const valor = Number(tag.valor_unitario ?? 0);
    if (valor > (maiorValor.get(tag.pedido_item_id) ?? 0)) maiorValor.set(tag.pedido_item_id, valor);
  }

  const base = novaDeclaracao(pedido.empresa_id);
  return {
    ...base,
    pedido_id: pedido.id,
    pedido_protocolo: pedido.pedido_id,
    rem_nome: empresa?.razao_social ?? "",
    rem_cnpj: empresa?.cnpj ?? "",
    ...preencherDestinatario(pedido),
    peso_total_kg: null,
    assinatura_data: hojeISO(),
    sup_correio_declaracao_item: [...(pedido.sup_pedido_item ?? [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((item, ordem) => ({
        conteudo: descricaoItem(item),
        quantidade: item.quantidade,
        valor: maiorValor.get(item.id) ?? null,
        ordem,
      })),
  };
}

export function useDeclaracoesCorreio(empresaId?: string | null) {
  return useQuery({
    queryKey: ["sup_correio_declaracao", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<DeclaracaoCorreio[]> => {
      const { data, error } = await sb
        .from("sup_correio_declaracao")
        .select("*, sup_correio_declaracao_item(*)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((item: DeclaracaoCorreio) => normalizarDeclaracao(item));
    },
  });
}

export async function buscarDeclaracaoCompleta(numero: string): Promise<DeclaracaoCorreio> {
  const { data, error } = await sb
    .from("sup_correio_declaracao")
    .select("*, sup_correio_declaracao_item(*)")
    .eq("numero", numero)
    .single();
  if (error) throw error;
  return normalizarDeclaracao(data as DeclaracaoCorreio);
}

export function useSalvarDeclaracaoCorreio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (declaracao: DeclaracaoCorreio): Promise<DeclaracaoCorreio> => {
      const validos = declaracao.sup_correio_declaracao_item.filter((item) => item.conteudo.trim());
      const { sup_correio_declaracao_item, ...campos } = declaracao;
      const itens = validos.map((item, ordem) => ({
        conteudo: item.conteudo.trim(),
        quantidade: Math.max(1, Number(item.quantidade) || 1),
        valor: item.valor == null ? null : Number(item.valor),
        ordem,
      }));
      const { data, error } = await sb.rpc("sup_correio_declaracao_salvar", {
        p_payload: { ...campos, itens },
      });
      if (error) throw error;
      return normalizarDeclaracao({ ...(data as DeclaracaoCorreio), sup_correio_declaracao_item: itens });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sup_correio_declaracao"] }),
  });
}
