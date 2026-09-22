import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useDebounce } from "@/hooks/useDebounce";
import {
  ESTILO_STATUS, fmtDataBR,
  ESTILO_STATUS_ITEM, STATUS_ITEM, derivarStatusItem,
  ESTILO_STATUS_VISIVEL, STATUS_VISIVEL, apresentarStatusVisivel, type SituacaoPedido,
  type StatusComprovacao, type StatusVisivel,
} from "@/hooks/useSupPedidos";
import { ModalBaixaPedido } from "@/components/suprimentos/ModalBaixaPedido";
import { ModalEditarPedido } from "@/components/suprimentos/ModalEditarPedido";
import { ModalEtiquetaTermica } from "@/components/suprimentos/ModalEtiquetaTermica";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useTagsDoPedido, useTagsDePedidos, buscarTagsDePedidos, type TagEmLote } from "@/hooks/useSupEstoque";
import {
  Search, Package, Boxes, Clock, ShoppingCart, Truck, History as HistoryIcon,
  RefreshCw, Inbox, Download, ShieldAlert, Trash2, AlertTriangle, Pencil, Printer, FileText,
  PackageSearch, PackageOpen, Car, HardHat,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { buscarDeclaracaoCompleta } from "@/hooks/useCorreioDeclaracao";
import { imprimirDeclaracao } from "@/lib/suprimentos/declaracaoPrint";
import { abrirComprovacaoPdf } from "@/lib/suprimentos/comprovacaoPdf";
import { ModalFotosComprovacao } from "@/components/suprimentos/ModalFotosComprovacao";
import { ModalFichaEpi } from "@/components/suprimentos/ModalFichaEpi";
import { FotoCracha } from "@/components/suprimentos/FotoCracha";
import { calcularEnvioItens } from "@/lib/suprimentos/envioItens";
import { useRastreioEmLote, resumirSituacao, type SituacaoObjeto } from "@/hooks/useCorreios";

/**
 * Pedidos de Materiais — fila operacional do Supply.
 *
 * Espelha a tela "Status de Pedidos" do legado (REPLICAR §5.5): cards de
 * estatística por status, busca que varre tudo, e um card por pedido com
 * ações de status, edição e histórico.
 *
 * Diferenças em relação ao legado, todas correções de dívidas documentadas:
 *   • o histórico é REAL (tabela sup_pedido_historico), não fabricado a
 *     partir do estado atual com autor fixo (§12.3);
 *   • os itens têm id próprio em tabela filha, então editar o pedido não
 *     quebra vínculo nenhum (§12.7).
 *
 * O bloco de TAGs de estoque entra na Fase 2 — hoje o modal é status +
 * observação, gravados numa transação só via RPC.
 */

const sb = supabase as any;

interface Pedido {
  id: string; pedido_id: string; status: string; data_solicitacao: string;
  contrato_nome: string; posto_nome: string; funcao_nome: string;
  // Os ids da cascata não aparecem no card, mas a edição precisa deles: a
  // função é quem define quais materiais o pedido pode receber.
  contrato_id: string | null; posto_id: string | null; funcao_id: string | null;
  solicitante_login: string; solicitante_nome: string | null;
  nome_colaborador: string; matricula_colaborador: string | null;
  colaborador_empregado_id: number | null; colaborador_digitado: boolean;
  admissao: boolean; tipo_admissao: string | null; data_admissao: string | null;
  tipo_pedido: string; observacoes_solicitante: string | null; observacao: string | null;
  imagem_cracha_path: string | null;
  data_despachado: string | null; created_at: string;
  envio_tipo: "SUPERVISOR" | "CORREIO" | null; envio_rastreio: string | null;
  // Carimbados pela leitura do QR da etiqueta (sup_retirada_confirmar).
  retirado_em: string | null; retirado_por_nome: string | null;
  sup_pedido_comprovacao: { id: string; status: StatusComprovacao; respondido_em: string | null }[] | { id: string; status: StatusComprovacao; respondido_em: string | null } | null;
  sup_pedido_item: { id: string; item_id: string | null; nome_item: string; tipo_item: string; tamanho: string | null; quantidade: number; litros: string | null; ordem: number }[];
}

interface EventoHistorico {
  id: string; acao: string; status_anterior: string | null; status_novo: string | null;
  observacao: string | null; alterado_por_nome: string | null; data_alteracao: string;
  // Preenchidos pelos triggers de auditoria da edição (20260930000037).
  // Evento antigo (status / comentário de Compras) tem os três nulos.
  campo: string | null; valor_anterior: string | null; valor_novo: string | null;
}

/**
 * Nome de coluna → rótulo que o operador reconhece. O banco guarda o nome
 * cru da coluna, como sup_patrimonio_log já fazia; traduzir aqui evita
 * congelar texto de interface dentro de trigger.
 */
const ROTULO_CAMPO: Record<string, string> = {
  nome_colaborador: "Colaborador",
  matricula_colaborador: "Matrícula",
  tipo_pedido: "Tipo de pedido",
  admissao: "É admissão",
  tipo_admissao: "Tipo de admissão",
  data_admissao: "Data de admissão",
  observacoes_solicitante: "Obs. do solicitante",
  contrato_nome: "Contrato",
  posto_nome: "Posto",
  funcao_nome: "Função",
  imagem_cracha_path: "Foto do crachá",
  item_adicionado: "Item incluído",
  item_alterado: "Item alterado",
  item_removido: "Item removido",
  // Gravados por sup_est_baixar / sup_est_desvincular (20260930000114).
  estoque_designado: "Código(s) designado(s) do estoque",
  estoque_desvinculado: "Código desvinculado — voltou ao estoque",
};

function fmtDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** `true`/`false` e vazio não se leem numa trilha; aqui viram texto. */
function valorLegivel(v: string | null): string {
  if (v === null || v === "") return "—";
  if (v === "true") return "Sim";
  if (v === "false") return "Não";
  return v;
}

type ItemPedido = Pedido["sup_pedido_item"][number];

import { useSituacaoPedidos } from "@/hooks/useSupSeparacao";
import { ModalPrePedido } from "@/components/suprimentos/ModalPrePedido";

/**
 * Situação de cada pedido (quantos itens já saíram), vinda da view
 * sup_pedido_situacao. É o que sustenta o badge "parcialmente despachado" e o
 * KPI de separação sem carregar as etiquetas de todos os pedidos da fila.
 */
type MapaSituacao = Map<string, SituacaoPedido>;

function comprovacaoPedido(pedido: Pedido) {
  const relacao = pedido.sup_pedido_comprovacao;
  return Array.isArray(relacao) ? relacao[0] ?? null : relacao;
}

function statusVisivelPedido(pedido: Pedido, situacao?: SituacaoPedido | null): StatusVisivel {
  const comprovacao = comprovacaoPedido(pedido);
  return apresentarStatusVisivel(pedido.status, comprovacao?.status, situacao).status;
}

function apresentacaoStatusPedido(pedido: Pedido, situacao?: SituacaoPedido | null) {
  return apresentarStatusVisivel(pedido.status, comprovacaoPedido(pedido)?.status, situacao);
}

/**
 * Uma linha do Excel = um item do pedido, com os dados do pedido repetidos.
 *
 * Quando o item tem mais de uma etiqueta (pediu 2 botinas, saíram 2 peças
 * numeradas), os códigos vão concatenados numa célula — o relatório do sistema
 * antigo já chamava essa coluna de "TAGs", no plural.
 *
 * Com etiquetas de valores diferentes na mesma peça (uma nova e uma
 * higienizada, que custou menos), o unitário exportado é o MAIOR. É a regra
 * que o gerente de Suprimentos definiu para não subestimar o valor do estoque.
 */
function linhaExport(p: Pedido, i: ItemPedido | null, tags: TagEmLote[]) {
  const valores = tags.map((t) => Number(t.valor_unitario ?? 0)).filter((v) => v > 0);
  const unitario = valores.length ? Math.max(...valores) : null;
  const total = tags.reduce((s, t) => s + Number(t.valor_unitario ?? 0) * (t.quantidade || 0), 0);

  return {
    Protocolo: p.pedido_id,
    "Tipo pedido": p.tipo_pedido,
    Colaborador: p.nome_colaborador,
    Matrícula: p.matricula_colaborador ?? "",
    Contrato: p.contrato_nome,
    Posto: p.posto_nome,
    Função: p.funcao_nome,
    Solicitante: p.solicitante_nome ?? p.solicitante_login,
    "Data solicitação": fmtDataBR(p.data_solicitacao),
    "Data despacho": fmtDataBR(p.data_despachado),
    "Retirado por": p.retirado_por_nome ?? "",
    "Retirado em": p.retirado_em ? fmtDataHora(p.retirado_em) : "",
    Admissão: p.admissao ? "Sim" : "Não",
    "Tipo admissão": p.tipo_admissao ?? "",
    "Data admissão": p.admissao ? fmtDataBR(p.data_admissao) : "",
    Item: i?.nome_item ?? "",
    Tamanho: i?.tamanho ?? "",
    Litros: i?.litros ?? "",
    Qtd: i?.quantidade ?? "",
    TAGs: tags.map((t) => t.codigo).join(" | "),
    "Valor unitário": unitario ?? "",
    "Valor total": total > 0 ? total : "",
    "Status do item": i ? derivarStatusItem(p.status, { saiu: tags.length > 0 }) : "",
    "Status do pedido": apresentacaoStatusPedido(p).rotulo,
    "Tipo de envio": p.envio_tipo === "SUPERVISOR" ? "Entrega via Supervisor" : p.envio_tipo === "CORREIO" ? "Entrega via Correio" : "",
    "Rastreio Correio": p.envio_rastreio ?? "",
    "Comprovação": comprovacaoPedido(p)?.status === "ENVIADO"
      ? "Recebida"
      : comprovacaoPedido(p)?.status === "PENDENTE" ? "Pendente" : "Não aplicável",
    "Obs. solicitante": p.observacoes_solicitante ?? "",
    "Obs. compras": p.observacao ?? "",
  };
}

const ICONE_STATUS: Record<StatusVisivel, LucideIcon> = {
  "EM PREPARACAO": Boxes,
  "EM SEPARACAO": PackageOpen,
  "AGUARDANDO ENVIO": Clock,
  "AGUARDANDO COMPRA": ShoppingCart,
  "PARCIALMENTE DESPACHADO": PackageSearch,
  "RETIRADO PARA ENTREGA": Car,
  "DESPACHADO_AGUARDANDO": Truck,
  "DESPACHADO_ENTREGUE": Truck,
  "CANCELADO": Inbox,
};

export default function PedidosMateriais() {
  const { data: empresaId } = useEmpresaId();
  const qc = useQueryClient();
  // Semeada por `?busca=`: o histórico de Estoque & Etiquetas linka o protocolo
  // do pedido para cá, e esta tela não tem rota de detalhe — chegar já filtrado
  // é o que evita o usuário ter que copiar o número e procurar na mão.
  const [searchParams, setSearchParams] = useSearchParams();
  const [busca, setBusca] = useState(() => searchParams.get("busca") ?? "");
  // `?fotos=<id do pedido>` é o destino do QR code e da frase clicável do PDF
  // de comprovação de entrega: abre direto o modal com as fotos do formulário.
  const fotosDe = searchParams.get("fotos");
  const fecharFotos = () => {
    const proximos = new URLSearchParams(searchParams);
    proximos.delete("fotos");
    setSearchParams(proximos, { replace: true });
  };
  // 21/09/2026: o campo continua respondendo na hora (é `busca` que o input
  // usa), mas o FILTRO só roda quando a digitação para. Sem isso, cada tecla
  // varria os 2.105 pedidos e a tela engasgava enquanto se digitava.
  const buscaAtrasada = useDebounce(busca, 250);
  const [filtroStatus, setFiltroStatus] = useState("TODOS");
  const [filtroItem, setFiltroItem] = useState("TODOS");
  const [exportando, setExportando] = useState(false);
  const [statusDe, setStatusDe] = useState<Pedido | null>(null);
  const [historicoDe, setHistoricoDe] = useState<Pedido | null>(null);
  const [editandoDe, setEditandoDe] = useState<Pedido | null>(null);
  const [prePedidoDe, setPrePedidoDe] = useState<Pedido | null>(null);
  const [excluindo, setExcluindo] = useState<Pedido | null>(null);
  const [etiquetaDe, setEtiquetaDe] = useState<Pedido | null>(null);
  const [fichaDe, setFichaDe] = useState<Pedido | null>(null);

  const { data: pedidos = [], isLoading, error } = useQuery({
    queryKey: ["sup_pedido", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Pedido[]> => {
      /**
       * Paginado de propósito (SIS-2026-0201). Sem `.range()` o PostgREST
       * devolve no máximo 1000 linhas e não avisa: a fila real tinha 1.448
       * pedidos, o Excel saía com 1.000 e os cards de KPI contavam 1.000.
       * Ninguém percebia, porque nada na tela indica corte.
       *
       * O legado calculava as contagens numa segunda query sem LIMIT
       * justamente para os cards refletirem o banco inteiro
       * (REPLICAR-MODULO-COMPRAS.md §5.3) — trazer tudo aqui devolve esse
       * comportamento com uma consulta só.
       */
      /**
       * 21/09/2026: as páginas eram buscadas EM SEQUÊNCIA, cada uma esperando
       * a anterior. Com 2.105 pedidos isso são 3 idas ao servidor enfileiradas
       * só para montar a lista, e o usuário espera a soma de todas.
       *
       * Agora a primeira página já traz a contagem total (`count: "exact"`), e
       * as demais saem TODAS DE UMA VEZ. O tempo passa a ser o da página mais
       * lenta, não o da soma. Nada muda no resultado: continua trazendo a fila
       * inteira, que é o que os cards de KPI e o Excel precisam.
       */
      const PAGINA = 1000;
      const COLUNAS =
        // item_id vem junto porque a baixa confere se a etiqueta é do material certo.
        "*, sup_pedido_item(id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem), sup_pedido_comprovacao(id, status, respondido_em)";

      const buscarPagina = async (de: number, comContagem = false) => {
        const q = sb
          .from("sup_pedido")
          .select(COLUNAS, comContagem ? { count: "exact" } : undefined)
          .order("created_at", { ascending: false })
          .range(de, de + PAGINA - 1);
        const { data, error, count } = await q;
        if (error) throw error;
        return { lote: (data ?? []) as Pedido[], total: count ?? null };
      };

      const primeira = await buscarPagina(0, true);
      const total = primeira.total ?? primeira.lote.length;
      if (total <= PAGINA) return primeira.lote;

      const restantes = await Promise.all(
        Array.from({ length: Math.ceil(total / PAGINA) - 1 }, (_, i) => buscarPagina((i + 1) * PAGINA)),
      );
      return [...primeira.lote, ...restantes.flatMap((r) => r.lote)];
    },
  });

  /**
   * Quanto de cada pedido já foi atendido. Uma consulta à view
   * sup_pedido_situacao, que faz no banco o que antes exigiria carregar as
   * etiquetas de toda a fila — é o que torna o badge "parcialmente
   * despachado" barato o bastante para ficar sempre ligado.
   */
  const idsDosPedidos = useMemo(() => pedidos.map((p) => p.id), [pedidos]);
  const { data: situacoes } = useSituacaoPedidos(idsDosPedidos);
  const situacaoDe = (p: Pedido) => situacoes?.get(p.id) ?? null;

  // Contagens sobre TUDO que veio, não sobre a página filtrada — os cards
  // precisam refletir a fila inteira.
  const contagens = useMemo(() => {
    const base: Record<string, number> = { TOTAL: pedidos.length };
    for (const s of STATUS_VISIVEL) base[s] = 0;
    for (const p of pedidos) {
      const status = statusVisivelPedido(p, situacoes?.get(p.id) ?? null);
      base[status] = (base[status] ?? 0) + 1;
    }
    return base;
  }, [pedidos, situacoes]);

  /**
   * Texto pesquisável de cada pedido, montado UMA VEZ.
   *
   * 21/09/2026: esta concatenação de ~18 campos (mais o nome e o tamanho de
   * todos os itens do pedido) ficava dentro do filtro, ou seja, era refeita
   * para os 2.105 pedidos A CADA TECLA DIGITADA. Digitar "jaqueta" reconstruía
   * mais de 14 mil strings, sete vezes seguidas, travando o campo de busca.
   *
   * Agora é um índice memorizado que só se refaz quando os pedidos ou as
   * situações mudam. O conteúdo indexado é exatamente o mesmo de antes —
   * "digite qualquer coisa que aparece na tela", incluindo data já formatada
   * em dd/mm/aaaa e nome de material (REPLICAR §5.4).
   */
  const textoBusca = useMemo(() => {
    const indice = new Map<string, string>();
    for (const p of pedidos) {
      indice.set(
        p.id,
        [
          p.pedido_id, apresentacaoStatusPedido(p, situacoes?.get(p.id) ?? null).rotulo,
          p.contrato_nome, p.posto_nome, p.funcao_nome,
          p.solicitante_login, p.solicitante_nome, p.nome_colaborador, p.matricula_colaborador,
          p.tipo_pedido, p.observacoes_solicitante, p.observacao, p.envio_rastreio,
          p.retirado_por_nome,
          fmtDataBR(p.data_solicitacao), fmtDataBR(p.data_despachado),
          p.admissao ? "admissao admissão" : "",
          ...(p.sup_pedido_item ?? []).flatMap((i) => [i.nome_item, i.tamanho ?? ""]),
        ].filter(Boolean).join(" ").toLowerCase(),
      );
    }
    return indice;
  }, [pedidos, situacoes]);

  const porBusca = useMemo(() => {
    const t = buscaAtrasada.trim().toLowerCase();
    return pedidos.filter((p) => {
      const statusVisivel = statusVisivelPedido(p, situacoes?.get(p.id) ?? null);
      if (filtroStatus !== "TODOS" && statusVisivel !== filtroStatus) return false;
      if (!t) return true;
      return (textoBusca.get(p.id) ?? "").includes(t);
    });
  }, [pedidos, buscaAtrasada, filtroStatus, situacoes, textoBusca]);

  /**
   * Filtro por status de ITEM (SIS-2026-0201). Só busca as etiquetas quando o
   * filtro está ligado — na fila inteira isso é uma varredura que a tela não
   * precisa pagar para simplesmente listar pedidos.
   */
  const filtrandoPorItem = filtroItem !== "TODOS";
  const idsParaTags = useMemo(() => porBusca.map((p) => p.id), [porBusca]);
  const { data: tagsFiltro = [], isFetching: buscandoTags } =
    useTagsDePedidos(idsParaTags, filtrandoPorItem);

  const filtrados = useMemo(() => {
    if (!filtrandoPorItem) return porBusca;
    const comTag = new Set(tagsFiltro.map((t) => t.pedido_item_id));
    // Mantém o pedido que tem ao menos UM item no status procurado — é assim
    // que "só o que falta comprar" continua mostrando o pedido inteiro.
    return porBusca.filter((p) =>
      (p.sup_pedido_item ?? []).some(
        (i) => derivarStatusItem(p.status, { saiu: comTag.has(i.id) }) === filtroItem,
      ),
    );
  }, [porBusca, filtrandoPorItem, tagsFiltro, filtroItem]);

  /**
   * Quantos cards são DESENHADOS. 21/09/2026.
   *
   * A tela montava um `CardPedido` para cada pedido filtrado — com a fila
   * atual e o filtro padrão ("TODOS", busca vazia), isso são 2.105 componentes
   * de uma vez, cada um com estado próprio e vários `useMemo`. Era o que
   * travava o navegador ao abrir, mais do que a espera do banco.
   *
   * ATENÇÃO — o que NÃO pode mudar junto: os cards de KPI (`contagens`) somam
   * `pedidos`, e o Excel exporta `filtrados`. Os dois continuam vendo a fila
   * inteira. Limitar aqui é só o que o olho alcança: o usuário vê ~6 cards por
   * vez, não 2.105. Mexer no `contagens` ou no Excel devolveria o bug do
   * SIS-2026-0201, em que os totais mostravam 1.000 de 1.448.
   */
  const PAGINA_CARDS = 24;
  const [cardsVisiveis, setCardsVisiveis] = useState(PAGINA_CARDS);
  // Filtro novo, contagem zerada — senão o usuário filtra e continua vendo a
  // rolagem antiga já expandida.
  useEffect(() => { setCardsVisiveis(PAGINA_CARDS); }, [buscaAtrasada, filtroStatus, filtroItem]);
  const naTela = useMemo(() => filtrados.slice(0, cardsVisiveis), [filtrados, cardsVisiveis]);

  /**
   * Situação dos objetos nos Correios, para os pedidos que estão na tela.
   *
   * Consulta só o que está FILTRADO, não a fila inteira: a API aceita 50
   * códigos por chamada, e a fila tem mais de mil pedidos. Rastrear tudo
   * gastaria dezenas de chamadas para pintar badges que ninguém está vendo.
   *
   * Falha aqui não quebra a tela — o hook não faz retry e os cards
   * simplesmente ficam sem o badge de rastreio.
   */
  // 21/09/2026: era `filtrados`, a fila filtrada inteira. Sem filtro nenhum
  // isso são 2.105 pedidos, e a API dos Correios aceita 50 códigos por
  // chamada — dezenas de chamadas para pintar badge em card que ninguém
  // rolou até ver. Passou a seguir `naTela`, que é exatamente o que o
  // comentário acima sempre quis dizer: só o que está à vista.
  const codigosRastreio = useMemo(
    () => naTela
      .filter((p) => p.envio_tipo === "CORREIO" && p.envio_rastreio)
      .map((p) => p.envio_rastreio!.trim().toUpperCase()),
    [naTela],
  );
  // `situacoesCorreio`, e não `situacoes`: logo acima já existe um `situacoes`
  // que é a situação de ATENDIMENTO do pedido (quanto já foi separado). São
  // dois assuntos diferentes, e o nome curto pertence ao que veio primeiro.
  const { data: situacoesCorreio = {}, isFetching: carregandoRastreio } =
    useRastreioEmLote(codigosRastreio);

  /**
   * Exclusão de pedido. Existe porque no legado era rotina: o encarregado
   * abria a solicitação errada ou incompleta, ligava, e o Supply apagava para
   * ele refazer (REPLICAR §2.2 — lá a confirmação era dupla, e é o que
   * replicamos: um diálogo com o resumo do que some, e a digitação do
   * protocolo para casos já despachados).
   *
   * O ON DELETE CASCADE leva itens e histórico junto. Etiquetas já baixadas
   * NÃO voltam ao estoque sozinhas: sup_estoque_tag.pedido_id é ON DELETE SET
   * NULL, então a peça continua marcada como usada. É proposital — a peça
   * saiu fisicamente. Para devolvê-la, use a tela de Devolução.
   */
  const excluir = useMutation({
    mutationFn: async (pedido: Pedido) => {
      // .select() é obrigatório aqui: um DELETE barrado pela RLS não devolve
      // erro, devolve zero linhas afetadas. Sem conferir, a tela diria
      // "excluído" e o pedido continuaria na fila.
      const { data, error } = await sb.from("sup_pedido").delete().eq("id", pedido.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nada foi excluído — seu perfil não tem a ação 'excluir' em Pedidos de Materiais.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sup_pedido"] });
      qc.invalidateQueries({ queryKey: ["sup_ext_meus_pedidos"] });
      toast.success("Pedido excluído.");
      setExcluindo(null);
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Não foi possível excluir.", {
        description: "Se o erro for de permissão, seu perfil precisa da ação 'excluir' em Pedidos de Materiais.",
      }),
  });

  /**
   * Exportação VERTICAL — uma linha por item (SIS-2026-0201).
   *
   * Antes saía uma linha por pedido, com todos os materiais espremidos numa
   * célula só ("BOTINA (40) x1 | LUVA (M) x2"). O relatório que o Suprimentos
   * usava no sistema antigo era horizontal, com 19 blocos repetidos de
   * "Equipamento N / TAGs N / Valores Unitários N" — 72 colunas, quase todas
   * vazias, e impossível de filtrar.
   *
   * Nos dois formatos dá no mesmo problema: para abrir uma solicitação de
   * compra o gerente precisa só do que ficou pendente, e acabava apagando
   * linha na mão. Uma linha por item, com o status DO ITEM, é o que torna o
   * filtro do Excel utilizável.
   *
   * As etiquetas são buscadas aqui, e não no carregamento da tela, porque só
   * a exportação precisa delas quando o filtro por item está desligado.
   */
  const exportar = async () => {
    setExportando(true);
    try {
      const tags = await buscarTagsDePedidos(filtrados.map((p) => p.id));

      const porItem = new Map<string, TagEmLote[]>();
      for (const t of tags) {
        const lista = porItem.get(t.pedido_item_id);
        if (lista) lista.push(t);
        else porItem.set(t.pedido_item_id, [t]);
      }

      const linhas = filtrados.flatMap((p) => {
        const itens = [...(p.sup_pedido_item ?? [])].sort((a, b) => a.ordem - b.ordem);
        // Pedido sem item ainda assim vira uma linha: sumir com ele do
        // relatório esconderia um pedido que existe na fila.
        if (itens.length === 0) return [linhaExport(p, null, [])];
        return itens.map((i) => linhaExport(p, i, porItem.get(i.id) ?? []));
      });

      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
      XLSX.writeFile(wb, `pedidos-materiais-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível exportar.");
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos de Materiais"
        subtitle="Fila operacional dos pedidos de uniforme, EPI e insumos abertos pelos encarregados."
        module="Suprimentos"
        breadcrumb={["Pedidos de Materiais"]}
        actions={
          <Button variant="outline" onClick={exportar} disabled={filtrados.length === 0 || exportando}>
            <Download className="mr-2 h-4 w-4" />
            {exportando ? "Exportando…" : `Exportar (${filtrados.length})`}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <CardKpi rotulo="Total" valor={contagens.TOTAL} icone={Package} ativo={filtroStatus === "TODOS"} onClick={() => setFiltroStatus("TODOS")} />
        {STATUS_VISIVEL.filter((s) => s !== "CANCELADO").map((s) => (
          <CardKpi
            key={s}
            rotulo={ESTILO_STATUS_VISIVEL[s].rotulo}
            valor={contagens[s] ?? 0}
            icone={ICONE_STATUS[s]}
            ativo={filtroStatus === s}
            onClick={() => setFiltroStatus(filtroStatus === s ? "TODOS" : s)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por protocolo, colaborador, material, posto, data…"
            className="pl-9"
          />
        </div>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos os status</SelectItem>
            {STATUS_VISIVEL.map((s) => (
              <SelectItem key={s} value={s}>{ESTILO_STATUS_VISIVEL[s].rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Filtro por status do ITEM: é o que responde "o que falta comprar?"
            sem depender do status do pedido inteiro. */}
        <Select value={filtroItem} onValueChange={setFiltroItem}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Qualquer item</SelectItem>
            {STATUS_ITEM.map((s) => (
              <SelectItem key={s} value={s}>Item: {ESTILO_STATUS_ITEM[s].rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtrandoPorItem && buscandoTags && (
        <p className="text-xs text-muted-foreground">Conferindo as etiquetas de cada item…</p>
      )}

      {/* Consulta que falha NÃO pode parecer lista vazia — foi exatamente esse
          silêncio que escondeu um cache de sessão antiga durante o teste. */}
      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar os pedidos.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : !empresaId && !isLoading ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-amber-500" />
          <p className="font-medium">Seu usuário não tem empresa definida.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Sem empresa não dá para listar a fila. Ajuste em Administração → Usuários.
          </p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {busca ? `Nenhum resultado para "${busca}"` : "Nenhum pedido nesta fila."}
          </p>
          <p className="text-sm text-muted-foreground">
            {busca ? "Tente outro termo de busca." : "Os pedidos dos encarregados aparecem aqui."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {naTela.map((p) => (
            <CardPedido
              key={p.id}
              pedido={p}
              situacao={situacaoDe(p)}
              onStatus={() => setStatusDe(p)}
              onPrePedido={() => setPrePedidoDe(p)}
              onEditar={() => setEditandoDe(p)}
              onHistorico={() => setHistoricoDe(p)}
              onExcluir={() => setExcluindo(p)}
              onEtiqueta={() => setEtiquetaDe(p)}
              onFichaEpi={() => setFichaDe(p)}
              rastreio={p.envio_rastreio ? situacoesCorreio[p.envio_rastreio.trim().toUpperCase()] : undefined}
              rastreioCarregando={carregandoRastreio}
            />
          ))}
        </div>
      )}

      {/* Rolagem por demanda (21/09/2026). Os números do rodapé falam da fila
          FILTRADA inteira, não do que está desenhado — quem exporta o Excel
          leva tudo, não só estes cards. */}
      {filtrados.length > naTela.length && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-sm text-muted-foreground">
            Mostrando <strong>{naTela.length}</strong> de <strong>{filtrados.length}</strong> pedidos
          </p>
          <Button
            variant="outline"
            onClick={() => setCardsVisiveis((n) => n + PAGINA_CARDS)}
          >
            Carregar mais {Math.min(PAGINA_CARDS, filtrados.length - naTela.length)}
          </Button>
        </div>
      )}

      {/* Conferência do estoque e criação do pré-pedido (a tela da supervisora). */}
      <ModalPrePedido
        pedidoId={prePedidoDe?.id ?? null}
        protocolo={prePedidoDe?.pedido_id ?? null}
        aberto={!!prePedidoDe}
        onFechar={() => setPrePedidoDe(null)}
      />

      {/* Status + baixa de estoque numa transação só (ver ModalBaixaPedido). */}
      <ModalBaixaPedido pedido={statusDe} onFechar={() => setStatusDe(null)} />

      {/* Edição do pedido em si — cabeçalho e itens, com trilha no histórico. */}
      <ModalEditarPedido pedido={editandoDe} onFechar={() => setEditandoDe(null)} />

      <ModalHistorico pedido={historicoDe} onFechar={() => setHistoricoDe(null)} />

      <ModalFotosComprovacao pedidoId={fotosDe} onFechar={fecharFotos} />

      <ModalEtiquetaTermica pedido={etiquetaDe} onFechar={() => setEtiquetaDe(null)} />

      {/* Ficha de EPI com a empresa do contrato no cabeçalho (ver fichaEpi.ts). */}
      <ModalFichaEpi pedido={fichaDe} onFechar={() => setFichaDe(null)} />

      <ModalExcluir
        pedido={excluindo}
        onFechar={() => setExcluindo(null)}
        onConfirmar={() => excluindo && excluir.mutate(excluindo)}
        excluindo={excluir.isPending}
      />
    </div>
  );
}

function CardKpi({
  rotulo, valor, icone: Icone, ativo, onClick,
}: { rotulo: string; valor: number; icone: LucideIcon; ativo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        ativo ? "border-primary/50 bg-primary/5" : "hover:bg-muted/60",
      )}
    >
      <Icone className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{valor}</p>
        <p className="truncate text-xs text-muted-foreground">{rotulo}</p>
      </div>
    </button>
  );
}

function CardPedido({
  pedido: p, situacao, onStatus, onPrePedido, onEditar, onHistorico, onExcluir, onEtiqueta, onFichaEpi,
  rastreio, rastreioCarregando,
}: {
  pedido: Pedido;
  situacao: SituacaoPedido | null;
  onStatus: () => void; onPrePedido: () => void; onEditar: () => void;
  onHistorico: () => void; onExcluir: () => void; onEtiqueta: () => void; onFichaEpi: () => void;
  rastreio: SituacaoObjeto | undefined;
  rastreioCarregando: boolean;
}) {
  const apresentacaoStatus = apresentacaoStatusPedido(p, situacao);
  const statusVisivel = apresentacaoStatus.status;
  const situacaoCorreio = resumirSituacao(rastreio);

  // Em AGUARDANDO COMPRA o card esconde o que já tem etiqueta, virando uma
  // lista viva do que ainda falta comprar. É a melhor ideia de UX do legado
  // (REPLICAR §5.5) — só busca as etiquetas nesse status, para não pesar.
  const aguardandoCompra = p.status === "AGUARDANDO COMPRA";

  // "Enviados" / "Pendentes envio": com despacho parcial, o Supply precisa ver
  // no card o que já saiu e o que falta, sem abrir o pedido. Clicar de novo no
  // botão ativo volta para a lista do que foi pedido. As etiquetas só são
  // buscadas quando um dos dois é ligado — são vinte cards na tela, e a
  // maioria nunca vai ser consultada.
  const [visaoItens, setVisaoItens] = useState<"TODOS" | "ENVIADOS" | "PENDENTES">("TODOS");
  const precisaTags = aguardandoCompra || visaoItens !== "TODOS";
  const { data: tagsDoPedido = [], isLoading: carregandoTags } = useTagsDoPedido(precisaTags ? p.id : null);
  const itensComTag = useMemo(
    () => new Set(tagsDoPedido.map((t) => t.pedido_item_id)),
    [tagsDoPedido],
  );

  const itens = useMemo(() => {
    const todos = [...(p.sup_pedido_item ?? [])].sort((a, b) => a.ordem - b.ordem);
    return aguardandoCompra ? todos.filter((i) => !itensComTag.has(i.id)) : todos;
  }, [p.sup_pedido_item, aguardandoCompra, itensComTag]);

  const envio = useMemo(
    () => calcularEnvioItens(p.sup_pedido_item ?? [], tagsDoPedido),
    [p.sup_pedido_item, tagsDoPedido],
  );
  const enviados = envio.filter((l) => l.enviada > 0);
  const pendentes = envio.filter((l) => l.pendente > 0);

  const ocultos = (p.sup_pedido_item ?? []).length - itens.length;

  const tituloItens = aguardandoCompra && visaoItens === "TODOS" ? "Falta comprar"
    : p.tipo_pedido === "uniforme" ? "Uniformes"
    : p.tipo_pedido === "insumos" ? "EPIs e Insumos"
    : "Materiais";

  const alternarVisao = (v: "ENVIADOS" | "PENDENTES") =>
    setVisaoItens((atual) => (atual === v ? "TODOS" : v));

  const detalheItem = (i: { tamanho: string | null; litros: string | null }, qtd: string) =>
    [i.tamanho && `Tam. ${i.tamanho}`, `Qtd. ${qtd}`, i.litros && `${i.litros} L`].filter(Boolean).join(" · ");

  return (
    <Card className={cn(
      "flex flex-col",
      statusVisivel === "DESPACHADO_ENTREGUE" && "bg-emerald-50/60 border-emerald-300/60 dark:bg-emerald-950/20",
    )}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <span className="font-mono text-sm font-semibold">{p.pedido_id}</span>
        <Badge
          variant="outline"
          className={cn("shrink-0", apresentacaoStatus.classe)}
          title={apresentacaoStatus.titulo}
        >
          {apresentacaoStatus.rotulo}
        </Badge>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 text-sm">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
          {p.nome_colaborador && (
            <>
              <dt className="text-muted-foreground">Colaborador</dt>
              <dd className="truncate">
                {p.nome_colaborador}
                {/* Nome digitado à mão só acontece em admissão, quando a pessoa
                    ainda não está na folha — e é justamente o que o Supply
                    precisa conferir com o RH antes de entregar. */}
                {p.colaborador_digitado && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    digitado
                  </span>
                )}
              </dd>
            </>
          )}
          {p.matricula_colaborador
            ? (<><dt className="text-muted-foreground">Matrícula</dt><dd>{p.matricula_colaborador}</dd></>)
            : p.admissao
              ? (<><dt className="text-muted-foreground">Matrícula</dt><dd className="text-muted-foreground">ainda não tem</dd></>)
              : null}
          <dt className="text-muted-foreground">Solicitante</dt><dd className="truncate">{p.solicitante_nome ?? p.solicitante_login}</dd>
          <dt className="text-muted-foreground">Contrato</dt><dd className="truncate">{p.contrato_nome}</dd>
          <dt className="text-muted-foreground">Posto</dt><dd className="truncate">{p.posto_nome}</dd>
          <dt className="text-muted-foreground">Função</dt><dd className="truncate">{p.funcao_nome}</dd>
          {p.admissao && (
            <>
              <dt className="text-muted-foreground">Admissão</dt>
              <dd>{fmtDataBR(p.data_admissao)} ({p.tipo_admissao})</dd>
              <dt className="text-muted-foreground">Foto crachá</dt>
              <dd><FotoCracha caminho={p.imagem_cracha_path} protocolo={p.pedido_id} /></dd>
            </>
          )}
          <dt className="text-muted-foreground">Solicitado</dt><dd>{fmtDataBR(p.data_solicitacao)}</dd>
          {/* Só enquanto a retirada ainda descreve o pedido: se o Compras
              devolveu para "Aguardando envio", as colunas guardam uma retirada
              que foi desfeita — a trilha completa fica no Histórico. */}
          {p.retirado_em && (p.status === "RETIRADO PARA ENTREGA" || p.status === "DESPACHADO") && (
            <>
              <dt className="text-muted-foreground">Retirado</dt>
              <dd className="truncate">{p.retirado_por_nome ?? "—"} · {fmtDataHora(p.retirado_em)}</dd>
            </>
          )}
          {p.data_despachado && (<><dt className="text-muted-foreground">Despachado</dt><dd>{fmtDataBR(p.data_despachado)}</dd></>)}
          {p.envio_tipo && (
            <>
              <dt className="text-muted-foreground">Envio</dt>
              <dd className="truncate">
                {p.envio_tipo === "SUPERVISOR" ? "Via supervisor" : "Via Correios"}
                {p.envio_rastreio && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">{p.envio_rastreio}</span>
                )}
              </dd>
            </>
          )}
        </dl>

        {/* Situação nos Correios: some para envio por supervisor e para pedido
            sem código. Enquanto carrega não mostra esqueleto — o dado é
            acessório, e um placeholder pulsando em vinte cards de uma vez
            chama mais atenção do que a informação em si. */}
        {p.envio_tipo === "CORREIO" && p.envio_rastreio && (
          situacaoCorreio ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={cn("shrink-0", situacaoCorreio.classe)}>
                {situacaoCorreio.texto}
              </Badge>
              {rastreio?.data && (
                <span className="text-muted-foreground">
                  {new Date(rastreio.data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  {rastreio.local ? ` · ${rastreio.local}` : ""}
                </span>
              )}
            </div>
          ) : rastreioCarregando ? (
            <p className="text-xs text-muted-foreground">Consultando os Correios…</p>
          ) : null
        )}

        <div className="rounded-md border bg-muted/40 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tituloItens}
              {visaoItens === "TODOS" && ocultos > 0 && (
                <span className="font-normal normal-case text-emerald-600">
                  · {ocultos} já separado(s)
                </span>
              )}
            </p>
            <div className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                aria-pressed={visaoItens === "ENVIADOS"}
                onClick={() => alternarVisao("ENVIADOS")}
                title="Mostrar só o que já saiu do estoque para este pedido"
                className={cn(
                  "rounded border px-1.5 py-0.5 transition-colors",
                  visaoItens === "ENVIADOS"
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Enviados
              </button>
              <span className="text-muted-foreground/60">|</span>
              <button
                type="button"
                aria-pressed={visaoItens === "PENDENTES"}
                onClick={() => alternarVisao("PENDENTES")}
                title="Mostrar só o que ainda falta enviar para este pedido"
                className={cn(
                  "rounded border px-1.5 py-0.5 transition-colors",
                  visaoItens === "PENDENTES"
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                Pendentes envio
              </button>
            </div>
          </div>

          {visaoItens === "TODOS" ? (
            <>
              {itens.length === 0 && (
                <p className="py-1 text-xs text-emerald-600">Tudo separado — nada a comprar.</p>
              )}
              <ul className="space-y-0.5">
                {itens.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2 text-xs">
                    <span className="truncate">{i.nome_item}</span>
                    <span className="shrink-0 text-muted-foreground">{detalheItem(i, String(i.quantidade))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : carregandoTags ? (
            <p className="py-1 text-xs text-muted-foreground">Conferindo o que já saiu…</p>
          ) : (
            (() => {
              const enviando = visaoItens === "ENVIADOS";
              const linhas = enviando ? enviados : pendentes;
              if (linhas.length === 0) {
                return (
                  <p className={cn("py-1 text-xs", enviando ? "text-muted-foreground" : "text-emerald-600")}>
                    {enviando ? "Nada enviado ainda para este pedido." : "Nada pendente — tudo já foi enviado."}
                  </p>
                );
              }
              return (
                <ul className="space-y-0.5">
                  {linhas.map((l) => {
                    const qtd = enviando ? l.enviada : l.pendente;
                    // "1 de 2" só quando é parcial — item inteiro fica igual à lista normal.
                    const texto = qtd === l.quantidade ? String(qtd) : `${qtd} de ${l.quantidade}`;
                    return (
                      <li key={l.id} className="flex justify-between gap-2 text-xs">
                        <span className="truncate">{l.nome_item}</span>
                        <span className={cn("shrink-0", enviando ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                          {detalheItem(l, texto)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          )}
        </div>

        {p.observacoes_solicitante && (
          <p className="text-xs text-muted-foreground">
            <strong>Obs. do solicitante:</strong> {p.observacoes_solicitante}
          </p>
        )}
        {p.observacao && (
          <p className="text-xs text-muted-foreground">
            <strong>Obs. de Compras:</strong> {p.observacao}
          </p>
        )}
      </CardContent>

      {/* As ações não cabem numa linha só num card de duas/três colunas:
          Status e Editar (o que se faz o tempo todo) ficam em cima; consulta,
          ficha de EPI, etiqueta e exclusão embaixo. Grade de 6 para a linha
          de baixo caber 2 botões com texto + 2 só com ícone. */}
      <div className="grid grid-cols-6 gap-2 border-t p-3">
        {/*
          Em EM PREPARACAO a ação principal deixa de ser "mudar status na mão"
          e passa a ser conferir o estoque e montar o pré-pedido — é o passo
          que faz a mercadoria sair do disponível sem sair da prateleira.
        */}
        {p.status === "EM PREPARACAO" ? (
          <AcessoGate
            menu="sup_pedidos_materiais"
            acao="alterar"
            fallback={
              <Button size="sm" className="col-span-3" onClick={onStatus}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Status
              </Button>
            }
          >
            <Button size="sm" className="col-span-3" onClick={onPrePedido}>
              <PackageSearch className="mr-1.5 h-3.5 w-3.5" /> Conferir e reservar
            </Button>
          </AcessoGate>
        ) : (
          <Button
            size="sm"
            className="col-span-3"
            onClick={onStatus}
            disabled={p.status === "EM SEPARACAO"}
            title={p.status === "EM SEPARACAO"
              ? "Pedido em separação: confirme ou libere pela tela de Separação de Pedidos."
              : undefined}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Status
          </Button>
        )}
        <AcessoGate menu="sup_pedidos_materiais" acao="alterar">
          <Button size="sm" variant="secondary" className="col-span-3" onClick={onEditar}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
          </Button>
        </AcessoGate>
        <Button size="sm" variant="outline" className="col-span-2 px-2" onClick={onHistorico}>
          <HistoryIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" /> Histórico
        </Button>
        <Button size="sm" variant="outline" className="col-span-2 px-2" onClick={onFichaEpi} title="Ficha de controle e entrega de EPI">
          <HardHat className="mr-1.5 h-3.5 w-3.5 shrink-0" /> Ficha EPI
        </Button>
        <Button size="sm" variant="outline" className="px-0" onClick={onEtiqueta} title="Emitir etiqueta térmica">
          <Printer className="h-3.5 w-3.5" /><span className="sr-only">Etiqueta térmica</span>
        </Button>
        <Button
          size="sm" variant="outline"
          className="border-destructive/40 px-0 text-destructive hover:bg-destructive/10"
          onClick={onExcluir}
          aria-label={`Excluir ${p.pedido_id}`}
          title="Excluir pedido"
        >
          <Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Excluir</span>
        </Button>
      </div>
    </Card>
  );
}

/**
 * Exclusão com confirmação proporcional ao risco.
 *
 * Pedido ainda em preparação some com um clique de confirmação — é o caso
 * corriqueiro, o encarregado pediu errado e vai refazer. Já um pedido que
 * saiu do estoque ou foi despachado exige digitar o protocolo: aí existe
 * peça física envolvida e a exclusão apaga a trilha dela.
 */
function ModalExcluir({
  pedido, onFechar, onConfirmar, excluindo,
}: {
  pedido: Pedido | null;
  onFechar: () => void;
  onConfirmar: () => void;
  excluindo: boolean;
}) {
  const [digitado, setDigitado] = useState("");
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const { data: tags = [] } = useTagsDoPedido(pedido?.id ?? null);

  if (pedido && pedido.id !== idAtual) { setIdAtual(pedido.id); setDigitado(""); }

  const delicado = !!pedido && (pedido.status === "DESPACHADO" || tags.length > 0);
  const liberado = !delicado || digitado.trim().toUpperCase() === pedido?.pedido_id;

  return (
    <Dialog open={!!pedido} onOpenChange={(o) => { if (!o) { setIdAtual(null); onFechar(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Excluir {pedido?.pedido_id}?</DialogTitle></DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="rounded-md border p-3">
            <p><span className="text-muted-foreground">Colaborador: </span>{pedido?.nome_colaborador || "—"}</p>
            <p><span className="text-muted-foreground">Solicitante: </span>{pedido?.solicitante_nome ?? pedido?.solicitante_login}</p>
            <p><span className="text-muted-foreground">Itens: </span>{pedido?.sup_pedido_item?.length ?? 0}</p>
          </div>

          <p className="text-muted-foreground">
            O pedido, seus itens e todo o histórico são apagados. Não há como desfazer.
          </p>

          {delicado && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {tags.length > 0
                    ? `Este pedido já consumiu ${tags.length} etiqueta(s) do estoque.`
                    : "Este pedido já foi despachado."}
                </p>
                <p className="text-amber-800/80 dark:text-amber-200/70">
                  As peças NÃO voltam ao estoque ao excluir — elas saíram de verdade. Se
                  precisar devolvê-las, use Estoque &amp; Etiquetas → Devolução antes.
                </p>
              </div>
            </div>
          )}

          {delicado && (
            <div>
              <Label>Digite <code className="font-mono">{pedido?.pedido_id}</code> para confirmar</Label>
              <Input
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                placeholder={pedido?.pedido_id}
                className="font-mono"
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setIdAtual(null); onFechar(); }}>Cancelar</Button>
          <Button variant="destructive" disabled={!liberado || excluindo} onClick={onConfirmar}>
            {excluindo ? "Excluindo…" : "Excluir pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Trilha real de mudanças — uma linha por evento, com autor e data. */
function ModalHistorico({ pedido, onFechar }: { pedido: Pedido | null; onFechar: () => void }) {
  const [abrindoEvento, setAbrindoEvento] = useState<string | null>(null);
  const comprovacaoAtual = pedido ? comprovacaoPedido(pedido) : null;
  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["sup_pedido_historico", pedido?.id],
    enabled: !!pedido,
    queryFn: async (): Promise<EventoHistorico[]> => {
      const { data, error } = await sb
        .from("sup_pedido_historico")
        .select("*")
        .eq("pedido_id", pedido!.id)
        // Uma edição grava várias linhas com o MESMO data_alteracao (é o
        // now() da transação). O desempate por id não significa nada, mas
        // impede a lista de trocar de ordem a cada refetch.
        .order("data_alteracao", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const abrirDeclaracao = async (evento: EventoHistorico) => {
    if (!evento.observacao) return;
    setAbrindoEvento(evento.id);
    try {
      imprimirDeclaracao(await buscarDeclaracaoCompleta(evento.observacao));
    } catch (erro: unknown) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível abrir a declaração.");
    } finally {
      setAbrindoEvento(null);
    }
  };

  const abrirComprovacao = async (evento: EventoHistorico) => {
    if (!pedido) return;
    setAbrindoEvento(evento.id);
    try {
      await abrirComprovacaoPdf(pedido.id);
    } catch (erro: unknown) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível abrir a comprovação.");
    } finally {
      setAbrindoEvento(null);
    }
  };

  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Histórico de {pedido?.pedido_id}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-0 overflow-y-auto py-2">
          {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
          {eventos.map((e, i) => (
            <div key={e.id} className="relative flex gap-3 pb-5 pl-1">
              {i < eventos.length - 1 && <div className="absolute left-[9px] top-5 h-full w-px bg-border" />}
              <div className="mt-1 h-[10px] w-[10px] shrink-0 rounded-full bg-primary ring-4 ring-background" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {e.acao === "CRIADO" ? "Pedido criado"
                    : e.acao === "DECLARACAO" ? `Declaração ${e.observacao ?? ""} gerada`
                    : e.acao === "COMPROVACAO" ? "Comprovação de entrega recebida"
                    : e.acao === "RETIRADA" ? "Retirado para entrega (QR code)"
                    : e.campo
                      ? (ROTULO_CAMPO[e.campo] ?? e.campo)
                      : e.status_anterior
                        ? <>{ESTILO_STATUS[e.status_anterior]?.rotulo ?? e.status_anterior} → {ESTILO_STATUS[e.status_novo ?? ""]?.rotulo ?? e.status_novo}</>
                        : "Obs. de Compras atualizada"}
                </p>

                {/* Antes → depois. Item incluído não tem "antes" e item
                    removido não tem "depois": mostrar uma seta com um lado
                    vazio confundiria mais do que ajudaria. */}
                {e.campo && (
                  <p className="break-words text-muted-foreground">
                    {e.valor_anterior !== null && e.valor_novo !== null
                      ? <>{valorLegivel(e.valor_anterior)} → <strong className="font-medium text-foreground">{valorLegivel(e.valor_novo)}</strong></>
                      : valorLegivel(e.valor_novo ?? e.valor_anterior)}
                  </p>
                )}

                {e.observacao && e.acao !== "DECLARACAO" && e.acao !== "COMPROVACAO" && <p className="break-words text-muted-foreground">{e.observacao}</p>}
                {e.acao === "DECLARACAO" && (
                  <AcessoGate menu="sup_correio_declaracao" acao="visualizar">
                    <Button size="sm" variant="outline" className="mt-2" disabled={abrindoEvento === e.id} onClick={() => void abrirDeclaracao(e)}>
                      <FileText className="mr-2 h-3.5 w-3.5" /> Abrir / imprimir declaração
                    </Button>
                  </AcessoGate>
                )}
                {e.acao === "COMPROVACAO" && comprovacaoAtual?.status === "ENVIADO" && (
                  <Button size="sm" variant="outline" className="mt-2" disabled={abrindoEvento === e.id} onClick={() => void abrirComprovacao(e)}>
                    <FileText className="mr-2 h-3.5 w-3.5" /> Abrir formulário
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {e.alterado_por_nome ?? "—"} · {new Date(e.data_alteracao).toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          ))}
          {!isLoading && eventos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Sem eventos registrados.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
