import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, ClipboardCheck, Construction, FileText, History, Landmark, PiggyBank, RotateCcw, Settings2, Siren, Target, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/context/PermissoesContext";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useUsuariosAtivos } from "@/hooks/useNfEmissao";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { rotuloMes } from "./faturamento/useBaseFaturamento";
import {
  DefValidacao, diferenca, STATUS_LABEL, statusGeral, situacaoComparacao, TipoValidacao, valoresMudaramDesdeDecisao, VALIDACOES,
} from "./auditoria/regras";
import { EstadoCard, useTotaisAuditoria } from "./auditoria/useTotaisAuditoria";
import {
  HistoricoRow, useHistoricoPeriodo, useRegistrarAuditoria, useResponsaveisAuditoria, useSalvarResponsaveis, useValidacoesPeriodo, ValidacaoRow,
} from "./auditoria/useAuditoriaValidacoes";

// SIS-2026-0553: Painel de Auditoria da Controladoria. A Controladoria NÃO
// confere lançamento a lançamento: vê os totais consolidados de 7 validações e
// aprova ou rejeita. Rejeição exige justificativa e sinaliza o responsável.
// Aprovação vale por período + empresa — contrato só refina a visualização.
// Centro de custo ainda não é filtro: não há vínculo no banco entre centro de
// custo e Malote/contrato.

const TODOS = "todos";
const MENU = "auditoria-controladoria";
const kpi = (v: number | undefined) => (v === undefined ? "Calculando..." : fmtMoney(v));
const pctTxt = (p: number | null) => (p === null ? "—" : `${(p * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const fmtDataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function mesesRecentes(): string[] {
  const hoje = new Date();
  return Array.from({ length: 18 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

type Dialogo = { tipo: "rejeitar" | "solicitar_revisao"; def: DefValidacao } | null;

export default function AuditoriaControladoria() {
  const { can } = usePermissoes();
  const podeAprovar = can("aprovar", "controladoria", MENU);
  const podeAlterar = can("alterar", "controladoria", MENU);

  const [mes, setMes] = useState(() => mesesRecentes()[1]); // mês fechado mais recente
  const [empresaId, setEmpresaId] = useState(TODOS);
  const [contratoId, setContratoId] = useState(TODOS);

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });

  const empresa = empresaId === TODOS ? null : empresaId;
  const filtros = useMemo(
    () => ({ mes, empresaId: empresa, contratoId: contratoId === TODOS ? null : contratoId }),
    [mes, empresa, contratoId]
  );
  // Aprovar/rejeitar só com o recorte completo do período + empresa.
  const recorteParcial = !!filtros.contratoId;

  const totais = useTotaisAuditoria(filtros);
  const { data: validacoes = [] } = useValidacoesPeriodo(mes, empresa);
  const porTipo = useMemo(() => new Map<string, ValidacaoRow>(validacoes.map((v) => [v.tipo, v])), [validacoes]);
  const geral = statusGeral(validacoes);

  const registrar = useRegistrarAuditoria();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [texto, setTexto] = useState("");
  const [obsGeral, setObsGeral] = useState("");
  const [verHistorico, setVerHistorico] = useState(false);
  const [verResponsaveis, setVerResponsaveis] = useState(false);
  const historicoQ = useHistoricoPeriodo(mes, empresa, verHistorico);

  async function executar(acao: "aprovar" | "reabrir", def: DefValidacao) {
    const t = totais[def.tipo].totais;
    try {
      await registrar.mutateAsync({ mes, empresaId: empresa, tipo: def.tipo, acao, valores: t ? { a: t.a, b: t.b } : null });
      toast.success(acao === "aprovar" ? "Validação aprovada." : "Validação reaberta.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar.");
    }
  }

  async function confirmarDialogo() {
    if (!dialogo) return;
    const t = totais[dialogo.def.tipo].totais;
    try {
      await registrar.mutateAsync({ mes, empresaId: empresa, tipo: dialogo.def.tipo, acao: dialogo.tipo, justificativa: texto, valores: t ? { a: t.a, b: t.b } : null });
      toast.success(dialogo.tipo === "rejeitar" ? "Rejeitado — o responsável foi sinalizado." : "Revisão solicitada — o responsável foi sinalizado.");
      setDialogo(null);
      setTexto("");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar.");
    }
  }

  async function salvarObservacao() {
    try {
      await registrar.mutateAsync({ mes, empresaId: empresa, tipo: null, acao: "observacao", observacao: obsGeral });
      setObsGeral("");
      toast.success("Observação registrada no histórico.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar.");
    }
  }

  const donut = [
    { nome: "Aprovadas", valor: geral.aprovadas, cor: "#16a34a" },
    { nome: "Pendentes", valor: geral.pendentes, cor: "#f59e0b" },
    { nome: "Rejeitadas", valor: geral.rejeitadas, cor: "#dc2626" },
  ];
  const resumo = (tipo: TipoValidacao) => totais[tipo].totais;

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Auditoria da Controladoria"]}
        title="Aprovação de Informações para Lucratividade"
        subtitle="Valide os montantes consolidados para que os dados sigam para a geração dos relatórios de lucratividade."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setVerHistorico(true)}><History className="h-4 w-4 mr-1" />Histórico</Button>
            {podeAlterar && <Button variant="outline" size="sm" onClick={() => setVerResponsaveis(true)}><Settings2 className="h-4 w-4 mr-1" />Responsáveis</Button>}
          </div>
        }
      />

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{mesesRecentes().map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratoId(TODOS); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={contratoId} onValueChange={setContratoId}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue placeholder="Contrato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os contratos</SelectItem>
            {contratos.filter((c) => !empresa || c.empresa_id === empresa).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEmpresaId(TODOS); setContratoId(TODOS); }}>Limpar filtros</Button>
      </div>

      {recorteParcial && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Com filtro de contrato você vê um recorte. Aprovar e rejeitar valem para o período inteiro da empresa — limpe o filtro para decidir.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiTile label="Total do Malote (período)" valor={kpi(resumo("malote_fluxo")?.a)} icon={<FileText />} cor="sky" />
        <KpiTile label="Total do Fluxo de Caixa" valor={kpi(resumo("fluxo_extrato")?.a)} icon={<Banknote />} cor="emerald" />
        <KpiTile label="Total conciliado no Extrato" valor={resumo("fluxo_extrato")?.indisponivel ? "—" : kpi(resumo("fluxo_extrato")?.b)} sub={resumo("fluxo_extrato")?.indisponivel ? "Sem conciliação salva no mês" : undefined} icon={<Landmark />} cor="amber" />
        <KpiTile label="Gastos por Centro de Custo" valor={kpi(resumo("centros_malote")?.b)} sub="Contratos + administrativo" icon={<PiggyBank />} cor="slate" />
        <KpiTile label="Total Orçado" valor={kpi(resumo("orcado_realizado")?.a)} icon={<Target />} cor="sky" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {VALIDACOES.map((def) => (
          <CardValidacao
            key={def.tipo}
            def={def}
            estado={totais[def.tipo]}
            validacao={porTipo.get(def.tipo)}
            podeAprovar={podeAprovar && !recorteParcial}
            podeRevisar={podeAlterar}
            ocupado={registrar.isPending}
            onAprovar={() => executar("aprovar", def)}
            onReabrir={() => executar("reabrir", def)}
            onRejeitar={() => { setTexto(""); setDialogo({ tipo: "rejeitar", def }); }}
            onRevisao={() => { setTexto(""); setDialogo({ tipo: "solicitar_revisao", def }); }}
            className={def.tipo === "descontos" ? "lg:col-span-2" : undefined}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Status Geral das Aprovações — {rotuloMes(mes)}</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-6">
            <div className="relative w-[150px] h-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut.filter((d) => d.valor > 0).length ? donut : [{ nome: "—", valor: 1, cor: "#e2e8f0" }]} dataKey="valor" nameKey="nome" innerRadius={46} outerRadius={70} paddingAngle={2}>
                    {(donut.filter((d) => d.valor > 0).length ? donut : [{ cor: "#e2e8f0" }]).map((d, i) => <Cell key={i} fill={d.cor} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold">{geral.total}</span>
                <span className="text-[10px] text-muted-foreground">Validações</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm flex-1">
              {donut.map((d) => (
                <li key={d.nome} className="flex items-center gap-2">
                  <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.cor }} />
                  <span className="flex-1">{d.nome}</span>
                  <span className="font-semibold">{d.valor}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{Math.round((d.valor / geral.total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Evolução das Aprovações</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
            <Construction className="h-6 w-6" />
            <p className="text-sm font-medium">Em desenvolvimento</p>
            <p className="text-xs">O acompanhamento das aprovações ao longo dos dias entra numa próxima versão.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Observações da Controladoria</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setVerHistorico(true)}>Ver histórico →</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea value={obsGeral} onChange={(e) => setObsGeral(e.target.value)} placeholder="Registre observações sobre as conciliações e aprovações..." rows={4} disabled={!podeAlterar} />
            <div className="flex justify-end">
              <Button size="sm" disabled={!podeAlterar || !obsGeral.trim() || registrar.isPending} onClick={salvarObservacao}>Salvar observação</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!dialogo} onOpenChange={(o) => !o && setDialogo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogo?.tipo === "rejeitar" ? "Rejeitar validação" : "Solicitar revisão"}</DialogTitle>
            <DialogDescription>
              {dialogo?.def.titulo} — {rotuloMes(mes)}. {dialogo?.tipo === "rejeitar" ? "A justificativa é obrigatória e é enviada ao responsável pela correção." : "O responsável é sinalizado; o status da validação não muda."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva o que precisa ser corrigido (mínimo 5 caracteres)" rows={4} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogo(null)}>Cancelar</Button>
            <Button variant={dialogo?.tipo === "rejeitar" ? "destructive" : "default"} disabled={texto.trim().length < 5 || registrar.isPending} onClick={confirmarDialogo}>
              {dialogo?.tipo === "rejeitar" ? "Rejeitar" : "Solicitar revisão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={verHistorico} onOpenChange={setVerHistorico}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico das validações — {rotuloMes(mes)}</DialogTitle>
            <DialogDescription>Tudo o que foi aprovado, rejeitado, reaberto ou comentado neste período e empresa.</DialogDescription>
          </DialogHeader>
          <ListaHistorico linhas={historicoQ.data ?? []} carregando={historicoQ.isLoading} />
        </DialogContent>
      </Dialog>

      {verResponsaveis && <DialogResponsaveis onClose={() => setVerResponsaveis(false)} />}
    </div>
  );
}

function CardValidacao(props: {
  def: DefValidacao;
  estado: EstadoCard;
  validacao?: ValidacaoRow;
  podeAprovar: boolean;
  podeRevisar: boolean;
  ocupado: boolean;
  onAprovar: () => void;
  onReabrir: () => void;
  onRejeitar: () => void;
  onRevisao: () => void;
  className?: string;
}) {
  const { def, estado, validacao } = props;
  const status = validacao?.status ?? "pendente";
  const t = estado.totais;
  const indisponivel = t?.indisponivel;
  const dif = t && !indisponivel ? diferenca(t) : null;
  const situacao = t && !indisponivel ? situacaoComparacao(def, t) : null;
  const mudou = status === "aprovado" && t ? valoresMudaramDesdeDecisao(validacao?.valores, t) : false;

  return (
    <Card className={cn("flex flex-col", props.className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          <span className="h-6 w-6 shrink-0 rounded bg-slate-900 text-white text-xs font-bold flex items-center justify-center dark:bg-slate-100 dark:text-slate-900">{def.numero}</span>
          <CardTitle className="text-sm font-semibold leading-snug flex-1">{def.titulo}</CardTitle>
          <Link to={def.link} className="text-[11px] text-primary whitespace-nowrap hover:underline inline-flex items-center gap-0.5">
            {def.linkRotulo}<ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {estado.erro ? (
          <p className="text-xs text-red-600">Não foi possível calcular: {estado.erro}</p>
        ) : estado.carregando || !t ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Calculando...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className="text-base font-bold">{fmtMoney(t.a)}</p><p className="text-[11px] text-muted-foreground">{def.rotuloA}</p></div>
              <div><p className="text-base font-bold">{indisponivel ? "—" : fmtMoney(t.b)}</p><p className="text-[11px] text-muted-foreground">{def.rotuloB}</p></div>
            </div>
            {indisponivel && (
              <p className="text-xs rounded-md border border-dashed border-amber-400 bg-amber-50 text-amber-800 p-2 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800 flex gap-1.5">
                <Construction className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{indisponivel}</span>
              </p>
            )}
            {!indisponivel && <ResponsiveContainer width="100%" height={70}>
              <BarChart data={[{ n: def.rotuloA, v: Math.abs(t.a) }, { n: def.rotuloB, v: Math.abs(t.b) }]} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="n" hide />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="v" radius={[0, 3, 3, 0]}>
                  <Cell fill="#1e40af" /><Cell fill="#7dd3fc" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>}
            {!indisponivel && <p className={cn("text-xs text-center", situacao === "diverge" && "text-red-600 font-medium", situacao === "confere" && "text-emerald-600 font-medium")}>
              {situacao === "confere" ? "Totais conferem" : `Diferença: ${fmtMoney(dif!.valor)} (${pctTxt(dif!.percentual)})`}
            </p>}
            {t.detalhes && (
              <ul className="text-xs space-y-0.5 border rounded-md p-2">
                {t.detalhes.map((d) => (
                  <li key={d.rotulo} className={cn("flex justify-between", d.somaNoTotal === false && "text-muted-foreground")}>
                    <span>{d.rotulo}</span><span className="font-medium">{fmtMoney(d.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.aviso && <p className="text-[11px] text-muted-foreground">{t.aviso}</p>}
          </>
        )}

        <div className="mt-auto space-y-2">
          <BlocoStatus status={status} validacao={validacao} mudou={mudou} />
          <div className="grid grid-cols-2 gap-2">
            {status === "aprovado" ? (
              <Button size="sm" variant="outline" disabled={!props.podeAprovar || props.ocupado} onClick={props.onReabrir}><RotateCcw className="h-3.5 w-3.5 mr-1" />Reabrir</Button>
            ) : (
              <Button size="sm" disabled={!props.podeAprovar || props.ocupado || !t || !!indisponivel} onClick={props.onAprovar}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Aprovar</Button>
            )}
            <Button size="sm" variant="outline" disabled={!props.podeAprovar || props.ocupado || !t || !!indisponivel || status === "rejeitado"} onClick={props.onRejeitar}><XCircle className="h-3.5 w-3.5 mr-1" />Rejeitar</Button>
          </div>
          {props.podeRevisar && (
            <Button size="sm" variant="ghost" className="w-full h-7 text-xs" disabled={props.ocupado} onClick={props.onRevisao}><Siren className="h-3.5 w-3.5 mr-1" />Solicitar revisão ao responsável</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BlocoStatus({ status, validacao, mudou }: { status: "pendente" | "aprovado" | "rejeitado"; validacao?: ValidacaoRow; mudou: boolean }) {
  const estilos = {
    pendente: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
    aprovado: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
    rejeitado: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
  } as const;
  return (
    <div className={cn("rounded-md border p-2 text-xs", estilos[status])}>
      <p className="font-semibold">{STATUS_LABEL[status]}</p>
      {validacao?.decidido_em && status !== "pendente" && (
        <p className="opacity-80">em {fmtDataHora(validacao.decidido_em)} · por {validacao.decidido_por_nome ?? "—"}</p>
      )}
      {status === "rejeitado" && validacao?.justificativa && <p className="mt-1">“{validacao.justificativa}”</p>}
      {mudou && <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">⚠ Os valores mudaram desde a aprovação — valide de novo.</p>}
    </div>
  );
}

const ACAO_LABEL: Record<HistoricoRow["acao"], { texto: string; classe: string }> = {
  aprovado: { texto: "Aprovou", classe: "bg-emerald-100 text-emerald-800" },
  rejeitado: { texto: "Rejeitou", classe: "bg-red-100 text-red-800" },
  reaberto: { texto: "Reabriu", classe: "bg-slate-100 text-slate-700" },
  revisao_solicitada: { texto: "Pediu revisão", classe: "bg-amber-100 text-amber-800" },
  observacao: { texto: "Observação", classe: "bg-sky-100 text-sky-800" },
};

function ListaHistorico({ linhas, carregando }: { linhas: HistoricoRow[]; carregando: boolean }) {
  if (carregando) return <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>;
  if (linhas.length === 0) return <p className="text-sm text-muted-foreground py-6 text-center">Nenhum registro neste período.</p>;
  return (
    <ul className="space-y-2">
      {linhas.map((h) => {
        const def = VALIDACOES.find((v) => v.tipo === h.tipo);
        const a = ACAO_LABEL[h.acao];
        return (
          <li key={h.id} className="border rounded-md p-2.5 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn("border-0", a.classe)}>{a.texto}</Badge>
              <span className="font-medium">{def ? `${def.numero}. ${def.titulo}` : "Observação geral do período"}</span>
              <span className="text-xs text-muted-foreground ml-auto">{fmtDataHora(h.created_at)} · {h.user_nome ?? "—"}</span>
            </div>
            {(h.justificativa || h.observacao) && <p className="mt-1 text-xs text-muted-foreground">{h.justificativa ?? h.observacao}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function DialogResponsaveis({ onClose }: { onClose: () => void }) {
  const { data: usuarios = [] } = useUsuariosAtivos();
  const { data: responsaveis = [] } = useResponsaveisAuditoria();
  const salvar = useSalvarResponsaveis();
  const opcoes = useMemo(() => usuarios.map((u) => ({ value: u.id, label: u.display_name })), [usuarios]);
  const nomePorId = useMemo(() => new Map(usuarios.map((u) => [u.id, u.display_name])), [usuarios]);
  const atual = useMemo(() => new Map(responsaveis.map((r) => [r.tipo, r.user_ids])), [responsaveis]);

  async function mudar(tipo: TipoValidacao, ids: string[]) {
    try {
      await salvar.mutateAsync({ tipo, user_ids: ids, nomes: ids.map((i) => nomePorId.get(i) ?? "") });
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><ClipboardCheck className="inline h-4 w-4 mr-1" />Responsáveis por validação</DialogTitle>
          <DialogDescription>Quem recebe a notificação (com link para o módulo de origem) quando a Controladoria rejeita ou pede revisão.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {VALIDACOES.map((v) => (
            <div key={v.tipo} className="space-y-1">
              <p className="text-xs font-medium">{v.numero}. {v.titulo}</p>
              <SearchableMultiSelect value={atual.get(v.tipo) ?? []} onChange={(ids) => mudar(v.tipo, ids)} options={opcoes} placeholder="Selecione os responsáveis" searchPlaceholder="Buscar usuário..." maxBadges={4} />
            </div>
          ))}
        </div>
        <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
