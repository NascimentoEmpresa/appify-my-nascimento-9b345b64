import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import {
  NfEmissaoRow,
  NfEmissaoItemRow,
  useNfsEmissao,
  useItensNfEmissao,
  useValidarNfEmissao,
} from "@/hooks/useNfEmissao";
import { usePlanilhaCustos, resolverPostosVigentes } from "@/hooks/usePlanilhaCusto";
import { calcularItem, calcularTotaisNf, ItemCalculado } from "@/pages/financeiro/nf-emissao/calculos";
import { fmtMoney, fmtDate, STATUS_LABEL, STATUS_CLASS, itemVazio } from "@/pages/financeiro/nf-emissao/shared";
import { ItensNfEditor, ItemForm } from "@/pages/financeiro/nf-emissao/ItensNfEditor";
import { registrarLogNf } from "@/pages/financeiro/nf-emissao/registrarLogNf";
import { HistoricoNfPainel } from "@/pages/financeiro/nf-emissao/HistoricoNfPainel";

export default function ControleNotas() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;
  const { data: nfs = [], isLoading } = useNfsEmissao(empresaId);

  const [aba, setAba] = useState<"pendentes" | "historico">("pendentes");
  const [nfSelecionada, setNfSelecionada] = useState<NfEmissaoRow | null>(null);

  const pendentes = useMemo(() => nfs.filter((n) => n.status === "enviada"), [nfs]);
  const historico = useMemo(() => nfs.filter((n) => n.status === "concluida" || n.status === "cancelada"), [nfs]);
  const lista = aba === "pendentes" ? pendentes : historico;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Validação de Notas"
        subtitle="Validação do Financeiro: confirme e corrija os dados, lance ajustes pós-emissão, e conclua ou cancele cada NF enviada pelo Analista."
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Validação de Notas"]}
      />

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {(["pendentes", "historico"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              aba === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "pendentes" ? `Pendentes (${pendentes.length})` : "Concluídas / Canceladas"}
          </button>
        ))}
      </div>

      <div className="card-elevated overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contrato</TableHead>
              <TableHead>Variação</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Valor Bruto</TableHead>
              <TableHead>Valor Líquido</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {aba === "pendentes" ? "Nenhuma NF pendente de validação." : "Nenhuma NF concluída ou cancelada ainda."}
                </TableCell>
              </TableRow>
            )}
            {lista.map((nf) => (
              <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                <TableCell className="font-medium">{nf.contrato?.nome ?? "-"}</TableCell>
                <TableCell>{nf.variacao ?? "-"}</TableCell>
                <TableCell>
                  {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                </TableCell>
                <TableCell>{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                <TableCell>{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                <TableCell>
                  <Badge className={STATUS_CLASS[nf.status]}>{STATUS_LABEL[nf.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ValidarNfDialog nf={nfSelecionada} onClose={() => setNfSelecionada(null)} />
    </div>
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
  };
}

function ValidarNfDialog({ nf, onClose }: { nf: NfEmissaoRow | null; onClose: () => void }) {
  const { data: itensExistentes = [] } = useItensNfEmissao(nf?.id);
  const { data: planilha = [] } = usePlanilhaCustos();
  const validar = useValidarNfEmissao();

  const [numeroNf, setNumeroNf] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [observacoesFinanceiro, setObservacoesFinanceiro] = useState("");
  const [itens, setItens] = useState<ItemForm[]>([]);
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [unitariosPorItem, setUnitariosPorItem] = useState<(number | null)[]>([]);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const readOnly = !!nf && nf.status !== "enviada";

  useEffect(() => {
    if (!nf) return;
    setNumeroNf(nf.numero_nf ?? "");
    setDataEmissao(nf.data_emissao ?? "");
    setObservacoesFinanceiro(nf.observacoes_financeiro ?? "");
  }, [nf?.id]);

  useEffect(() => {
    if (!nf || itensExistentes.length === 0) return;
    setItens(itensExistentes.map(itemRowParaForm));
    setExpandidos(new Set());
    setUnitariosPorItem(itensExistentes.map(() => null));
  }, [nf?.id, itensExistentes]);

  const pctFiscais = nf
    ? { issqn_pct: nf.issqn_pct, ir_pct: nf.ir_pct, cofins_pct: nf.cofins_pct, pis_pct: nf.pis_pct, csll_pct: nf.csll_pct }
    : null;

  const postosVigentes = useMemo(
    () => (nf ? resolverPostosVigentes(planilha, nf.contrato_id) : []),
    [planilha, nf?.contrato_id]
  );

  const itensCalculados: ItemCalculado[] = useMemo(() => {
    if (!pctFiscais) return [];
    return itens.map((it) => calcularItem(it, pctFiscais));
  }, [itens, pctFiscais]);

  const totais = useMemo(() => calcularTotaisNf(itensCalculados), [itensCalculados]);

  function updateItem(i: number, patch: Partial<ItemForm>) {
    setItens((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
    if ("valor_contrato_exec" in patch && !("qtd_colaboradores" in patch)) {
      setUnitariosPorItem((arr) => arr.map((u, k) => (k === i ? null : u)));
    }
  }
  function addItem() {
    setItens((arr) => {
      setExpandidos((exp) => new Set(exp).add(arr.length));
      return [...arr, itemVazio(arr.length + 1)];
    });
    setUnitariosPorItem((arr) => [...arr, null]);
  }
  function removeItem(i: number) {
    setItens((arr) => (arr.length > 1 ? arr.filter((_, k) => k !== i) : arr));
    setUnitariosPorItem((arr) => (arr.length > 1 ? arr.filter((_, k) => k !== i) : arr));
  }
  function toggleExpandido(i: number) {
    setExpandidos((exp) => {
      const n = new Set(exp);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }
  function selecionarPosto(i: number, posto: string) {
    const p = postosVigentes.find((pv) => pv.posto === posto);
    if (!p) return;
    updateItem(i, { identificacao: p.posto, valor_contrato_exec: p.valorTotal, qtd_colaboradores: p.qtdColaboradores });
    setUnitariosPorItem((arr) => arr.map((u, k) => (k === i ? p.valorUnitario : u)));
  }
  function qtdColaboradoresChange(i: number, novaQtd: number) {
    const unit = unitariosPorItem[i];
    if (unit != null) {
      updateItem(i, { qtd_colaboradores: novaQtd, valor_contrato_exec: Math.round(unit * novaQtd * 100) / 100 });
    } else {
      updateItem(i, { qtd_colaboradores: novaQtd });
    }
  }

  function handleClose() {
    onClose();
  }

  async function handleValidar(status: "concluida" | "cancelada") {
    if (!nf) return;
    if (status === "cancelada" && !observacoesFinanceiro.trim()) {
      toast.error("Informe uma observação explicando o cancelamento.");
      return;
    }
    try {
      await validar.mutateAsync({
        id: nf.id,
        numero_nf: numeroNf || null,
        data_emissao: dataEmissao || null,
        observacoes_financeiro: observacoesFinanceiro || null,
        itens: itensCalculados,
        totais,
        status,
      });
      await registrarLogNf(
        nf.id,
        status === "concluida" ? "nf_concluida" : "nf_cancelada",
        status === "concluida" ? "NF concluída pelo Financeiro" : `NF cancelada: ${observacoesFinanceiro}`
      );
      toast.success(status === "concluida" ? "NF concluída." : "NF cancelada.");
      setConfirmandoCancelamento(false);
      handleClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao validar NF.");
    }
  }

  return (
    <Dialog open={!!nf} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Validar NF</DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Esta NF já foi validada pelo Financeiro e não pode mais ser alterada."
              : "Confirme e corrija os dados que precisar, lance ajustes pós-emissão se houver, e conclua ou cancele."}
          </DialogDescription>
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
                <Label className="text-xs">Competência</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                </div>
              </div>
              <div>
                <Label>Número da NF</Label>
                <Input value={numeroNf} onChange={(e) => setNumeroNf(e.target.value)} placeholder="Ex: 1234" disabled={readOnly} />
              </div>
              <div>
                <Label>Data de Emissão</Label>
                <Input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} disabled={readOnly} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Observações do Analista</Label>
                <div className="flex min-h-10 items-center rounded-md border border-input bg-muted px-3 py-2 text-sm">
                  {nf.observacoes || "-"}
                </div>
              </div>
              <div className="col-span-4">
                <Label>Observações do Financeiro</Label>
                <Textarea
                  rows={2}
                  value={observacoesFinanceiro}
                  onChange={(e) => setObservacoesFinanceiro(e.target.value)}
                  placeholder="Obrigatório em caso de cancelamento."
                  disabled={readOnly}
                />
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
            postosVigentes={postosVigentes}
            contratoId={nf.contrato_id}
            expandidos={expandidos}
            mostrarPosEmissao
            readOnly={readOnly}
            onUpdateItem={updateItem}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onToggleExpandido={toggleExpandido}
            onSelecionarPosto={selecionarPosto}
            onQtdColaboradoresChange={qtdColaboradoresChange}
          />
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Histórico</div>
            <HistoricoNfPainel nfEmissaoId={nf.id} />
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Fechar
          </Button>
          {!readOnly && (
            <>
              <Button variant="destructive" onClick={() => setConfirmandoCancelamento(true)} disabled={validar.isPending}>
                Cancelar NF
              </Button>
              <Button onClick={() => handleValidar("concluida")} disabled={validar.isPending}>
                {validar.isPending ? "Salvando..." : "Concluir"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmandoCancelamento} onOpenChange={setConfirmandoCancelamento}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta NF?</AlertDialogTitle>
            <AlertDialogDescription>
              Preencha a observação do Financeiro explicando o motivo antes de confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleValidar("cancelada")}>
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
