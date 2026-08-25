import { useMemo, useState } from "react";
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
import {
  ESTILO_STATUS, STATUS_PEDIDO, fmtDataBR,
  ESTILO_STATUS_ITEM, STATUS_ITEM, derivarStatusItem,
} from "@/hooks/useSupPedidos";
import { ModalBaixaPedido } from "@/components/suprimentos/ModalBaixaPedido";
import { useTagsDoPedido, useTagsDePedidos, buscarTagsDePedidos, type TagEmLote } from "@/hooks/useSupEstoque";
import {
  Search, Package, Boxes, Clock, ShoppingCart, Truck, History as HistoryIcon,
  RefreshCw, Inbox, Download, ShieldAlert, Trash2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

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
  solicitante_login: string; solicitante_nome: string | null;
  nome_colaborador: string; matricula_colaborador: string | null;
  colaborador_empregado_id: number | null; colaborador_digitado: boolean;
  admissao: boolean; tipo_admissao: string | null; data_admissao: string | null;
  tipo_pedido: string; observacoes_solicitante: string | null; observacao: string | null;
  imagem_cracha_path: string | null;
  data_despachado: string | null; created_at: string;
  sup_pedido_item: { id: string; item_id: string | null; nome_item: string; tipo_item: string; tamanho: string | null; quantidade: number; litros: string | null; ordem: number }[];
}

interface EventoHistorico {
  id: string; acao: string; status_anterior: string | null; status_novo: string | null;
  observacao: string | null; alterado_por_nome: string | null; data_alteracao: string;
}

type ItemPedido = Pedido["sup_pedido_item"][number];

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
    "Status do item": i ? derivarStatusItem(p.status, tags.length > 0) : "",
    "Status do pedido": p.status,
    "Obs. solicitante": p.observacoes_solicitante ?? "",
    "Obs. compras": p.observacao ?? "",
  };
}

const ICONE_STATUS: Record<string, any> = {
  "EM PREPARACAO": Boxes,
  "AGUARDANDO ENVIO": Clock,
  "AGUARDANDO COMPRA": ShoppingCart,
  "DESPACHADO": Truck,
  "CANCELADO": Inbox,
};

export default function PedidosMateriais() {
  const { data: empresaId } = useEmpresaId();
  const qc = useQueryClient();
  // Semeada por `?busca=`: o histórico de Estoque & Etiquetas linka o protocolo
  // do pedido para cá, e esta tela não tem rota de detalhe — chegar já filtrado
  // é o que evita o usuário ter que copiar o número e procurar na mão.
  const [searchParams] = useSearchParams();
  const [busca, setBusca] = useState(() => searchParams.get("busca") ?? "");
  const [filtroStatus, setFiltroStatus] = useState("TODOS");
  const [filtroItem, setFiltroItem] = useState("TODOS");
  const [exportando, setExportando] = useState(false);
  const [statusDe, setStatusDe] = useState<Pedido | null>(null);
  const [historicoDe, setHistoricoDe] = useState<Pedido | null>(null);
  const [excluindo, setExcluindo] = useState<Pedido | null>(null);

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
      const PAGINA = 1000;
      const todos: Pedido[] = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await sb
          .from("sup_pedido")
          // item_id vem junto porque a baixa confere se a etiqueta é do material certo.
          .select("*, sup_pedido_item(id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)")
          .order("created_at", { ascending: false })
          .range(de, de + PAGINA - 1);
        if (error) throw error;
        const lote = data ?? [];
        todos.push(...lote);
        if (lote.length < PAGINA) break;
      }
      return todos;
    },
  });

  // Contagens sobre TUDO que veio, não sobre a página filtrada — os cards
  // precisam refletir a fila inteira.
  const contagens = useMemo(() => {
    const base: Record<string, number> = { TOTAL: pedidos.length };
    for (const s of STATUS_PEDIDO) base[s] = 0;
    for (const p of pedidos) base[p.status] = (base[p.status] ?? 0) + 1;
    return base;
  }, [pedidos]);

  const porBusca = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filtroStatus !== "TODOS" && p.status !== filtroStatus) return false;
      if (!t) return true;
      // "Digite qualquer coisa que aparece na tela" — inclui data já
      // formatada em dd/mm/aaaa e nome de material (REPLICAR §5.4).
      const alvo = [
        p.pedido_id, p.status, p.contrato_nome, p.posto_nome, p.funcao_nome,
        p.solicitante_login, p.solicitante_nome, p.nome_colaborador, p.matricula_colaborador,
        p.tipo_pedido, p.observacoes_solicitante, p.observacao,
        fmtDataBR(p.data_solicitacao), fmtDataBR(p.data_despachado),
        p.admissao ? "admissao admissão" : "",
        ...(p.sup_pedido_item ?? []).flatMap((i) => [i.nome_item, i.tamanho ?? ""]),
      ].filter(Boolean).join(" ").toLowerCase();
      return alvo.includes(t);
    });
  }, [pedidos, busca, filtroStatus]);

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
        (i) => derivarStatusItem(p.status, comTag.has(i.id)) === filtroItem,
      ),
    );
  }, [porBusca, filtrandoPorItem, tagsFiltro, filtroItem]);

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

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CardKpi rotulo="Total" valor={contagens.TOTAL} icone={Package} ativo={filtroStatus === "TODOS"} onClick={() => setFiltroStatus("TODOS")} />
        {STATUS_PEDIDO.filter((s) => s !== "CANCELADO").map((s) => (
          <CardKpi
            key={s}
            rotulo={ESTILO_STATUS[s].rotulo}
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
            {STATUS_PEDIDO.map((s) => (
              <SelectItem key={s} value={s}>{ESTILO_STATUS[s].rotulo}</SelectItem>
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
          {filtrados.map((p) => (
            <CardPedido
              key={p.id}
              pedido={p}
              onStatus={() => setStatusDe(p)}
              onHistorico={() => setHistoricoDe(p)}
              onExcluir={() => setExcluindo(p)}
            />
          ))}
        </div>
      )}

      {/* Status + baixa de estoque numa transação só (ver ModalBaixaPedido). */}
      <ModalBaixaPedido pedido={statusDe} onFechar={() => setStatusDe(null)} />

      <ModalHistorico pedido={historicoDe} onFechar={() => setHistoricoDe(null)} />

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
}: { rotulo: string; valor: number; icone: any; ativo: boolean; onClick: () => void }) {
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
  pedido: p, onStatus, onHistorico, onExcluir,
}: { pedido: Pedido; onStatus: () => void; onHistorico: () => void; onExcluir: () => void }) {
  const estilo = ESTILO_STATUS[p.status] ?? ESTILO_STATUS["EM PREPARACAO"];

  // Em AGUARDANDO COMPRA o card esconde o que já tem etiqueta, virando uma
  // lista viva do que ainda falta comprar. É a melhor ideia de UX do legado
  // (REPLICAR §5.5) — só busca as etiquetas nesse status, para não pesar.
  const aguardandoCompra = p.status === "AGUARDANDO COMPRA";
  const { data: tagsDoPedido = [] } = useTagsDoPedido(aguardandoCompra ? p.id : null);
  const itensComTag = useMemo(
    () => new Set(tagsDoPedido.map((t) => t.pedido_item_id)),
    [tagsDoPedido],
  );

  const itens = useMemo(() => {
    const todos = [...(p.sup_pedido_item ?? [])].sort((a, b) => a.ordem - b.ordem);
    return aguardandoCompra ? todos.filter((i) => !itensComTag.has(i.id)) : todos;
  }, [p.sup_pedido_item, aguardandoCompra, itensComTag]);

  const ocultos = (p.sup_pedido_item ?? []).length - itens.length;

  const tituloItens = aguardandoCompra ? "Falta comprar"
    : p.tipo_pedido === "uniforme" ? "Uniformes"
    : p.tipo_pedido === "insumos" ? "EPIs e Insumos"
    : "Materiais";

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <span className="font-mono text-sm font-semibold">{p.pedido_id}</span>
        <Badge variant="outline" className={cn("shrink-0", estilo.classe)}>{estilo.rotulo}</Badge>
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
            </>
          )}
          <dt className="text-muted-foreground">Solicitado</dt><dd>{fmtDataBR(p.data_solicitacao)}</dd>
          {p.data_despachado && (<><dt className="text-muted-foreground">Despachado</dt><dd>{fmtDataBR(p.data_despachado)}</dd></>)}
        </dl>

        <div className="rounded-md border bg-muted/40 p-2">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tituloItens}
            {ocultos > 0 && (
              <span className="font-normal normal-case text-emerald-600">
                · {ocultos} já separado(s)
              </span>
            )}
          </p>
          {itens.length === 0 && (
            <p className="py-1 text-xs text-emerald-600">Tudo separado — nada a comprar.</p>
          )}
          <ul className="space-y-0.5">
            {itens.map((i) => (
              <li key={i.id} className="flex justify-between gap-2 text-xs">
                <span className="truncate">{i.nome_item}</span>
                <span className="shrink-0 text-muted-foreground">
                  {[i.tamanho && `Tam. ${i.tamanho}`, `Qtd. ${i.quantidade}`, i.litros && `${i.litros} L`]
                    .filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
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

      <div className="flex gap-2 border-t p-3">
        <Button size="sm" className="flex-1" onClick={onStatus}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Status
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onHistorico}>
          <HistoryIcon className="mr-1.5 h-3.5 w-3.5" /> Histórico
        </Button>
        <Button
          size="sm" variant="outline"
          className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onExcluir}
          aria-label={`Excluir ${p.pedido_id}`}
          title="Excluir pedido"
        >
          <Trash2 className="h-3.5 w-3.5" />
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
  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["sup_pedido_historico", pedido?.id],
    enabled: !!pedido,
    queryFn: async (): Promise<EventoHistorico[]> => {
      const { data, error } = await sb
        .from("sup_pedido_historico")
        .select("*")
        .eq("pedido_id", pedido!.id)
        .order("data_alteracao", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

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
                    : e.status_anterior
                      ? <>{ESTILO_STATUS[e.status_anterior]?.rotulo ?? e.status_anterior} → {ESTILO_STATUS[e.status_novo ?? ""]?.rotulo ?? e.status_novo}</>
                      : "Comentário atualizado"}
                </p>
                {e.observacao && <p className="text-muted-foreground">{e.observacao}</p>}
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
