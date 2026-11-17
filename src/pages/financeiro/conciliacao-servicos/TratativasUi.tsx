import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { useAtualizarTratativa, useCriarTratativa, useHistoricoTratativa, useResponsaveis, type NovaTratativa } from "@/hooks/useTratativasConciliacao";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { INFO_COL, INFO_KPI } from "./infos";
import { ROTULO_TIPO_DIVERGENCIA } from "./regras";
import { emAberto, resumoTratativas, ROTULO_STATUS_TRATATIVA, STATUS_TRATATIVA, textoHistorico, vencida, type StatusTratativa, type Tratativa } from "./tratativas";

// SIS-2026-0903 (Fase 2, item 4.7): registrar e acompanhar as divergências (responsável, justificativa, situação, datas e histórico).

const TODOS = "todos";
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const mesLabel = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : "—");
const COR: Record<StatusTratativa, string> = {
  aberta: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  em_analise: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  justificada: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  regularizada: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
};
export const StatusTratativaPill = ({ status }: { status: StatusTratativa }) => <Badge variant="outline" className={COR[status]}>{ROTULO_STATUS_TRATATIVA[status]}</Badge>;

/** Abre a tratativa existente (edição + histórico) ou, sem ela, o formulário de nova tratativa para o alvo informado. */
export function DialogTratativa({ aberto, existente, novo, podeAlterar, onClose }: {
  aberto: boolean; existente: Tratativa | null; novo: NovaTratativa | null; podeAlterar: boolean; onClose: () => void;
}) {
  const { data: pessoas = [] } = useResponsaveis();
  const criar = useCriarTratativa();
  const atualizar = useAtualizarTratativa();
  const { data: historico = [] } = useHistoricoTratativa(existente?.id ?? null);
  const [status, setStatus] = useState<StatusTratativa>("aberta");
  const [responsavelId, setResponsavelId] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [prazo, setPrazo] = useState("");
  const [regularizadaEm, setRegularizadaEm] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setStatus(existente?.status ?? novo?.status ?? "aberta");
    setResponsavelId(existente?.responsavelId ?? novo?.responsavelId ?? "");
    setJustificativa(existente?.justificativa ?? novo?.justificativa ?? "");
    setPrazo(existente?.prazoResolucao ?? novo?.prazoResolucao ?? "");
    setRegularizadaEm(existente?.regularizadaEm ?? "");
  }, [aberto, existente, novo]);

  const titulo = existente?.titulo ?? novo?.titulo ?? "";
  const nomeResponsavel = pessoas.find((p) => p.id === responsavelId)?.nome ?? existente?.responsavelNome ?? null;
  // Justificar ou regularizar exige dizer o porquê: a divergência não some sem análise registrada.
  const exigeJustificativa = status === "justificada" || status === "regularizada";
  const invalido = exigeJustificativa && justificativa.trim().length < 5;
  const ocupado = criar.isPending || atualizar.isPending;

  async function salvar() {
    if (invalido) { toast.error("Informe a justificativa para justificar ou regularizar a divergência."); return; }
    try {
      if (existente) {
        await atualizar.mutateAsync({ id: existente.id, campos: { status, responsavelId: responsavelId || null, responsavelNome: nomeResponsavel, justificativa: justificativa.trim() || null, prazoResolucao: prazo || null, regularizadaEm: regularizadaEm || hojeIso() } });
        toast.success("Tratativa atualizada.");
      } else if (novo) {
        await criar.mutateAsync({ ...novo, status, responsavelId: responsavelId || null, responsavelNome: nomeResponsavel, justificativa: justificativa.trim() || null, prazoResolucao: prazo || null });
        toast.success("Tratativa registrada.");
      }
      onClose();
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message; // erro do Supabase é objeto simples, não Error
      toast.error(typeof msg === "string" && msg ? msg : "Não foi possível salvar a tratativa.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existente ? "Tratativa da divergência" : "Registrar tratativa"}</DialogTitle>
          <DialogDescription>{titulo}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Responsável pela análise</Label>
            <Select value={responsavelId || TODOS} onValueChange={(v) => setResponsavelId(v === TODOS ? "" : v)} disabled={!podeAlterar}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent className="max-h-72"><SelectItem value={TODOS}>Sem responsável</SelectItem>{pessoas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Situação</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusTratativa)} disabled={!podeAlterar}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_TRATATIVA.map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS_TRATATIVA[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prazo de resolução</Label>
            <Input type="date" className="h-9" value={prazo} onChange={(e) => setPrazo(e.target.value)} disabled={!podeAlterar} />
          </div>
          {status === "regularizada" && (
            <div className="space-y-1">
              <Label className="text-xs">Data da regularização</Label>
              <Input type="date" className="h-9" value={regularizadaEm || hojeIso()} onChange={(e) => setRegularizadaEm(e.target.value)} disabled={!podeAlterar} />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Justificativa{exigeJustificativa ? " *" : ""}</Label>
            <Textarea rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} disabled={!podeAlterar} placeholder="O que explica a diferença e o que foi (ou será) feito para corrigir" />
          </div>
          {existente && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Identificada em {dataBR(existente.identificadaEm)} · diferença de {fmtMoney(existente.valorDiferenca)}
              {existente.tipoDivergencia ? ` · ${ROTULO_TIPO_DIVERGENCIA[existente.tipoDivergencia]}` : ""}
            </p>
          )}
        </div>
        {existente && (
          <div className="space-y-1">
            <p className="text-xs font-semibold">Histórico de alterações</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
              {historico.length === 0 && <li className="text-muted-foreground">Sem alterações registradas.</li>}
              {historico.map((h) => <li key={h.id}><span className="text-muted-foreground">{new Date(h.criadoEm).toLocaleString("pt-BR")} · {h.autorNome ?? "—"}:</span> {textoHistorico(h)}</li>)}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {podeAlterar && <Button onClick={salvar} disabled={ocupado || invalido}>{ocupado ? "Salvando..." : existente ? "Salvar alterações" : "Registrar tratativa"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de tratativas com filtros e o resumo (abertas, vencidas, valor sob investigação). */
export function AbaTratativas({ tratativas, podeAlterar, onAbrir }: { tratativas: Tratativa[]; podeAlterar: boolean; onAbrir: (t: Tratativa) => void }) {
  const hoje = hojeIso();
  const [status, setStatus] = useState<StatusTratativa | typeof TODOS>(TODOS);
  const [responsavel, setResponsavel] = useState(TODOS);
  const [soVencidas, setSoVencidas] = useState(false);
  const [busca, setBusca] = useState("");
  const resumo = useMemo(() => resumoTratativas(tratativas, hoje), [tratativas, hoje]);
  const responsaveis = useMemo(() => [...new Set(tratativas.map((t) => t.responsavelNome).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "pt-BR")), [tratativas]);
  const lista = tratativas.filter((t) =>
    (status === TODOS || t.status === status) && (responsavel === TODOS || t.responsavelNome === responsavel) && (!soVencidas || vencida(t, hoje))
    && (!busca.trim() || `${t.titulo} ${t.justificativa ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase())));
  void podeAlterar;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile info={INFO_KPI.tratEmAberto} label="Em aberto" valor={String(resumo.porStatus.aberta + resumo.porStatus.em_analise)} sub={`${resumo.porStatus.aberta} abertas · ${resumo.porStatus.em_analise} em análise`} cor="amber" icon={<ClipboardList className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.vencidas} label="Vencidas" valor={String(resumo.vencidas)} sub="Prazo de resolução já passou" cor={resumo.vencidas ? "red" : "emerald"} icon={<AlertTriangle className="h-14 w-14" />} onClick={() => setSoVencidas(true)} />
        <KpiTile info={INFO_KPI.valorInvestigacao} label="Valor sob investigação" valor={fmtMoney(resumo.valorSobInvestigacao)} sub="Diferença das tratativas em aberto" cor="sky" icon={<Wallet className="h-14 w-14" />} />
        <KpiTile info={INFO_KPI.tratEncerradas} label="Encerradas" valor={String(resumo.porStatus.justificada + resumo.porStatus.regularizada)} sub={`${resumo.porStatus.regularizada} regularizadas · ${resumo.porStatus.justificada} justificadas`} cor="emerald" icon={<CheckCircle2 className="h-14 w-14" />} />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Situação</div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusTratativa | typeof TODOS)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todas</SelectItem>{STATUS_TRATATIVA.map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS_TRATATIVA[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Responsável</div>
          <Select value={responsavel} onValueChange={setResponsavel}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem>{responsaveis.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na descrição ou justificativa" className="h-8 w-64 text-xs" />
        <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={soVencidas} onChange={(e) => setSoVencidas(e.target.checked)} />Só vencidas</label>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead><TituloComFormula alinhar="left" titulo="Divergência" formula={INFO_COL.trDivergencia} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Competência" formula={INFO_COL.competencia} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Tipo" formula={INFO_COL.trTipo} /></TableHead>
                <TableHead className="text-right"><TituloComFormula titulo="Diferença" formula={INFO_COL.trDiferenca} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Responsável" formula={INFO_COL.trResponsavel} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Situação" formula={INFO_COL.trSituacao} /></TableHead>
                <TableHead><TituloComFormula alinhar="left" titulo="Identificada" formula={INFO_COL.trIdentificada} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Prazo" formula={INFO_COL.trPrazo} /></TableHead><TableHead><TituloComFormula alinhar="left" titulo="Regularizada" formula={INFO_COL.trRegularizada} /></TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.length === 0 && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">{tratativas.length === 0 ? "Nenhuma tratativa registrada. Use “Tratar” numa NF divergente (aba Por Nota Fiscal)." : "Nenhuma tratativa neste filtro."}</TableCell></TableRow>}
              {lista.slice(0, 300).map((t) => (
                <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onAbrir(t)}>
                  <TableCell className="max-w-[320px] truncate font-medium" title={t.titulo}>{t.titulo}</TableCell>
                  <TableCell className="whitespace-nowrap">{mesLabel(t.competencia)}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.tipoDivergencia ? ROTULO_TIPO_DIVERGENCIA[t.tipoDivergencia] : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{fmtMoney(t.valorDiferenca)}</TableCell>
                  <TableCell className="whitespace-nowrap">{t.responsavelNome ?? "—"}</TableCell>
                  <TableCell><StatusTratativaPill status={t.status} /></TableCell>
                  <TableCell className="whitespace-nowrap">{dataBR(t.identificadaEm)}</TableCell>
                  <TableCell className={`whitespace-nowrap ${vencida(t, hoje) ? "font-semibold text-red-600" : ""}`}>{dataBR(t.prazoResolucao)}{emAberto(t) && vencida(t, hoje) ? " ⚠" : ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{dataBR(t.regularizadaEm)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
