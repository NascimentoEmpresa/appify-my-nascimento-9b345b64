import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, FileCheck, CircleDollarSign } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosERP } from "@/hooks/useContratosERP";
import {
  NfEmissaoRow,
  NfEmissaoItemRow,
  useNfsEmissao,
  useItensNfEmissao,
  useRegistrarPagamentoNf,
  TIPOS_NOTA,
} from "@/hooks/useNfEmissao";
import { calcularItem, calcularTotaisNf, pctEfetivo, ItemCalculado } from "@/pages/financeiro/nf-emissao/calculos";
import { fmtMoney, fmtDate, situacaoEspecial } from "@/pages/financeiro/nf-emissao/shared";
import { ItensNfEditor, ItemForm } from "@/pages/financeiro/nf-emissao/ItensNfEditor";
import { registrarLogNf } from "@/pages/financeiro/nf-emissao/registrarLogNf";
import { HistoricoNfPainel } from "@/pages/financeiro/nf-emissao/HistoricoNfPainel";

type StatusFiltro = "todos" | "pendente" | "pago" | "substituida" | "cancelada";

const STATUS_FILTRO_LABEL: Record<StatusFiltro, string> = {
  todos: "Todos",
  pendente: "Pendente",
  pago: "Pago",
  substituida: "Substituída",
  cancelada: "Cancelada",
};

function statusDaNota(n: NfEmissaoRow): Exclude<StatusFiltro, "todos"> {
  const esp = situacaoEspecial(n);
  if (esp === "CANCELADA") return "cancelada";
  if (esp === "SUBSTITUIDA") return "substituida";
  return n.data_pagamento ? "pago" : "pendente";
}

function PagamentoBadge({ nf }: { nf: NfEmissaoRow }) {
  if (nf.data_pagamento) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        Pago em {fmtDate(nf.data_pagamento)}
      </Badge>
    );
  }
  const especial = situacaoEspecial(nf);
  if (especial === "CANCELADA") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Cancelada
      </Badge>
    );
  }
  if (especial === "SUBSTITUIDA") {
    return (
      <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
        Substituída
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
      Pendente
    </Badge>
  );
}

function itemRowParaForm(r: NfEmissaoItemRow): ItemForm {
  return {
    identificacao: r.identificacao ?? "",
    valor_contrato_exec: r.valor_contrato_exec,
    vlr_va: r.vlr_va,
    vlr_vt: r.vlr_vt,
    vlr_materiais: r.vlr_materiais,
    faltas: r.faltas,
    posto_nao_implementado: r.posto_nao_implementado,
    multas: r.multas,
    glosas: r.glosas,
    outros_descontos: r.outros_descontos,
    multas_pos_emissao: r.multas_pos_emissao,
    glosas_pos_emissao: r.glosas_pos_emissao,
    outros_descontos_pos_emissao: r.outros_descontos_pos_emissao,
    qtd_colaboradores: r.qtd_colaboradores,
    inss_categoria: r.inss_categoria,
    issqn_pct: r.issqn_pct,
    ir_pct: r.ir_pct,
    cofins_pct: r.cofins_pct,
    pis_pct: r.pis_pct,
    csll_pct: r.csll_pct,
  };
}

export default function NotasConcluidasTab() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;
  const { data: nfs = [], isLoading } = useNfsEmissao(empresaId);
  const { data: contratos = [] } = useContratosERP();

  const [busca, setBusca] = useState("");
  const [contratoSel, setContratoSel] = useState<string | null>(null);
  const [nfSelecionada, setNfSelecionada] = useState<NfEmissaoRow | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<StatusFiltro>("todos");
  const [buscaNf, setBuscaNf] = useState("");

  const concluidas = useMemo(() => nfs.filter((n) => n.status === "concluida"), [nfs]);
  const contratoPorId = useMemo(() => new Map(contratos.map((c) => [c.id, c])), [contratos]);

  const contratosComNotas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contratos
      .map((c) => ({ contrato: c, notas: concluidas.filter((n) => n.contrato_id === c.id) }))
      .filter(({ contrato, notas }) => {
        if (notas.length === 0) return false;
        if (!termo) return true;
        return contrato.nome.toLowerCase().includes(termo) || contrato.cliente.toLowerCase().includes(termo);
      })
      .sort((a, b) => {
        const encerradoA = a.contrato.status === "encerrado" ? 1 : 0;
        const encerradoB = b.contrato.status === "encerrado" ? 1 : 0;
        return encerradoA !== encerradoB ? encerradoA - encerradoB : a.contrato.nome.localeCompare(b.contrato.nome);
      });
  }, [contratos, concluidas, busca]);

  const contratoAtual = contratos.find((c) => c.id === contratoSel) ?? null;

  function bateBuscaNf(n: NfEmissaoRow, termo: string) {
    if (!termo) return true;
    return (n.variacao ?? "").toLowerCase().includes(termo) || (n.numero_nf ?? "").toLowerCase().includes(termo);
  }

  const nfsDoContrato = useMemo(() => {
    const termo = buscaNf.trim().toLowerCase();
    return concluidas.filter(
      (n) =>
        n.contrato_id === contratoSel &&
        (filtroStatus === "todos" || statusDaNota(n) === filtroStatus) &&
        bateBuscaNf(n, termo)
    );
  }, [concluidas, contratoSel, filtroStatus, buscaNf]);

  // Sem contrato selecionado, mas com filtro de status e/ou busca de NF ativos:
  // lista achatada cruzando todos os contratos (ex: "me mostra todas as
  // canceladas", ou achar rápido uma variação/nº de nota, útil pra contratos
  // com muitas notas por competência tipo Veranópolis).
  const nfsFlatFiltradas = useMemo(() => {
    if (contratoSel || (filtroStatus === "todos" && !buscaNf.trim())) return [];
    const termo = buscaNf.trim().toLowerCase();
    return concluidas
      .filter((n) => (filtroStatus === "todos" || statusDaNota(n) === filtroStatus) && bateBuscaNf(n, termo))
      .sort((a, b) => b.competencia.localeCompare(a.competencia));
  }, [concluidas, contratoSel, filtroStatus, buscaNf]);

  return (
    <div className="grid grid-cols-5 gap-4 h-[calc(100vh-220px)] min-h-[480px]">
      <div className="col-span-2 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar contrato…"
              className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {!isLoading && contratosComNotas.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma NF concluída ainda. Conclua notas em Controle de Notas pra elas aparecerem aqui.
            </p>
          )}
          {contratosComNotas.map(({ contrato: c, notas }) => {
            const pendentes = notas.filter((n) => !n.data_pagamento && !situacaoEspecial(n)).length;
            const ativo = contratoSel === c.id;
            const encerrado = c.status === "encerrado";
            return (
              <button
                key={c.id}
                onClick={() => setContratoSel(c.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30",
                  ativo && "bg-primary/5 border-l-2 border-l-primary",
                  encerrado && !ativo && "bg-muted/40 opacity-70"
                )}
              >
                <div className="min-w-0">
                  <p className={cn("text-xs font-semibold truncate", encerrado && "text-muted-foreground")}>{c.nome}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.cliente}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {encerrado && (
                    <span className="inline-flex rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Encerrado
                    </span>
                  )}
                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {notas.length}
                  </span>
                  {pendentes > 0 && (
                    <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {pendentes} pend.
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="col-span-3 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
          {(Object.keys(STATUS_FILTRO_LABEL) as StatusFiltro[]).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                filtroStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {STATUS_FILTRO_LABEL[s]}
            </button>
          ))}
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscaNf}
              onChange={(e) => setBuscaNf(e.target.value)}
              placeholder="Buscar variação ou nº da NF…"
              className="h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        {contratoAtual ? (
          <>
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{contratoAtual.nome}</p>
              <p className="text-xs text-muted-foreground">{contratoAtual.cliente}</p>
            </div>
            <div className="overflow-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Variação</TableHead>
                    <TableHead>Nº NF</TableHead>
                    <TableHead>Valor Bruto</TableHead>
                    <TableHead>Valor Líquido</TableHead>
                    <TableHead>Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nfsDoContrato.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhuma NF {filtroStatus === "todos" ? "concluída" : STATUS_FILTRO_LABEL[filtroStatus].toLowerCase()} para este contrato{buscaNf.trim() ? " com essa busca" : ""}.
                      </TableCell>
                    </TableRow>
                  )}
                  {nfsDoContrato.map((nf) => (
                    <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                      <TableCell>
                        {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                      </TableCell>
                      <TableCell>{nf.variacao ?? "-"}</TableCell>
                      <TableCell>{nf.numero_nf ?? "-"}</TableCell>
                      <TableCell>{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                      <TableCell>{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                      <TableCell>
                        <PagamentoBadge nf={nf} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : filtroStatus !== "todos" || buscaNf.trim() ? (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Variação</TableHead>
                  <TableHead>Nº NF</TableHead>
                  <TableHead>Valor Bruto</TableHead>
                  <TableHead>Valor Líquido</TableHead>
                  <TableHead>Pagamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nfsFlatFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhuma NF encontrada com esse filtro/busca.
                    </TableCell>
                  </TableRow>
                )}
                {nfsFlatFiltradas.map((nf) => (
                  <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                    <TableCell className="max-w-[220px] truncate">{contratoPorId.get(nf.contrato_id)?.nome ?? "-"}</TableCell>
                    <TableCell>
                      {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                    </TableCell>
                    <TableCell>{nf.variacao ?? "-"}</TableCell>
                    <TableCell>{nf.numero_nf ?? "-"}</TableCell>
                    <TableCell>{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                    <TableCell>{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                    <TableCell>
                      <PagamentoBadge nf={nf} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center py-20">
            <div className="text-center">
              <FileCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Selecione um contrato ou um status pra ver todas as notas</p>
            </div>
          </div>
        )}
      </div>

      <NfPagamentoDialog nf={nfSelecionada} onClose={() => setNfSelecionada(null)} />
    </div>
  );
}

function NfPagamentoDialog({ nf, onClose }: { nf: NfEmissaoRow | null; onClose: () => void }) {
  const { data: itensExistentes = [] } = useItensNfEmissao(nf?.id);
  const registrarPagamento = useRegistrarPagamentoNf();

  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [valorPago, setValorPago] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [situacaoSitePmt, setSituacaoSitePmt] = useState("");
  const [situacaoDominio, setSituacaoDominio] = useState("");
  const [descontoContaVinculada, setDescontoContaVinculada] = useState("0");
  const [recebimentoExtra, setRecebimentoExtra] = useState("0");
  const [faltaReceber, setFaltaReceber] = useState("0");
  const [pagoAMais, setPagoAMais] = useState("0");

  useEffect(() => {
    if (!nf) return;
    setValorPago(String(nf.valor_pago ?? nf.vlr_liquido_total ?? 0));
    setDataPagamento(nf.data_pagamento ?? new Date().toISOString().slice(0, 10));
    setSituacaoSitePmt(nf.situacao_site_pmt ?? "");
    setSituacaoDominio(nf.situacao_dominio ?? "");
    setDescontoContaVinculada(String(nf.desconto_conta_vinculada ?? 0));
    setRecebimentoExtra(String(nf.recebimento_extra ?? 0));
    setFaltaReceber(String(nf.falta_receber ?? 0));
    setPagoAMais(String(nf.pago_a_mais ?? 0));
  }, [nf?.id]);

  const itens: ItemForm[] = useMemo(() => itensExistentes.map(itemRowParaForm), [itensExistentes]);

  const pctFiscais = nf
    ? { issqn_pct: nf.issqn_pct, ir_pct: nf.ir_pct, cofins_pct: nf.cofins_pct, pis_pct: nf.pis_pct, csll_pct: nf.csll_pct }
    : null;

  const itensCalculados: ItemCalculado[] = useMemo(() => {
    if (!pctFiscais) return [];
    return itens.map((it) => calcularItem(it, pctEfetivo(it, pctFiscais)));
  }, [itens, pctFiscais]);

  const totais = useMemo(() => calcularTotaisNf(itensCalculados), [itensCalculados]);

  function toggleExpandido(i: number) {
    setExpandidos((exp) => {
      const n = new Set(exp);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  async function handleSalvarPagamento() {
    if (!nf) return;
    const valor = Number(valorPago);
    if (!dataPagamento || isNaN(valor) || valor <= 0) {
      toast.error("Informe um valor e uma data de pagamento válidos.");
      return;
    }
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: dataPagamento, valor_pago: valor });
      await registrarLogNf(nf.id, "nf_paga", `Pagamento registrado: ${fmtMoney(valor)} em ${fmtDate(dataPagamento)}`);
      toast.success("Pagamento registrado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar pagamento.");
    }
  }

  async function handleSalvarReconciliacao() {
    if (!nf) return;
    try {
      await registrarPagamento.mutateAsync({
        id: nf.id,
        data_pagamento: nf.data_pagamento,
        valor_pago: nf.valor_pago,
        situacao_site_pmt: situacaoSitePmt.trim() || null,
        situacao_dominio: situacaoDominio.trim() || null,
        desconto_conta_vinculada: Number(descontoContaVinculada) || 0,
        recebimento_extra: Number(recebimentoExtra) || 0,
        falta_receber: Number(faltaReceber) || 0,
        pago_a_mais: Number(pagoAMais) || 0,
      });
      await registrarLogNf(nf.id, "reconciliacao_atualizada", "Reconciliação de pagamento atualizada");
      toast.success("Reconciliação salva.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar reconciliação.");
    }
  }

  async function handleRemoverPagamento() {
    if (!nf) return;
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: null, valor_pago: null });
      await registrarLogNf(nf.id, "pagamento_removido", "Registro de pagamento removido");
      toast.success("Registro de pagamento removido.");
      setConfirmandoRemocao(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover pagamento.");
    }
  }

  return (
    <Dialog open={!!nf} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>NF Concluída</DialogTitle>
          <DialogDescription>Confira os dados validados e registre o pagamento quando ele acontecer.</DialogDescription>
        </DialogHeader>

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Contrato</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.contrato?.nome ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Variação</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.variacao ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Nº NF</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.numero_nf ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Tipo de Nota</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {TIPOS_NOTA[nf.tipo_nota]}
                </div>
              </div>
            </div>
          </section>
        )}

        {nf && (
          <ItensNfEditor
            itens={itens}
            itensCalculados={itensCalculados}
            totais={totais}
            pctFiscais={pctFiscais}
            postosVigentes={[]}
            contratoId={nf.contrato_id}
            expandidos={expandidos}
            mostrarPosEmissao
            readOnly
            onUpdateItem={() => {}}
            onAddItem={() => {}}
            onRemoveItem={() => {}}
            onToggleExpandido={toggleExpandido}
            onSelecionarPostos={() => {}}
            onQtdColaboradoresChange={() => {}}
          />
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CircleDollarSign className="h-4 w-4" /> Pagamento
            </div>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <Label>Valor Pago</Label>
                <Input type="number" step="0.01" value={valorPago} onChange={(e) => setValorPago(e.target.value)} />
              </div>
              <div>
                <Label>Data de Pagamento</Label>
                <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              </div>
              <Button onClick={handleSalvarPagamento} disabled={registrarPagamento.isPending}>
                {nf.data_pagamento ? "Atualizar pagamento" : "Registrar pagamento"}
              </Button>
              {nf.data_pagamento && (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirmandoRemocao(true)}>
                  Remover registro
                </Button>
              )}
            </div>
          </section>
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Reconciliação</div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Situação site P.M.T.</Label>
                <Input value={situacaoSitePmt} onChange={(e) => setSituacaoSitePmt(e.target.value)} placeholder="Ex: Normal" />
              </div>
              <div>
                <Label className="text-xs">Situa Domínio</Label>
                <Input value={situacaoDominio} onChange={(e) => setSituacaoDominio(e.target.value)} placeholder="Ex: Normal" />
              </div>
              <div>
                <Label className="text-xs">Desconto de conta vinculada</Label>
                <Input type="number" step="0.01" value={descontoContaVinculada} onChange={(e) => setDescontoContaVinculada(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Recebimento extra</Label>
                <Input type="number" step="0.01" value={recebimentoExtra} onChange={(e) => setRecebimentoExtra(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Falta receber</Label>
                <Input type="number" step="0.01" value={faltaReceber} onChange={(e) => setFaltaReceber(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Pago a mais</Label>
                <Input type="number" step="0.01" value={pagoAMais} onChange={(e) => setPagoAMais(e.target.value)} />
              </div>
              <div className="col-span-2 flex items-end">
                <Button variant="outline" onClick={handleSalvarReconciliacao} disabled={registrarPagamento.isPending}>
                  Salvar reconciliação
                </Button>
              </div>
            </div>
          </section>
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Histórico</div>
            <HistoricoNfPainel nfEmissaoId={nf.id} />
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmandoRemocao} onOpenChange={setConfirmandoRemocao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover registro de pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A NF volta a aparecer como pendente de pagamento. Essa ação também fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleRemoverPagamento}>
              Confirmar remoção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
