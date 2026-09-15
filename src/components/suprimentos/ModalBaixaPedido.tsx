import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { separarCodigos } from "@/components/suprimentos/CampoBipagem";
import { STATUS_PEDIDO, ESTILO_STATUS } from "@/hooks/useSupPedidos";
import {
  useTagsDoPedido, useTagsDisponiveis, useSaldoMaterial, useValidarTags, useBaixarPedido,
  useDesvincularCodigo, useCaDosCodigos, useResolucaoDaLinha,
  conferirLinhas, codigosDasLinhas, montarBaixasDasLinhas, expandirCodigosDeProduto,
  resolverCodigos, chaveResolucao, normalizarCodigo,
  type Baixa, type LinhaCodigo, type ItemComLinhas, type TiposDosCodigos, type ResolucaoCodigo,
} from "@/hooks/useSupEstoque";
import { ModalTrajetoCorreio } from "@/components/suprimentos/ModalTrajetoCorreio";
import {
  Lock, List, AlertTriangle, Loader2, Tag as TagIcon, MessageSquare, Map as MapIcon, Car,
  Plus, X, ScanLine, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Atualizar status + baixar o estoque do pedido.
 *
 * Espelha o modal do sistema legado (REPLICAR-MODULO-COMPRAS.md §5.6), que é
 * a peça mais complexa daquela tela, com três diferenças deliberadas:
 *
 *   • uma chamada só (sup_est_baixar) grava status e consumo na MESMA
 *     transação. No legado eram duas requisições e, se a segunda falhasse, as
 *     peças já tinham saído do estoque (§12.6);
 *   • o saldo disponível daquele material aparece ao lado de cada item, e o
 *     código de material errado é recusado — o legado não conferia nada disso;
 *   • os códigos são bipados com pistola (Enter confirma), com a lista de
 *     disponíveis a um clique para quem estiver sem o leitor.
 *
 * CÓDIGO + QUANTIDADE (15/09/2026). O seletor "única / em massa" saiu: depois
 * do ajuste 7 esses dois tipos não existem mais para quem está no balcão.
 * Cada item tem linhas de código + quantidade, e o "+" abre outra linha para
 * quando as unidades saem de códigos diferentes (duas jaquetas, dois lotes).
 * O campo aceita o código do LOTE ou o do PRODUTO (os 7 dígitos). Com o do
 * produto, o banco escolhe os lotes — CA vencendo primeiro, pulando CA
 * bloqueado — e o CA de cada lote aparece na linha, sem ninguém digitar.
 * Quem descobre se o código é lote ou etiqueta antiga de peça única é a
 * validação no banco, não o operador — ver montarBaixasDasLinhas.
 *
 * Código já gravado aparece TRAVADO: impede trocar por baixo o código de uma
 * peça que já saiu do estoque. A saída oficial é "Desvincular", que devolve a
 * quantidade ao estoque na hora e deixa a troca no histórico do pedido
 * (sup_est_desvincular, migration 20260930000114).
 */

interface ItemPedido {
  id: string; item_id: string | null; nome_item: string;
  tamanho: string | null; quantidade: number; ordem: number;
}
export interface PedidoParaBaixa {
  id: string; pedido_id: string; status: string; observacao: string | null;
  envio_tipo: "SUPERVISOR" | "CORREIO" | null; envio_rastreio: string | null;
  tipo_pedido: string; nome_colaborador: string; observacoes_solicitante: string | null;
  retirado_em?: string | null; retirado_por_nome?: string | null;
  sup_pedido_item: ItemPedido[];
}

/** Código já baixado para um item, com quanto saiu dele e o CA do lote. */
interface Designado { codigo: string; quantidade: number; ca: string | null }

/**
 * Linha do modal. `confirmado` marca que a leitura terminou (Enter, sair do
 * campo, escolha da lista) — é o que libera a prévia "sai do lote X, CA Y".
 */
type LinhaDoModal = LinhaCodigo & { confirmado?: boolean };

let seqLinha = 0;
/** Linha nova de código + quantidade. O id só serve de `key` para o React. */
function novaLinha(quantidade: number, codigo = ""): LinhaDoModal {
  seqLinha += 1;
  return {
    id: `linha-${seqLinha}`, codigo, confirmado: !!codigo,
    quantidade: String(Math.max(quantidade, 1)),
  };
}

const somaLinhas = (ls: LinhaCodigo[]) => ls.reduce((s, l) => s + (Number(l.quantidade) || 0), 0);
const SEM_CA: Record<string, string> = {};

export function ModalBaixaPedido({
  pedido, onFechar,
}: { pedido: PedidoParaBaixa | null; onFechar: () => void }) {
  const { data: jaBaixadas = [], isLoading: carregandoTags } = useTagsDoPedido(pedido?.id ?? null);
  const { data: caPorCodigo = SEM_CA } = useCaDosCodigos(jaBaixadas.map((t) => t.codigo));
  const validar = useValidarTags();
  const baixar = useBaixarPedido();
  const desvincular = useDesvincularCodigo();

  const [status, setStatus] = useState("");
  const [observacao, setObservacao] = useState("");
  const [envioTipo, setEnvioTipo] = useState<"" | "SUPERVISOR" | "CORREIO">("");
  const [envioRastreio, setEnvioRastreio] = useState("");
  const [linhas, setLinhas] = useState<Record<string, LinhaDoModal[]>>({});
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [confirmandoSemBaixa, setConfirmandoSemBaixa] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [vendoTrajeto, setVendoTrajeto] = useState(false);

  // Os códigos já baixados vêm do banco a cada render, sem cópia no estado:
  // desvincular um código atualiza esta lista sem apagar o que o operador já
  // digitou nas outras linhas nem o status escolhido.
  const designadosPorItem = useMemo(() => {
    const m: Record<string, Designado[]> = {};
    for (const t of jaBaixadas) {
      (m[t.pedido_item_id] = m[t.pedido_item_id] ?? [])
        .push({ codigo: t.codigo, quantidade: Number(t.quantidade), ca: caPorCodigo[t.codigo] ?? null });
    }
    return m;
  }, [jaBaixadas, caPorCodigo]);

  // Semeia o modal ao abrir/trocar de pedido — uma vez por pedido.
  if (pedido && pedido.id !== idAtual && !carregandoTags) {
    setIdAtual(pedido.id);
    // Pedido retirado pelo supervisor: o único passo que falta é despachar
    // informando o tipo de envio. Já abre nele — é para isso que a pessoa
    // clicou em Status.
    setStatus(pedido.status === "RETIRADO PARA ENTREGA" ? "DESPACHADO" : pedido.status);
    setObservacao(pedido.observacao ?? "");
    setEnvioTipo(pedido.envio_tipo ?? "");
    setEnvioRastreio(pedido.envio_rastreio ?? "");
    // Uma linha por item que ainda tem unidade a baixar, já com o que falta:
    // o caso comum é "tudo sai de um código só".
    const inicial: Record<string, LinhaDoModal[]> = {};
    for (const it of pedido.sup_pedido_item ?? []) {
      const ja = jaBaixadas
        .filter((t) => t.pedido_item_id === it.id)
        .reduce((s, t) => s + Number(t.quantidade), 0);
      const faltam = it.quantidade - ja;
      inicial[it.id] = faltam > 0 ? [novaLinha(faltam)] : [];
    }
    setLinhas(inicial);
  }

  const itensPedido = useMemo(
    () => [...(pedido?.sup_pedido_item ?? [])].sort((a, b) => a.ordem - b.ordem),
    [pedido],
  );

  const semBaixa = useMemo(
    () => itensPedido.filter((it) =>
      (designadosPorItem[it.id] ?? []).length === 0
      && !(linhas[it.id] ?? []).some((l) => l.codigo.trim())),
    [itensPedido, designadosPorItem, linhas],
  );

  const itensComLinhas = (): ItemComLinhas[] => itensPedido.map((it) => ({
    pedido_item_id: it.id,
    nome: it.nome_item,
    pedida: it.quantidade,
    designados: designadosPorItem[it.id] ?? [],
    linhas: linhas[it.id] ?? [],
  }));

  /**
   * Desfaz a designação na hora, sem esperar o "Confirmar": a pessoa quer ver
   * a unidade de volta no estoque e o código liberado antes de bipar o certo.
   */
  const desvincularCodigo = async (itemId: string, d: Designado, motivo: string): Promise<boolean> => {
    if (!pedido) return false;
    try {
      const r = await desvincular.mutateAsync({
        pedido_id: pedido.id, pedido_item_id: itemId, codigo: d.codigo, motivo,
      });
      // O próximo passo natural é bipar o código certo: abre uma linha vazia
      // com a quantidade que voltou, se o item ainda não tiver uma.
      setLinhas((s) => {
        const atuais = s[itemId] ?? [];
        if (atuais.some((l) => !l.codigo.trim())) return s;
        return { ...s, [itemId]: [...atuais, novaLinha(r.quantidade)] };
      });
      return true;
    } catch {
      return false;   // o hook já mostrou o motivo
    }
  };

  /** Recusa com a lista de motivos e devolve o operador ao modal. */
  const falhar = (titulo: string, erros: string[]) => {
    setConfirmandoSemBaixa(false);
    toast.error(titulo, { description: erros.join(" · "), duration: 12000 });
  };

  /**
   * Linhas digitadas → baixas prontas para sup_est_baixar, ou null se algo
   * foi recusado (o motivo já foi mostrado). Nada é gravado aqui.
   */
  const prepararBaixas = async (itensDigitados: ItemComLinhas[]): Promise<Baixa[] | null> => {
    if (!pedido) return null;

    // 1) Código do PRODUTO vira lotes — o banco escolhe, CA vencendo
    //    primeiro, e o CA de cada lote vem junto. Código de lote passa direto.
    const consultas = itensDigitados.flatMap((it) => it.linhas
      .filter((l) => l.codigo.trim())
      .map((l) => ({
        pedido_item_id: it.pedido_item_id,
        codigo: normalizarCodigo(l.codigo),
        quantidade: Number(l.quantidade),
      })));
    let respostas: ResolucaoCodigo[] = [];
    try {
      respostas = await resolverCodigos(consultas);
    } catch (e: unknown) {
      // Banco ainda sem a migration 0114: segue aceitando só código de lote,
      // como antes, em vez de travar a baixa inteira.
      if ((e as { code?: string })?.code !== "PGRST202") throw e;
    }
    const resolucoes: Record<string, ResolucaoCodigo> = {};
    respostas.forEach((r, i) => {
      resolucoes[chaveResolucao(consultas[i].pedido_item_id, consultas[i].codigo)] = r;
    });
    const expandido = expandirCodigosDeProduto(itensDigitados, resolucoes);
    if (expandido.erros.length > 0) {
      falhar("Confira os códigos — nada foi salvo.", expandido.erros);
      return null;
    }

    // 2) Valida ANTES de tocar no estoque (§6.8): assim o operador vê o
    //    motivo exato e nada é gravado pela metade. A validação também diz o
    //    tipo de cada código, que o operador não escolhe mais.
    const res = await validar.mutateAsync({
      codigos: codigosDasLinhas(expandido.itens), pedido_id: pedido.id,
    });
    const ruins = res.filter((r) => !r.valido);
    if (ruins.length > 0) {
      falhar("Código inválido — nada foi baixado.", ruins.map((r) => `${r.codigo}: ${r.motivo}`));
      return null;
    }
    const tipos: TiposDosCodigos = {};
    for (const r of res) {
      if (r.tipo) tipos[normalizarCodigo(r.codigo)] = { tipo: r.tipo, disponivel: Number(r.disponivel ?? 0) };
    }
    const montado = montarBaixasDasLinhas(expandido.itens, tipos);
    if (montado.erros.length > 0) {
      falhar("Confira os códigos — nada foi salvo.", montado.erros);
      return null;
    }
    return montado.baixas;
  };

  const enviar = async (pularAvisoDespacho = false) => {
    if (!pedido) return;

    // Esta validação antecede inclusive o aviso de baixa incompleta. A mesma
    // guarda existe na RPC porque outros caminhos também conseguem despachar.
    if (status === "DESPACHADO" && !envioTipo) {
      toast.error("Informe o tipo de envio para despachar o pedido.");
      return;
    }
    if (status === "DESPACHADO" && envioTipo === "CORREIO" && !envioRastreio.trim()) {
      toast.error("Informe o ID de rastreio dos Correios.");
      return;
    }

    // Erro de digitação primeiro, sem ir ao banco.
    const itensDigitados = itensComLinhas();
    const errosLocais = conferirLinhas(itensDigitados);
    if (errosLocais.length > 0) {
      falhar("Confira os códigos — nada foi salvo.", errosLocais);
      return;
    }
    const temCodigo = codigosDasLinhas(itensDigitados).length > 0;

    const mudouStatus = status !== pedido.status;
    const mudouObs = (observacao || "") !== (pedido.observacao || "");
    const mudouEnvio = status === "DESPACHADO" && (
      envioTipo !== (pedido.envio_tipo ?? "")
      || (envioTipo === "CORREIO" ? envioRastreio.trim() : "") !== (pedido.envio_rastreio ?? "")
    );
    if (!mudouStatus && !mudouObs && !mudouEnvio && !temCodigo) {
      toast.info("Nada mudou.");
      return;
    }

    // Despachar com item sem código avisa, mas não trava — decisão de produto.
    if (!pularAvisoDespacho && status === "DESPACHADO" && semBaixa.length > 0) {
      setConfirmandoSemBaixa(true);
      return;
    }

    let baixas: Baixa[] = [];
    if (temCodigo) {
      setConferindo(true);
      try {
        const prontas = await prepararBaixas(itensDigitados);
        if (!prontas) return;
        baixas = prontas;
      } catch (e: unknown) {
        falhar("Não foi possível conferir os códigos.", [(e as { message?: string })?.message ?? String(e)]);
        return;
      } finally {
        setConferindo(false);
      }
    }

    await baixar.mutateAsync({
      pedido_id: pedido.id,
      status,
      observacao: observacao || null,
      baixas,
      envio: status === "DESPACHADO" && envioTipo
        ? { tipo: envioTipo, rastreio: envioTipo === "CORREIO" ? envioRastreio.trim() : null }
        : null,
    });
    setConfirmandoSemBaixa(false);
    setIdAtual(null);
    onFechar();
  };

  const ocupado = conferindo || validar.isPending || baixar.isPending || desvincular.isPending;
  const motivoBloqueio = status === "DESPACHADO" && !envioTipo
    ? "Informe o tipo de envio."
    : status === "DESPACHADO" && envioTipo === "CORREIO" && !envioRastreio.trim()
      ? "Informe o ID de rastreio."
      : null;
  const formatoRastreioIncomum = envioTipo === "CORREIO"
    && !!envioRastreio.trim()
    && !/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(envioRastreio.trim());

  return (
    <>
      <Dialog open={!!pedido && !confirmandoSemBaixa} onOpenChange={(o) => { if (!o) { setIdAtual(null); onFechar(); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Atualizar pedido
              <span className="font-mono text-sm">{pedido?.pedido_id}</span>
              <Badge variant="secondary" className="uppercase">{pedido?.tipo_pedido}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Contexto */}
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span><span className="text-muted-foreground">Colaborador: </span>{pedido?.nome_colaborador || "—"}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">Status atual:</span>
                  <Badge variant="outline" className={cn(ESTILO_STATUS[pedido?.status ?? ""]?.classe)}>
                    {ESTILO_STATUS[pedido?.status ?? ""]?.rotulo ?? pedido?.status}
                  </Badge>
                </span>
              </div>
              {pedido?.status === "RETIRADO PARA ENTREGA" && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-cyan-400/40 bg-cyan-50/60 p-2 text-xs dark:bg-cyan-950/20">
                  <Car className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700" />
                  <p>
                    Retirado por <strong>{pedido.retirado_por_nome ?? "—"}</strong>
                    {pedido.retirado_em && <> em {new Date(pedido.retirado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</>}
                    {" "}pelo QR code da etiqueta. Informe o tipo de envio para concluir o despacho.
                  </p>
                </div>
              )}
              {pedido?.observacoes_solicitante && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <p><strong>Observação do solicitante:</strong> {pedido.observacoes_solicitante}</p>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Novo status *</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* "Retirado para entrega" só nasce do QR code — o banco
                        recusa pelo modal. Aparece só para o pedido que já
                        está nele, senão o Select ficaria sem opção marcada. */}
                    {STATUS_PEDIDO
                      .filter((s) => s !== "RETIRADO PARA ENTREGA" || pedido?.status === s)
                      .map((s) => (
                        <SelectItem key={s} value={s}>{ESTILO_STATUS[s].rotulo}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comentário para o solicitante <span className="text-muted-foreground">(opcional)</span></Label>
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Ex.: falta a botina 42, prazo de 5 dias."
                />
              </div>
            </div>

            {status === "DESPACHADO" && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-950/20">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Tipo de envio *</Label>
                    <Select
                      value={envioTipo}
                      onValueChange={(v: "SUPERVISOR" | "CORREIO") => setEnvioTipo(v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SUPERVISOR">Entrega via Supervisor</SelectItem>
                        <SelectItem value="CORREIO">Entrega via Correio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {envioTipo === "CORREIO" && (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="envio-rastreio">ID de Rastreio Correio *</Label>
                        {/* O mapa do trajeto. Fica aqui, colado no código, porque
                            é o único lugar da tela onde alguém já está olhando
                            para o objeto — e só faz sentido com código digitado. */}
                        <Button
                          type="button" variant="outline" size="icon"
                          className="h-7 w-7 shrink-0"
                          disabled={!envioRastreio.trim()}
                          onClick={() => setVendoTrajeto(true)}
                          title={envioRastreio.trim()
                            ? "Ver no mapa por onde o objeto passou"
                            : "Informe o código de rastreio para ver o trajeto"}
                        >
                          <MapIcon className="h-4 w-4" />
                          <span className="sr-only">Ver trajeto no mapa</span>
                        </Button>
                      </div>
                      <Input
                        id="envio-rastreio"
                        value={envioRastreio}
                        onChange={(e) => setEnvioRastreio(e.target.value)}
                        placeholder="OY768984409BR"
                        className="font-mono uppercase"
                      />
                      {formatoRastreioIncomum && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          Formato diferente do padrão AA000000000AA; o código será aceito mesmo assim.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Baixa de estoque */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <TagIcon className="h-4 w-4 text-muted-foreground" />
                Códigos do estoque
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                Bipe ou digite o código do produto ou do lote e informe quantas unidades saem.
                Com o código do produto, o sistema escolhe o lote (CA que vence primeiro) e mostra
                o CA. Se as unidades saem de códigos diferentes, use o +.
              </p>

              {carregandoTags ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Carregando códigos…</p>
              ) : (
                <div className="space-y-3">
                  {itensPedido.map((it) => (
                    <BlocoItem
                      key={it.id}
                      item={it}
                      designados={designadosPorItem[it.id] ?? []}
                      linhas={linhas[it.id] ?? []}
                      onLinhas={(ls) => setLinhas((s) => ({ ...s, [it.id]: ls }))}
                      onDesvincular={(d, motivo) => desvincularCodigo(it.id, d, motivo)}
                      ocupado={ocupado}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIdAtual(null); onFechar(); }}>Cancelar</Button>
            <div className="flex flex-col items-end gap-1">
              <Button disabled={ocupado || !!motivoBloqueio} onClick={() => enviar()}>
                {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Confirmar"}
              </Button>
              {motivoBloqueio && <span className="text-xs text-amber-700 dark:text-amber-300">{motivoBloqueio}</span>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Despacho com item sem baixa: avisa, mas deixa seguir. */}
      <Dialog open={confirmandoSemBaixa} onOpenChange={(o) => !o && setConfirmandoSemBaixa(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Despachar sem baixa completa?</DialogTitle></DialogHeader>
          <div className="flex items-start gap-3 py-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p>
                <strong>{semBaixa.length}</strong> de <strong>{itensPedido.length}</strong> itens
                não têm código designado:
              </p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {semBaixa.map((it) => <li key={it.id}>{it.nome_item}</li>)}
              </ul>
              <p className="mt-2 text-muted-foreground">
                O pedido sai sem registro de qual peça foi entregue. Dá para despachar assim mesmo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoSemBaixa(false)}>Voltar e baixar</Button>
            <Button disabled={ocupado} onClick={() => enviar(true)}>Despachar assim mesmo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mapa do trajeto — lê o código que está NO CAMPO, não o gravado, para
          conferir um código recém-digitado antes de salvar o despacho. */}
      <ModalTrajetoCorreio
        codigo={vendoTrajeto ? envioRastreio.trim().toUpperCase() : null}
        protocolo={pedido?.pedido_id}
        onFechar={() => setVendoTrajeto(false)}
      />
    </>
  );
}

/** Uma sub-seção por item do pedido: saldo, códigos já baixados e linhas de código + quantidade. */
function BlocoItem({
  item, designados, linhas, onLinhas, onDesvincular, ocupado,
}: {
  item: ItemPedido;
  designados: Designado[];
  linhas: LinhaDoModal[];
  onLinhas: (linhas: LinhaDoModal[]) => void;
  onDesvincular: (d: Designado, motivo: string) => Promise<boolean>;
  ocupado: boolean;
}) {
  const { data: saldo } = useSaldoMaterial(item.item_id, item.tamanho);
  const { data: disponiveis = [] } = useTagsDisponiveis(item.item_id, item.tamanho);
  /** Código com a confirmação de "desvincular" aberta. */
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  // Quanto cada lote livre ainda tem, e o CA dele — só uma dica ao lado da
  // linha. Quem decide de verdade é sup_est_baixar, que desconta a reserva.
  const lotesLivres = useMemo(
    () => new Map(disponiveis.map((t) => [t.codigo, {
      livre: t.tipo === "massa" ? Number(t.quantidade_massa ?? 0) : 1,
      ca: t.ca_numero?.trim() || null,
    }] as const)),
    [disponiveis],
  );

  const jaBaixado = designados.reduce((s, d) => s + d.quantidade, 0);
  const faltam = Math.max(item.quantidade - jaBaixado, 0);
  const informado = somaLinhas(linhas.filter((l) => l.codigo.trim()));
  const passou = jaBaixado + informado > item.quantidade;
  const semEstoque = saldo != null && saldo <= 0;
  const noCampo = new Set(linhas.map((l) => normalizarCodigo(l.codigo)));

  const alterarLinha = (id: string, patch: Partial<LinhaDoModal>) =>
    onLinhas(linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removerLinha = (id: string) => onLinhas(linhas.filter((l) => l.id !== id));
  /** Linha nova já com o que ainda falta distribuir (mínimo 1). */
  const adicionarLinha = (codigo = "") =>
    onLinhas([...linhas, novaLinha(faltam - somaLinhas(linhas), codigo)]);
  const escolherDaLista = (codigo: string) => {
    const vazia = linhas.find((l) => !l.codigo.trim());
    if (vazia) alterarLinha(vazia.id, { codigo, confirmado: true });
    else adicionarLinha(codigo);
  };
  /** Colou uma lista: o primeiro código fica na linha, os demais ganham linha própria. */
  const colarVarios = (id: string, codigos: string[]) => {
    const i = linhas.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [primeiro, ...resto] = codigos;
    const novas = [...linhas];
    novas[i] = { ...novas[i], codigo: primeiro, quantidade: "1", confirmado: true };
    novas.splice(i + 1, 0, ...resto.map((c) => novaLinha(1, c)));
    onLinhas(novas);
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.nome_item}</span>
        {item.tamanho && <Badge variant="outline">Tam. {item.tamanho}</Badge>}
        <Badge variant="secondary">{item.quantidade} un. pedida(s)</Badge>
        <Badge
          variant="outline"
          className={cn("ml-auto",
            semEstoque
              ? "border-red-400/50 text-red-600"
              : "border-emerald-400/50 text-emerald-700 dark:text-emerald-300")}
        >
          {saldo == null ? "…" : `${saldo} em estoque`}
        </Badge>
      </div>

      {/* Códigos já baixados: travados de propósito. A única saída é
          desvincular, que devolve ao estoque e fica no histórico. */}
      {designados.length > 0 && (
        <div className="mb-2 space-y-1">
          {designados.map((d) => (
            <div key={d.codigo}
              className="rounded-md border border-emerald-400/50 bg-emerald-50 px-2 py-1.5 text-xs dark:bg-emerald-950/30">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Lock className="h-3 w-3 shrink-0 text-emerald-600" />
                <span className="truncate font-mono">{d.codigo}</span>
                <span className="shrink-0 text-muted-foreground">· {d.quantidade} un.</span>
                {d.ca && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">CA {d.ca}</Badge>}
                <span className="ml-auto shrink-0 text-muted-foreground">já baixada</span>
                {desfazendo !== d.codigo && (
                  <Button
                    type="button" variant="ghost" size="sm"
                    className="h-6 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={ocupado}
                    onClick={() => { setDesfazendo(d.codigo); setMotivo(""); }}
                  >
                    <Undo2 className="mr-1 h-3 w-3" /> Desvincular
                  </Button>
                )}
              </div>
              {desfazendo === d.codigo && (
                <div className="mt-2 space-y-2 border-t border-emerald-400/40 pt-2">
                  <p className="text-foreground">
                    {d.quantidade === 1 ? "A unidade volta" : `As ${d.quantidade} unidades voltam`} para o
                    estoque na hora, e a troca fica registrada no histórico do pedido.
                  </p>
                  <Input
                    autoFocus
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    placeholder="Motivo (opcional) — ex.: código errado"
                    className="h-8 bg-background text-xs"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => setDesfazendo(null)}>
                      Cancelar
                    </Button>
                    <Button
                      type="button" variant="destructive" size="sm" className="h-7 text-xs"
                      disabled={ocupado}
                      onClick={async () => { if (await onDesvincular(d, motivo)) setDesfazendo(null); }}
                    >
                      {ocupado
                        ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        : <Undo2 className="mr-1 h-3 w-3" />}
                      Desvincular e devolver ao estoque
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {faltam === 0 && linhas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Todas as unidades já foram baixadas. Para trocar um código, desvincule-o acima.
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-1">Código</span>
            <span className="w-20">Quantidade</span>
            <span className="w-9 shrink-0" aria-hidden />
          </div>
          <div className="space-y-1.5">
            {linhas.map((l) => (
              <LinhaDeCodigo
                key={l.id}
                itemId={item.id}
                linha={l}
                lote={lotesLivres.get(normalizarCodigo(l.codigo))}
                podeRemover={linhas.length > 1}
                onAlterar={(patch) => alterarLinha(l.id, patch)}
                onRemover={() => removerLinha(l.id)}
                onColar={(cods) => colarVarios(l.id, cods)}
              />
            ))}
          </div>

          {passou && (
            <p className="mt-1.5 text-xs text-amber-600">
              {jaBaixado + informado} un. informada(s) para {item.quantidade} pedida(s) — ajuste as quantidades.
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Button
              type="button" variant="ghost" size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => adicionarLinha()}
              title="Adicionar outro código para este item"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar código
            </Button>

            {disponiveis.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                    <List className="mr-1.5 h-3.5 w-3.5" /> Escolher da lista ({disponiveis.length} livres)
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="max-h-64 w-80 overflow-y-auto p-1">
                  {disponiveis.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={noCampo.has(t.codigo)}
                      onClick={() => escolherDaLista(t.codigo)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-40"
                    >
                      <span className="flex-1 truncate font-mono">{t.codigo}</span>
                      {t.tamanho && <Badge variant="secondary" className="text-[10px]">{t.tamanho}</Badge>}
                      {t.ca_numero?.trim() && (
                        <Badge variant="outline" className="text-[10px]">CA {t.ca_numero.trim()}</Badge>
                      )}
                      {t.tipo === "massa" && (
                        <Badge variant="outline" className="text-[10px]">{t.quantidade_massa} un.</Badge>
                      )}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>

          {semEstoque && (
            <p className="mt-1.5 text-xs text-amber-600">
              Sem saldo deste material no estoque. Dê entrada antes, ou mude o status
              para "Aguardando compra".
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Uma linha "código + quantidade". A pistola digita o código e manda Enter. */
function LinhaDeCodigo({
  itemId, linha, lote, podeRemover, onAlterar, onRemover, onColar,
}: {
  itemId: string;
  linha: LinhaDoModal;
  /** Livre e CA do código, quando ele é um dos lotes livres do item. */
  lote: { livre: number; ca: string | null } | undefined;
  podeRemover: boolean;
  onAlterar: (patch: Partial<LinhaDoModal>) => void;
  onRemover: () => void;
  onColar: (codigos: string[]) => void;
}) {
  // Código que não é um lote conhecido pode ser o do PRODUTO: pergunta ao
  // banco de onde sairia, para o CA aparecer antes do Confirmar.
  const { data: previa } = useResolucaoDaLinha(
    itemId, linha.codigo, Number(linha.quantidade) || 1, !!linha.confirmado && !lote,
  );

  const confirmarLeitura = () => {
    const n = normalizarCodigo(linha.codigo);
    if (n !== linha.codigo || linha.confirmado !== !!n) onAlterar({ codigo: n, confirmado: !!n });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={linha.codigo}
            onChange={(e) => onAlterar({ codigo: e.target.value, confirmado: false })}
            onKeyDown={(e) => {
              // A pistola manda Enter ao fim da leitura. preventDefault evita
              // que o Enter submeta o modal em volta.
              if (e.key === "Enter") { e.preventDefault(); confirmarLeitura(); }
            }}
            onBlur={confirmarLeitura}
            onPaste={(e) => {
              // Lista colada de planilha: o navegador achataria as quebras de
              // linha num <input>, então o texto vem da área de transferência.
              const codigos = separarCodigos(e.clipboardData.getData("text"));
              if (codigos.length < 2) return;   // colagem simples segue o fluxo normal
              e.preventDefault();
              onColar(codigos);
            }}
            placeholder="Bipe ou digite o código…"
            className="h-9 pl-9 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={linha.quantidade}
          onChange={(e) => onAlterar({ quantidade: e.target.value })}
          className="h-9 w-20"
          aria-label="Quantidade"
        />
        {podeRemover ? (
          <Button
            type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
            onClick={onRemover} aria-label="Remover esta linha" title="Remover esta linha"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <span className="w-9 shrink-0" aria-hidden />
        )}
      </div>

      {lote ? (
        <p className="mt-0.5 pl-1 text-[11px] text-muted-foreground">
          {lote.livre} un. livre(s) neste lote{lote.ca && <> · CA {lote.ca}</>}
        </p>
      ) : previa?.tipo === "produto" ? (
        <div className="mt-0.5 pl-1 text-[11px]">
          <p className="text-muted-foreground">
            Produto {previa.produto.codigo} · {previa.produto.nome}
            {previa.lotes.length > 0 && " — sai de:"}
          </p>
          {previa.lotes.map((l) => (
            <p key={l.codigo} className="text-muted-foreground">
              <span className="font-mono">{l.codigo}</span> · {l.quantidade} un.
              {l.ca_numero ? <> · <strong className="font-medium text-foreground">CA {l.ca_numero}</strong></> : " · sem CA"}
            </p>
          ))}
          {previa.faltam > 0 && (
            <p className="text-amber-600">
              Faltam {previa.faltam} un. livre(s) deste produto
              {previa.bloqueadas > 0 && ` — ${previa.bloqueadas} un. estão em lote com CA bloqueado`}.
            </p>
          )}
        </div>
      ) : previa?.tipo === "outro_produto" ? (
        <p className="mt-0.5 pl-1 text-[11px] text-destructive">
          Este é o código de "{previa.produto.nome}", não deste item.
        </p>
      ) : previa?.tipo === "desconhecido" ? (
        <p className="mt-0.5 pl-1 text-[11px] text-destructive">Código não encontrado no estoque.</p>
      ) : null}
    </div>
  );
}
