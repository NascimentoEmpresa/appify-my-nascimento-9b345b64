import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as GraficoTooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, CalendarClock, ChevronDown, ChevronRight, Download, FileText, Mail, MoreVertical, RotateCcw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  agruparPorContrato, filtrarLinhas, FILTROS_VAZIOS, notasPorFaixa, ordenarLinhas, proximaAcao, recebidoDoMes, ROTULO_STATUS, rotuloFaixa, topContratos,
  totaisDe, valoresPorStatus, type ColunaOrdem, type FiltrosCobranca, type GrupoContrato, type LinhaCobranca, type RestricaoDias, type StatusCobranca, type TomAcao,
} from "./cobrancaNotas";
import { useCobrancaDados } from "./useCobrancaDados";

// SIS-2026-0653: tela Cobranças (notas em aberto) no formato do mockup do Financeiro. As notas vêm do Relatório de Serviços,
// a faixa e o prazo são os da cobrança automática, e "Próxima ação" / "Último e-mail" ligam a tela à automação.

const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmtData = (d: string) => new Date(d.length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("pt-BR");
const pct = (p: number | null) => (p === null ? "—" : `${(p * 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`);

const FAIXA_CHIP: Record<string, string> = {
  aviso: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  verde: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amarela: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  laranja: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  vermelha: "bg-red-500/15 text-red-700 dark:text-red-300",
  roxa: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  preta: "bg-neutral-800/15 text-neutral-900 dark:bg-neutral-200/15 dark:text-neutral-200",
};
const FAIXA_HEX: Record<string, string> = { verde: "#10b981", amarela: "#eab308", laranja: "#f97316", vermelha: "#ef4444", roxa: "#9333ea", preta: "#262626" };
const STATUS_CHIP: Record<StatusCobranca, string> = {
  a_vencer: "bg-amber-400/20 text-amber-800 dark:text-amber-300",
  em_atraso: "bg-red-500/15 text-red-700 dark:text-red-300",
  parcial: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelada: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const STATUS_HEX: Record<StatusCobranca, string> = { em_atraso: "#ef4444", a_vencer: "#3b82f6", parcial: "#22c55e", cancelada: "#94a3b8" };
const TOM_ACAO: Record<TomAcao, string> = {
  neutro: "text-muted-foreground",
  auto: "text-emerald-700 dark:text-emerald-400",
  juridico: "text-purple-700 dark:text-purple-300 font-medium",
  alerta: "text-foreground font-medium",
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold uppercase", className)}>{children}</span>;
}

function Kpi({ icone, cor, titulo, valor, sub, subCor }: { icone: React.ReactNode; cor: string; titulo: string; valor: string; sub?: React.ReactNode; subCor?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", cor)}>{icone}</span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{titulo}</p>
          <p className="truncate text-xl font-bold leading-tight">{valor}</p>
          {sub && <p className={cn("text-[11px] text-muted-foreground", subCor)}>{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function CabecalhoOrdenavel({ rotulo, coluna, ordem, desc, onOrdenar, className }: { rotulo: string; coluna: ColunaOrdem; ordem: ColunaOrdem; desc: boolean; onOrdenar: (c: ColunaOrdem) => void; className?: string }) {
  const ativa = ordem === coluna;
  const Icone = !ativa ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <th className={cn("px-2 py-2 font-medium", className)}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onOrdenar(coluna)}>
        {rotulo}<Icone className={cn("h-3 w-3", !ativa && "opacity-40")} />
      </button>
    </th>
  );
}

export default function NotasAbertoTab() {
  const { can } = usePermissoes();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { carregando, nfsParaRecebido, empresas, linhas, planoPorContrato, modoAuto, automacaoIndisponivel, ultimoEnvio } = useCobrancaDados();

  // Mesma regra de visibilidade do sistema antigo, por Acesso por Usuário: "alterar" vê tudo; "aprovar" (Jurídico) só o que está há
  // mais de 30 dias em atraso; "visualizar" (Comercial) há mais de 60. Sem nenhuma marcação específica, vê tudo.
  const podeVerTudo = can("alterar", undefined, "cobrancas");
  const restricao: RestricaoDias = podeVerTudo ? 0 : can("aprovar", undefined, "cobrancas") ? 30 : can("visualizar", undefined, "cobrancas") ? 60 : 0;
  const podeMarcarManual = podeVerTudo || can("aprovar", undefined, "cobrancas");

  const [rascunho, setRascunho] = useState<FiltrosCobranca>(FILTROS_VAZIOS);
  const [filtros, setFiltros] = useState<FiltrosCobranca>(FILTROS_VAZIOS);
  const [modo, setModo] = useState<"contrato" | "nota">("contrato");
  const [ordem, setOrdem] = useState<ColunaOrdem>("dias");
  const [desc, setDesc] = useState(true);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [previa, setPrevia] = useState<{ contrato: string; assunto: string; corpo: string; para: string[]; cc: string[] } | null>(null);

  const visiveis = useMemo(() => filtrarLinhas(linhas, filtros, restricao), [linhas, filtros, restricao]);
  const totais = useMemo(() => totaisDe(visiveis), [visiveis]);
  const porStatus = useMemo(() => valoresPorStatus(visiveis), [visiveis]);
  const porFaixa = useMemo(() => notasPorFaixa(visiveis), [visiveis]);
  const top = useMemo(() => topContratos(visiveis, 5), [visiveis]);
  const mesAtual = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const recebido = useMemo(() => recebidoDoMes(nfsParaRecebido, mesAtual, { empresaId: filtros.empresaId || undefined, contratoId: filtros.contratoId || undefined }), [nfsParaRecebido, mesAtual, filtros.empresaId, filtros.contratoId]);

  // Filtrar por contrato (20/10/2026, chamado "conferência gerencial por
  // contrato"): pesquisável pelo nome e SÓ com os contratos da empresa
  // escolhida — antes era uma lista fixa com os contratos de todas as
  // empresas. Cada opção diz quantas notas e quanto está em aberto, com a
  // mesma régua de visibilidade da tabela (restricao), para o número da
  // opção bater com o que aparece ao filtrar.
  const opcoesContrato = useMemo(() => {
    const base = filtrarLinhas(linhas, { ...FILTROS_VAZIOS, empresaId: rascunho.empresaId }, restricao);
    const m = new Map<string, { nome: string; notas: number; valor: number }>();
    for (const l of base) {
      const c = m.get(l.contratoId) ?? { nome: l.contrato, notas: 0, valor: 0 };
      c.notas += 1; c.valor += l.valor;
      m.set(l.contratoId, c);
    }
    return [...m.entries()]
      .sort((a, b) => a[1].nome.localeCompare(b[1].nome, "pt-BR"))
      .map(([id, c]) => ({ value: id, label: c.nome, hint: `${c.notas} nota(s) · ${fmtMoney(c.valor)}` }));
  }, [linhas, rascunho.empresaId, restricao]);
  const nomeContratoFiltrado = filtros.contratoId ? (linhas.find((l) => l.contratoId === filtros.contratoId)?.contrato ?? "") : "";

  /** Escolher o contrato já aplica (é a conferência de um contrato só); "" volta à visão geral. */
  const filtrarContrato = (contratoId: string) => {
    setRascunho((r) => ({ ...r, contratoId }));
    setFiltros((f) => ({ ...f, contratoId }));
    setPagina(1); setSelecionadas(new Set());
  };

  const ordenar = (c: ColunaOrdem) => {
    if (ordem === c) setDesc(!desc);
    else { setOrdem(c); setDesc(c === "dias" || c === "valor" || c === "status"); }
    setPagina(1);
  };

  const ordenadas = useMemo(() => ordenarLinhas(visiveis, ordem, desc), [visiveis, ordem, desc]);
  const grupos = useMemo(() => {
    const g = agruparPorContrato(ordenadas);
    const chave = (x: GrupoContrato): number | string => (ordem === "contrato" ? x.contrato.toLowerCase() : ordem === "empresa" ? x.empresaCodigo : ordem === "valor" ? x.total : ordem === "dias" ? x.diasMax : 0);
    if (["contrato", "empresa", "valor", "dias"].includes(ordem)) {
      g.sort((a, b) => {
        const x = chave(a), y = chave(b);
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
        return desc ? -c : c;
      });
    }
    return g;
  }, [ordenadas, ordem, desc]);

  const totalItens = modo === "contrato" ? grupos.length : ordenadas.length;
  const totalPaginas = Math.max(1, Math.ceil(totalItens / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const fatia = <T,>(lista: T[]) => lista.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);

  const aplicar = () => { setFiltros(rascunho); setPagina(1); setSelecionadas(new Set()); };
  const limpar = () => { setRascunho(FILTROS_VAZIOS); setFiltros(FILTROS_VAZIOS); setPagina(1); setSelecionadas(new Set()); };

  // Seleção: só notas de um contrato por vez (mesma regra do sistema antigo).
  const contratoSelecionado = useMemo(() => {
    const id = [...selecionadas][0];
    return id ? linhas.find((l) => l.id === id)?.contratoId ?? null : null;
  }, [selecionadas, linhas]);
  const alternarNota = (l: LinhaCobranca) => setSelecionadas((prev) => {
    const prox = new Set(prev);
    if (prox.has(l.id)) { prox.delete(l.id); return prox; }
    if (contratoSelecionado && contratoSelecionado !== l.contratoId) return new Set([l.id]);
    prox.add(l.id);
    return prox;
  });
  const alternarGrupo = (g: GrupoContrato) => setSelecionadas((prev) => {
    const ids = g.linhas.filter((l) => l.status !== "cancelada").map((l) => l.id);
    const todas = ids.length > 0 && ids.every((i) => prev.has(i));
    return todas ? new Set() : new Set(ids);
  });
  const selecionadasLinhas = useMemo(() => linhas.filter((l) => selecionadas.has(l.id)), [linhas, selecionadas]);

  async function abrirPrevia(contratoId: string, contrato: string) {
    const { data, error } = await supabase.functions.invoke("cobranca-automatica", { body: { acao: "previa", contrato_id: contratoId } });
    if (error || !data?.ok) { toast.error(data?.error ?? "Não foi possível montar a prévia do e-mail."); return; }
    setPrevia({ contrato, assunto: data.assunto, corpo: data.corpo, para: data.para, cc: data.cc });
  }

  async function alternarManual(contratoId: string, manual: boolean) {
    const t = (supabase as any).from("cobranca_auto_contrato_manual");
    const { error } = manual ? await t.upsert({ contrato_id: contratoId, motivo: "Marcado na tela de Cobranças" }) : await t.delete().eq("contrato_id", contratoId);
    if (error) { toast.error(`Não foi possível alterar: ${error.message}`); return; }
    qc.invalidateQueries({ queryKey: ["cobranca-auto-simulacao"] });
    toast.success(manual ? "Contrato passou para cobrança só manual." : "Contrato voltou ao automático.");
  }

  const verNoRelatorio = (l: LinhaCobranca) => navigate(`/app/financeiro/relatorio-servicos?${new URLSearchParams({ empresa: l.empresaId, contrato: l.contratoId, competencia: l.competencia.slice(0, 7) + "-01" }).toString()}`);

  function exportar() {
    const linhasXlsx = ordenadas.map((l) => ({
      Emissão: fmtData(l.dataEmissao),
      "Nº Nota": l.numero,
      Contrato: l.contrato,
      Empresa: l.empresaCodigo,
      "Valor em aberto": l.valor,
      Dias: l.dias,
      "Dias de atraso": Math.max(0, l.atraso),
      Faixa: rotuloFaixa(l.faixa),
      Status: ROTULO_STATUS[l.status],
      "Último e-mail": ultimoEnvio.get(l.contratoId) ? fmtData(ultimoEnvio.get(l.contratoId) as string) : "",
      "Próxima ação": proximaAcao(l, planoPorContrato.get(l.contratoId), modoAuto).texto,
    }));
    const ws = XLSX.utils.json_to_sheet(linhasXlsx);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cobranças");
    XLSX.writeFile(wb, `cobrancas-${new Date().toLocaleDateString("sv-SE")}.xlsx`);
  }

  const celulaAcoes = (l: LinhaCobranca) => {
    const acao = proximaAcao(l, planoPorContrato.get(l.contratoId), modoAuto);
    const manual = planoPorContrato.get(l.contratoId)?.decisao === "manual";
    return (
      <div className="flex items-center justify-end gap-0.5">
        {acao.tom !== "juridico" && l.status !== "cancelada" && l.faixa !== null && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Ver prévia do e-mail (não envia)" onClick={() => abrirPrevia(l.contratoId, l.contrato)}><Mail className="h-3.5 w-3.5" /></Button>
        )}
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Ver a nota no Relatório de Serviços" onClick={() => verNoRelatorio(l)}><FileText className="h-3.5 w-3.5" /></Button>
        {podeMarcarManual && acao.tom !== "juridico" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Mais ações"><MoreVertical className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => alternarManual(l.contratoId, !manual)}>{manual ? "Voltar o contrato ao automático" : "Passar o contrato para cobrança só manual"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  const linhaNota = (l: LinhaCobranca, opcoes: { recuo?: boolean; totalContrato?: number }) => {
    const acao = proximaAcao(l, planoPorContrato.get(l.contratoId), modoAuto);
    const bloqueada = contratoSelecionado !== null && contratoSelecionado !== l.contratoId;
    return (
      <tr key={l.id} className={cn("border-t hover:bg-muted/30", bloqueada && "opacity-50")}>
        <td className="px-2 py-1.5"><Checkbox checked={selecionadas.has(l.id)} disabled={l.status === "cancelada"} onCheckedChange={() => alternarNota(l)} /></td>
        <td className={cn("px-2 py-1.5 whitespace-nowrap", opcoes.recuo && "pl-6")}>{fmtData(l.dataEmissao)}</td>
        <td className="px-2 py-1.5">{l.numero}</td>
        <td className="max-w-[240px] truncate px-2 py-1.5" title={l.contrato}>{l.contrato}</td>
        <td className="px-2 py-1.5">{l.empresaCodigo}</td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtMoney(l.valor)}</td>
        {opcoes.totalContrato !== undefined && <td className="px-2 py-1.5 text-right whitespace-nowrap text-muted-foreground">{fmtMoney(opcoes.totalContrato)}</td>}
        <td className="px-2 py-1.5 text-right">{l.dias}</td>
        <td className="px-2 py-1.5">{l.faixa ? <Chip className={FAIXA_CHIP[l.faixa]}>{rotuloFaixa(l.faixa)}</Chip> : <span className="text-muted-foreground">No prazo</span>}</td>
        <td className="px-2 py-1.5"><Chip className={STATUS_CHIP[l.status]}>{ROTULO_STATUS[l.status]}</Chip></td>
        <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{ultimoEnvio.get(l.contratoId) ? fmtData(ultimoEnvio.get(l.contratoId) as string) : "-"}</td>
        <td className={cn("px-2 py-1.5", TOM_ACAO[acao.tom])}>{acao.texto}</td>
        <td className="px-2 py-1.5">{celulaAcoes(l)}</td>
      </tr>
    );
  };

  const totalPorContrato = useMemo(() => new Map(grupos.map((g) => [g.contratoId, g.total])), [grupos]);
  const colunasFlat = 13;

  const cab = { ordem, desc, onOrdenar: ordenar };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {automacaoIndisponivel ? <p className="text-xs text-amber-600 dark:text-amber-400">A "Próxima ação" automática ainda não está disponível neste ambiente.</p> : <span />}
        <Button variant="outline" size="sm" onClick={exportar} disabled={ordenadas.length === 0}><Download className="mr-1.5 h-4 w-4" />Exportar</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icone={<Wallet className="h-6 w-6" />} cor="bg-sky-100 text-sky-600 dark:bg-sky-950/40" titulo="Total geral" valor={fmtMoney(totais.totalGeral)} sub="Notas em aberto" />
        <Kpi icone={<TrendingDown className="h-6 w-6" />} cor="bg-red-100 text-red-600 dark:bg-red-950/40" titulo="Total em atraso" valor={fmtMoney(totais.atraso)} sub={`${pct(totais.pctAtraso)} do total`} subCor="text-red-600" />
        <Kpi icone={<Bell className="h-6 w-6" />} cor="bg-rose-100 text-rose-600 dark:bg-rose-950/40" titulo="Notas vencidas" valor={String(totais.qtdAtraso)} sub={`de ${totais.qtdNotas} notas`} />
        <Kpi icone={<CalendarClock className="h-6 w-6" />} cor="bg-blue-100 text-blue-600 dark:bg-blue-950/40" titulo="A vencer (até 30 dias)" valor={fmtMoney(totais.aVencer)} sub={`${totais.qtdAVencer} notas`} />
        <Kpi
          icone={<TrendingUp className="h-6 w-6" />} cor="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40" titulo="Valor recebido (mês)" valor={fmtMoney(recebido.valor)}
          sub={recebido.variacao === null ? "sem base no mês anterior" : `${recebido.variacao >= 0 ? "+" : ""}${pct(recebido.variacao)} em relação ao mês anterior`} subCor={recebido.variacao !== null && recebido.variacao < 0 ? "text-red-600" : "text-emerald-600"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-semibold">Valores por status</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={porStatus} margin={{ top: 18, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval={0} />
                <YAxis hide />
                <GraficoTooltip formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="valor" radius={[3, 3, 0, 0]} label={{ position: "top", fontSize: 10, formatter: (v: number) => fmtMoney(v) }}>
                  {porStatus.map((s) => <Cell key={s.status} fill={STATUS_HEX[s.status]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-semibold">Notas por faixa de atraso</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-3">
            <div className="relative h-[170px] w-[170px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={porFaixa} dataKey="qtd" nameKey="faixa" innerRadius={50} outerRadius={78} paddingAngle={1} stroke="none">
                    {porFaixa.map((f) => <Cell key={f.faixa} fill={FAIXA_HEX[f.faixa]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold leading-none">{totais.qtdAtraso}</span>
                <span className="text-[10px] text-muted-foreground">notas vencidas</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 text-[11px]">
              {porFaixa.length === 0 && <li className="text-muted-foreground">Nenhuma nota vencida.</li>}
              {porFaixa.map((f) => (
                <li key={f.faixa} className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FAIXA_HEX[f.faixa] }} />
                  <span className="flex-1 truncate">{rotuloFaixa(f.faixa)} ({f.qtd})</span>
                  <span className="font-medium whitespace-nowrap">{fmtMoney(f.valor)}</span>
                  <span className="w-9 text-right text-muted-foreground">{pct(f.pct)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-semibold">Top 5 contratos com maior valor em aberto</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 pt-3">
            {top.length === 0 && <p className="text-xs text-muted-foreground">Sem notas em aberto.</p>}
            {top.map((c) => (
              <button
                key={c.contratoId} type="button" className="block w-full text-left"
                title="Filtrar por este contrato"
                onClick={() => { const f = { ...filtros, contratoId: c.contratoId }; setRascunho(f); setFiltros(f); setPagina(1); }}
              >
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate">{c.contrato}</span><span className="font-semibold whitespace-nowrap">{fmtMoney(c.valor)}</span>
                </div>
                <div className="mt-0.5 h-2 rounded bg-muted"><div className="h-2 rounded bg-blue-500" style={{ width: `${top[0].valor > 0 ? Math.max(3, (c.valor / top[0].valor) * 100) : 0}%` }} /></div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label className="text-xs">Busca</Label>
            <Input placeholder="Cliente, nota ou faixa" value={rascunho.busca} onChange={(e) => setRascunho({ ...rascunho, busca: e.target.value })} onKeyDown={(e) => e.key === "Enter" && aplicar()} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período de emissão</Label>
            <div className="flex items-center gap-1.5">
              <Input type="date" className="w-36" value={rascunho.de} onChange={(e) => setRascunho({ ...rascunho, de: e.target.value })} />
              <span className="text-muted-foreground">–</span>
              <Input type="date" className="w-36" value={rascunho.ate} onChange={(e) => setRascunho({ ...rascunho, ate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Empresa</Label>
            <Select value={rascunho.empresaId || "todas"} onValueChange={(v) => {
              const empresaId = v === "todas" ? "" : v;
              // Contrato de outra empresa não sobra escolhido escondido.
              const contratoOk = !rascunho.contratoId || !empresaId
                || linhas.some((l) => l.contratoId === rascunho.contratoId && l.empresaId === empresaId);
              setRascunho({ ...rascunho, empresaId, contratoId: contratoOk ? rascunho.contratoId : "" });
            }}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todas">Todas</SelectItem>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.codigo || e.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Filtrar por contrato</Label>
            <SearchableSelect
              className="w-64"
              value={rascunho.contratoId}
              onChange={filtrarContrato}
              options={opcoesContrato}
              placeholder={rascunho.empresaId ? "Todos os contratos da empresa" : "Todos os contratos"}
              searchPlaceholder="Buscar contrato pelo nome…"
              emptyLabel="Nenhum contrato com notas em aberto"
              allowClear clearValue=""
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={rascunho.status || "todos"} onValueChange={(v) => setRascunho({ ...rascunho, status: v === "todos" ? "" : (v as StatusCobranca) })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos (sem canceladas)</SelectItem>
                {(Object.keys(ROTULO_STATUS) as StatusCobranca[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={aplicar}>Filtrar</Button>
          <Button variant="outline" onClick={limpar}><RotateCcw className="mr-1.5 h-4 w-4" />Limpar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              Resultados: {ordenadas.length} nota(s) em {grupos.length} contrato(s)
              {filtros.contratoId && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1 font-medium text-primary">
                  Contrato: {nomeContratoFiltrado || "selecionado"} · {fmtMoney(totais.totalGeral)}
                  <button type="button" className="rounded-full px-1.5 hover:bg-primary/20" title="Limpar o filtro de contrato e voltar à visão geral"
                    onClick={() => filtrarContrato("")}>✕</button>
                </span>
              )}
            </span>
            <div className="inline-flex rounded-md border p-0.5">
              {(["contrato", "nota"] as const).map((m) => (
                <button key={m} type="button" onClick={() => { setModo(m); setPagina(1); }} className={cn("rounded px-2.5 py-1 font-medium", modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {m === "contrato" ? "Por contrato" : "Por nota"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <CabecalhoOrdenavel rotulo="Emissão" coluna="emissao" {...cab} />
                  <CabecalhoOrdenavel rotulo="Nº Nota" coluna="numero" {...cab} />
                  <CabecalhoOrdenavel rotulo="Cliente/Contrato" coluna="contrato" {...cab} />
                  <CabecalhoOrdenavel rotulo="Empresa" coluna="empresa" {...cab} />
                  <CabecalhoOrdenavel rotulo={modo === "contrato" ? "Valor em aberto" : "Valor"} coluna="valor" {...cab} className="text-right" />
                  {modo === "nota" && <th className="px-2 py-2 text-right font-medium" title="Total em aberto do contrato">Total do contrato</th>}
                  <CabecalhoOrdenavel rotulo="Dias" coluna="dias" {...cab} className="text-right" />
                  <CabecalhoOrdenavel rotulo="Faixa" coluna="faixa" {...cab} />
                  <CabecalhoOrdenavel rotulo="Status" coluna="status" {...cab} />
                  <th className="px-2 py-2 font-medium">Último e-mail</th>
                  <th className="px-2 py-2 font-medium">Próxima ação</th>
                  <th className="px-2 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {carregando && <tr><td colSpan={colunasFlat} className="px-2 py-8 text-center text-muted-foreground">Carregando...</td></tr>}
                {!carregando && totalItens === 0 && <tr><td colSpan={colunasFlat} className="px-2 py-8 text-center text-muted-foreground">Nenhuma nota em aberto para os filtros.</td></tr>}

                {modo === "nota" && fatia(ordenadas).map((l) => linhaNota(l, { totalContrato: totalPorContrato.get(l.contratoId) }))}

                {modo === "contrato" && fatia(grupos).map((g) => {
                  const aberto = expandidos.has(g.contratoId);
                  const idsSel = g.linhas.filter((l) => l.status !== "cancelada").map((l) => l.id);
                  const todasSel = idsSel.length > 0 && idsSel.every((i) => selecionadas.has(i));
                  const plano = planoPorContrato.get(g.contratoId);
                  const acao = proximaAcao({ status: "em_atraso", faixa: g.faixa }, plano, modoAuto);
                  const alvoPrevia = g.linhas.find((l) => l.faixa !== null);
                  return (
                    <Fragment key={g.contratoId}>
                      <tr className="cursor-pointer border-t bg-muted/20 font-medium hover:bg-muted/40" onClick={() => setExpandidos((p) => { const n = new Set(p); n.has(g.contratoId) ? n.delete(g.contratoId) : n.add(g.contratoId); return n; })}>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><Checkbox checked={todasSel} onCheckedChange={() => alternarGrupo(g)} /></td>
                        <td className="px-2 py-2" colSpan={3}>
                          <span className="inline-flex items-center gap-1.5">
                            {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            <span className="truncate" title={g.contrato}>{g.contrato}</span>
                            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{g.linhas.length} nota(s)</span>
                          </span>
                        </td>
                        <td className="px-2 py-2">{g.empresaCodigo}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">{fmtMoney(g.total)}</td>
                        <td className="px-2 py-2 text-right">{g.diasMax}</td>
                        <td className="px-2 py-2">{g.faixa ? <Chip className={FAIXA_CHIP[g.faixa]}>{rotuloFaixa(g.faixa)}</Chip> : <span className="font-normal text-muted-foreground">No prazo</span>}</td>
                        <td className="px-2 py-2 font-normal text-muted-foreground">{g.linhas.filter((l) => l.atraso > 0).length} em atraso</td>
                        <td className="px-2 py-2 font-normal text-muted-foreground whitespace-nowrap">{ultimoEnvio.get(g.contratoId) ? fmtData(ultimoEnvio.get(g.contratoId) as string) : "-"}</td>
                        <td className={cn("px-2 py-2 font-normal", TOM_ACAO[acao.tom])}>{acao.texto}</td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5">
                            {acao.tom !== "juridico" && alvoPrevia && <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Ver prévia do e-mail (não envia)" onClick={() => abrirPrevia(g.contratoId, g.contrato)}><Mail className="h-3.5 w-3.5" /></Button>}
                            {podeMarcarManual && acao.tom !== "juridico" && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Mais ações"><MoreVertical className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => alternarManual(g.contratoId, plano?.decisao !== "manual")}>{plano?.decisao === "manual" ? "Voltar o contrato ao automático" : "Passar o contrato para cobrança só manual"}</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </td>
                      </tr>
                      {aberto && g.linhas.map((l) => linhaNota(l, { recuo: true }))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs">
            <span className="text-muted-foreground">{modo === "contrato" ? `${grupos.length} contrato(s)` : `${ordenadas.length} nota(s)`} · página {paginaAtual} de {totalPaginas}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Itens por página</span>
              <Select value={String(porPagina)} onValueChange={(v) => { setPorPagina(Number(v)); setPagina(1); }}>
                <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                <SelectContent>{[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selecionadasLinhas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
          <span>
            {selecionadasLinhas.length} nota(s) selecionada(s) de <strong>{selecionadasLinhas[0].contrato}</strong> · {fmtMoney(selecionadasLinhas.reduce((s, l) => s + l.valor, 0))}
          </span>
          <div className="flex gap-2">
            {proximaAcao(selecionadasLinhas[0], planoPorContrato.get(selecionadasLinhas[0].contratoId), modoAuto).tom !== "juridico" && (
              <Button size="sm" onClick={() => abrirPrevia(selecionadasLinhas[0].contratoId, selecionadasLinhas[0].contrato)}><Mail className="mr-1.5 h-4 w-4" />Prévia do e-mail</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setSelecionadas(new Set())}>Limpar seleção</Button>
          </div>
        </div>
      )}

      <Dialog open={!!previa} onOpenChange={(o) => !o && setPrevia(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {previa && (
            <>
              <DialogHeader>
                <DialogTitle>Prévia — {previa.contrato}</DialogTitle>
                <DialogDescription>Como o e-mail de cobrança sairia hoje. Nada é enviado por aqui.</DialogDescription>
              </DialogHeader>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong>Para:</strong> {previa.para.join("; ") || "—"}</p>
                <p><strong>Cópia:</strong> {previa.cc.join("; ") || "—"}</p>
                <p><strong>Assunto:</strong> {previa.assunto}</p>
              </div>
              {/* iframe sem permissões: o HTML do e-mail nunca executa script na tela */}
              <iframe title="Prévia do e-mail" sandbox="" srcDoc={previa.corpo} className="h-[50vh] w-full rounded border bg-white" />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
