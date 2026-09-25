import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, Search, UserCheck, UserMinus, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DIAS_EXPERIENCIA, MARCOS, NAO_ADMITIDO_SENIOR, RESULTADOS, agruparPorContrato, dataSaidaEfetiva, estadoDoMarco, fmtData, hojeIso, infoResultado,
  permaneceuEfetivo, proximaPendencia, resultadoPedeObservacao, resumoAcomp, somarDias, sugerirTipoSaida, tipoSaidaEfetivo,
  type EstadoMarco, type LinhaAcomp, type Marco, type Resultado,
} from "@/lib/recrutamento/acompanhamento";

// =====================================================================
// Recrutamento e Seleção › ACOMPANHAR COLABORADORES / ACOMPANHAR EXPERIÊNCIA
// (25/09/2026, mig 20260930000245) — a mesma tela, dois recortes:
//
//   colaboradores → todo mundo admitido no período (padrão: últimos 90
//                   dias, filtro por DATA DE ADMISSÃO), inclusive quem já
//                   saiu — é o histórico, como a planilha do RH.
//   experiencia   → só quem ainda está no contrato e tem até 90 dias de
//                   admissão: a fila de check-ins, ordenada pelo que vence.
//
// O layout é o do Excel CONTRATOS_VIGENTES: um bloco por CONTRATO, e as
// colunas NOME · CARGO · CIDADE · ADMISSÃO · 7 · 30 · 60 · 90 DIAS ·
// PERMANECEU? · DATA SAÍDA · DEMITIDO/DEMISSIONÁRIO · MOTIVO · OBSERVAÇÃO.
// Cada marco é um botão: registra o check-in (resultado, data, observação).
// "Exportar Excel" devolve a planilha no mesmo formato.
//
// Base: Senior (EMPREGADOS) + quem chegou à ADMISSÃO no nosso Recrutamento
// e ainda não está na Senior ("Ainda não admitido no sistema Senior" — os
// marcos esperam a admissão). Chave = CPF. RPC recrut_acompanhamento_lista;
// gravação por RPC (recrut_acomp_registrar_check / _salvar), com a ação
// "alterar" do menu — o banco repete a regra.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

export type ModoAcomp = "colaboradores" | "experiencia";
const MENU: Record<ModoAcomp, string> = {
  colaboradores: "recrutamento_acompanhar_colaboradores",
  experiencia: "recrutamento_acompanhar_experiencia",
};

function Kpi({ titulo, valor, icone: Icone, cor, dica }: { titulo: string; valor: number; icone: LucideIcon; cor: string; dica?: string }) {
  return (
    <Card title={dica}>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", cor)}><Icone className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** O botão de um marco (7/30/60/90) — a "célula" do Excel. */
function CelulaMarco({ estado, onClick, podeEditar }: { estado: EstadoMarco; onClick: () => void; podeEditar: boolean }) {
  if (estado.tipo === "aguardando") return <span className="text-xs text-muted-foreground" title="Conta a partir da admissão na Senior">aguarda</span>;
  if (estado.tipo === "nao_se_aplica") return <span className="text-xs text-muted-foreground" title="Saiu antes deste marco">—</span>;
  if (estado.tipo === "feito") {
    const r = infoResultado(estado.check.resultado)!;
    return (
      <button type="button" onClick={onClick} className={cn("rounded-md border px-2 py-1 text-xs font-semibold", r.cls)}
        title={`${r.rotulo} · ${fmtData(estado.check.realizado_em)}${estado.check.registrado_por ? ` · ${estado.check.registrado_por}` : ""}${estado.check.observacao ? `\n${estado.check.observacao}` : ""}`}>
        {r.emoji} {fmtData(estado.check.realizado_em).slice(0, 5)}
      </button>
    );
  }
  const txt = estado.tipo === "atrasado" ? `${estado.dias}d atraso` : estado.tipo === "hoje" ? "Hoje" : estado.tipo === "breve" ? `em ${estado.dias}d` : fmtData(estado.vence).slice(0, 5);
  const cls = estado.tipo === "atrasado" ? "border-red-400 bg-red-50 text-red-700"
    : estado.tipo === "hoje" ? "border-amber-400 bg-amber-50 text-amber-800"
    : estado.tipo === "breve" ? "border-amber-300 bg-amber-50/60 text-amber-700"
    : "border-dashed border-slate-300 text-slate-500";
  return (
    <button type="button" onClick={onClick} disabled={!podeEditar} className={cn("rounded-md border px-2 py-1 text-xs font-medium", cls, !podeEditar && "cursor-default")}
      title={`Vence em ${fmtData(estado.vence)}${podeEditar ? " — clique para registrar o check-in" : ""}`}>
      {txt}
    </button>
  );
}

export function PainelAcompanhamento({ modo }: { modo: ModoAcomp }) {
  const { can } = usePermissoes();
  const podeEditar = can("alterar", undefined, MENU[modo]);

  const [ini, setIni] = useState(() => somarDias(hojeIso(), -90));
  const [fim, setFim] = useState(() => hojeIso());
  const [linhas, setLinhas] = useState<LinhaAcomp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [fOrigem, setFOrigem] = useState<"todos" | "recrutamento">("todos");
  const [fSituacao, setFSituacao] = useState<"todos" | "no_contrato" | "sairam" | "nao_admitidos">("todos");
  const [fPendencia, setFPendencia] = useState<"todas" | "pendentes" | "atrasados">("todas");
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await db.rpc("recrut_acompanhamento_lista", modo === "experiencia"
      ? { _modo: "experiencia" } : { _modo: "colaboradores", _ini: ini, _fim: fim });
    if (error) toast.error("Erro ao carregar: " + error.message);
    setLinhas(((data as { linhas?: LinhaAcomp[] } | null)?.linhas ?? []) as LinhaAcomp[]);
    setCarregando(false);
  }, [modo, ini, fim]);
  useEffect(() => { carregar(); }, [carregar]);

  const hoje = hojeIso();
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const r = linhas.filter((l) => {
      if (!passaNoFiltroContratos(l, "contrato", fContratos)) return false;
      if (fOrigem === "recrutamento" && l.origem !== "recrutamento") return false;
      if (fSituacao === "no_contrato" && (l.saiu || !l.admitido_senior)) return false;
      if (fSituacao === "sairam" && !l.saiu) return false;
      if (fSituacao === "nao_admitidos" && l.admitido_senior) return false;
      if (fPendencia !== "todas") {
        const p = proximaPendencia(l, hoje);
        if (!p) return false;
        if (fPendencia === "atrasados" && !MARCOS.some((m) => estadoDoMarco(l, m, hoje).tipo === "atrasado")) return false;
      }
      if (!q) return true;
      return [l.nome, l.cpf, l.cargo, l.contrato, l.local, l.cidade].some((x) => String(x ?? "").toLowerCase().includes(q));
    });
    // Experiência: dentro de cada contrato, primeiro quem tem check vencendo.
    if (modo === "experiencia") {
      const peso = (l: LinhaAcomp) => { const p = proximaPendencia(l, hoje); return !p ? 9 : p.estado.tipo === "atrasado" ? 0 : p.estado.tipo === "hoje" ? 1 : 2; };
      r.sort((a, b) => peso(a) - peso(b) || String(a.admissao ?? "9").localeCompare(String(b.admissao ?? "9")));
    }
    return r;
  }, [linhas, busca, fContratos, fOrigem, fSituacao, fPendencia, modo, hoje]);

  const grupos = useMemo(() => agruparPorContrato(filtradas), [filtradas]);
  const resumo = useMemo(() => resumoAcomp(filtradas, hoje), [filtradas, hoje]);

  // ── Diálogo do check-in ─────────────────────────────────────────────
  const [alvoCheck, setAlvoCheck] = useState<{ l: LinhaAcomp; marco: Marco } | null>(null);
  const [fCheck, setFCheck] = useState<{ resultado: Resultado | ""; data: string; obs: string }>({ resultado: "", data: hoje, obs: "" });
  const [salvando, setSalvando] = useState(false);
  const abrirCheck = (l: LinhaAcomp, marco: Marco) => {
    if (!podeEditar) return;
    const c = l.checks.find((x) => x.marco === marco);
    setFCheck({ resultado: c?.resultado ?? "", data: c?.realizado_em ?? hoje, obs: c?.observacao ?? "" });
    setAlvoCheck({ l, marco });
  };
  const salvarCheck = async (apagar = false) => {
    if (!alvoCheck) return;
    if (!apagar && !fCheck.resultado) { toast.error("Escolha o resultado do check-in."); return; }
    if (!apagar && fCheck.resultado && resultadoPedeObservacao(fCheck.resultado) && fCheck.obs.trim().length < 5) {
      toast.error("Descreva o que foi observado."); return;
    }
    setSalvando(true);
    const { error } = await db.rpc("recrut_acomp_registrar_check", {
      p_cpf: alvoCheck.l.cpf, p_marco: alvoCheck.marco,
      p_resultado: apagar ? null : fCheck.resultado, p_realizado_em: fCheck.data || null, p_observacao: fCheck.obs.trim() || null,
    });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(apagar ? "Check-in removido." : `Check-in de ${alvoCheck.marco} dias registrado.`);
    setAlvoCheck(null); carregar();
  };

  // ── Diálogo do fim da linha (permaneceu, saída, motivo…) ─────────────
  const [alvoLinha, setAlvoLinha] = useState<LinhaAcomp | null>(null);
  const [fLinha, setFLinha] = useState({ permaneceu: "", data_saida: "", tipo_saida: "", motivo_saida: "", observacao: "", cidade: "" });
  const abrirLinha = (l: LinhaAcomp) => {
    const perm = permaneceuEfetivo(l);
    setFLinha({
      permaneceu: l.acomp?.permaneceu ?? (perm.valor ?? ""),
      data_saida: dataSaidaEfetiva(l) ?? "",
      tipo_saida: tipoSaidaEfetivo(l) ?? "",
      motivo_saida: l.acomp?.motivo_saida ?? (l.saiu ? l.causa ?? "" : ""),
      observacao: l.acomp?.observacao ?? "",
      cidade: l.cidade ?? "",
    });
    setAlvoLinha(l);
  };
  const salvarLinha = async () => {
    if (!alvoLinha) return;
    if (fLinha.permaneceu === "Não" && !fLinha.data_saida) { toast.error("Quem não permaneceu precisa da data de saída."); return; }
    setSalvando(true);
    const { error } = await db.rpc("recrut_acomp_salvar", { p_cpf: alvoLinha.cpf, p_dados: fLinha });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Acompanhamento salvo."); setAlvoLinha(null); carregar();
  };

  // ── Exportar no formato da planilha ─────────────────────────────────
  const exportar = async () => {
    const XLSX: any = await import("xlsx");
    const cab = ["NOME DO COLABORADOR", "CARGO", "CIDADE", "DATA ADMISSÃO", "7 DIAS", "30 DIAS", "60 DIAS", "90 DIAS",
      "PERMANECEU APÓS EXPERIÊNCIA?", "DATA SAÍDA", "DEMITIDO / DEMISSIONÁRIO", "MOTIVO", "OBSERVAÇÃO"];
    const celMarco = (l: LinhaAcomp, m: Marco) => {
      const e = estadoDoMarco(l, m, hoje);
      if (e.tipo === "feito") { const r = infoResultado(e.check.resultado)!; return `${r.curto} ${fmtData(e.check.realizado_em)}${e.check.observacao ? ` — ${e.check.observacao}` : ""}`; }
      if (e.tipo === "nao_se_aplica") return "—";
      if (e.tipo === "aguardando") return "Aguarda admissão";
      if (e.tipo === "atrasado") return `ATRASADO (venceu ${fmtData(e.vence)})`;
      return `Vence ${fmtData(e.vence)}`;
    };
    const aoa: (string | number)[][] = [["ACOMPANHAMENTO DE COLABORADORES"]];
    for (const [contrato, ls] of grupos) {
      aoa.push(["CONTRATO", contrato], cab);
      for (const l of ls) {
        aoa.push([l.nome + (l.admitido_senior ? "" : " (" + NAO_ADMITIDO_SENIOR + ")"), l.cargo, l.cidade ?? l.local ?? "", l.admissao ? fmtData(l.admissao) : "", ...MARCOS.map((m) => celMarco(l, m)),
          permaneceuEfetivo(l).valor ?? "", fmtData(dataSaidaEfetiva(l)) === "—" ? "" : fmtData(dataSaidaEfetiva(l)),
          tipoSaidaEfetivo(l) ?? "", l.acomp?.motivo_saida ?? (l.saiu ? l.causa ?? "" : ""), l.acomp?.observacao ?? ""]);
      }
      aoa.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [34, 26, 18, 13, 22, 22, 22, 22, 16, 12, 18, 28, 36].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Acompanhamento");
    XLSX.writeFile(wb, `acompanhamento-${modo}-${hoje}.xlsx`);
  };

  const alternarGrupo = (c: string) => setFechados((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  return (
    <>
      <div className={cn("mb-5 grid gap-3 sm:grid-cols-2", modo === "experiencia" ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
        <Kpi titulo={modo === "experiencia" ? "Em experiência" : "Admitidos no período"} valor={resumo.pessoas} icone={Users} cor="bg-blue-100 text-blue-700"
             dica={`${resumo.doRecrutamento} vieram do Recrutamento · ${resumo.naoAdmitidos} ainda não admitidos na Senior`} />
        <Kpi titulo="Check-ins atrasados" valor={resumo.atrasados} icone={AlertTriangle} cor="bg-red-100 text-red-700" />
        <Kpi titulo="Vencem hoje / em breve" valor={resumo.hoje + resumo.breve} icone={CalendarClock} cor="bg-amber-100 text-amber-700"
             dica={`Hoje: ${resumo.hoje} · próximos 3 dias: ${resumo.breve}`} />
        <Kpi titulo="Check-ins feitos" valor={resumo.feitos} icone={CheckCircle2} cor="bg-green-100 text-green-700"
             dica={`${resumo.negativos} com resultado negativo`} />
        {modo === "colaboradores" && (
          <Kpi titulo="Permaneceram / saíram" valor={resumo.permaneceram} icone={UserCheck} cor="bg-emerald-100 text-emerald-700"
               dica={`${resumo.permaneceram} permaneceram após a experiência · ${resumo.sairam} saíram`} />
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          {modo === "colaboradores" && (
            <>
              <div><Label className="text-xs">Admitidos de</Label><Input type="date" className="w-40" value={ini} max={fim} onChange={(e) => setIni(e.target.value)} /></div>
              <div><Label className="text-xs">até</Label><Input type="date" className="w-40" value={fim} min={ini} onChange={(e) => setFim(e.target.value)} /></div>
            </>
          )}
          <FiltroContratos linhas={linhas} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
          <Select value={fOrigem} onValueChange={(v) => setFOrigem(v as typeof fOrigem)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as admissões</SelectItem>
              <SelectItem value="recrutamento">Só vindos do Recrutamento</SelectItem>
            </SelectContent>
          </Select>
          {modo === "colaboradores" ? (
            <Select value={fSituacao} onValueChange={(v) => setFSituacao(v as typeof fSituacao)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as situações</SelectItem>
                <SelectItem value="no_contrato">Ainda no contrato</SelectItem>
                <SelectItem value="sairam">Já saíram</SelectItem>
                <SelectItem value="nao_admitidos">Ainda não admitidos na Senior</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Select value={fPendencia} onValueChange={(v) => setFPendencia(v as typeof fPendencia)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos em experiência</SelectItem>
                <SelectItem value="pendentes">Com check-in a fazer</SelectItem>
                <SelectItem value="atrasados">Com check-in atrasado</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="w-60 pl-8" placeholder="Nome, CPF, cargo, contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={carregar} disabled={carregando}>{carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}</Button>
            <Button variant="outline" onClick={exportar} disabled={!filtradas.length}><Download className="mr-2 h-4 w-4" />Exportar Excel</Button>
          </div>
        </CardContent>
      </Card>

      {carregando ? (
        <p className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
      ) : grupos.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {modo === "experiencia" ? "Ninguém em experiência com esse filtro." : "Nenhuma admissão no período com esse filtro."}
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {grupos.map(([contrato, ls]) => {
            const fechado = fechados.has(contrato);
            const atrasadosGrupo = ls.reduce((n, l) => n + MARCOS.filter((m) => estadoDoMarco(l, m, hoje).tipo === "atrasado").length, 0);
            return (
              <Card key={contrato} className="overflow-hidden">
                <button type="button" onClick={() => alternarGrupo(contrato)}
                  className="flex w-full items-center gap-2 border-b bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100">
                  {fechado ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contrato</span>
                  <span className="font-semibold">{contrato}</span>
                  <Badge variant="outline" className="ml-2">{ls.length}</Badge>
                  {atrasadosGrupo > 0 && <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">{atrasadosGrupo} atrasado(s)</Badge>}
                </button>
                {!fechado && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2">Colaborador</th>
                          <th className="px-3 py-2">Cargo</th>
                          <th className="px-3 py-2">Cidade / local</th>
                          <th className="px-3 py-2">Admissão</th>
                          {MARCOS.map((m) => <th key={m} className="px-2 py-2 text-center">{m} dias</th>)}
                          <th className="px-3 py-2">Permaneceu?</th>
                          <th className="px-3 py-2">Saída</th>
                          <th className="px-3 py-2">Motivo / observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ls.map((l) => {
                          const perm = permaneceuEfetivo(l);
                          const saida = dataSaidaEfetiva(l);
                          const tipo = tipoSaidaEfetivo(l);
                          const motivo = l.acomp?.motivo_saida ?? (l.saiu ? l.causa : null);
                          return (
                            <tr key={l.cpf} className={cn("border-b last:border-0 hover:bg-slate-50/60", !l.admitido_senior && "bg-amber-50/40")}>
                              <td className="px-3 py-2">
                                <div className="font-medium">{l.nome}</div>
                                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                                  {l.origem === "recrutamento" && (
                                    <Badge variant="outline" className="h-5 border-blue-300 bg-blue-50 px-1.5 text-[10px] text-blue-700" title={l.vaga_id ? `Vaga #${l.vaga_id} · ${l.vaga_status ?? ""}` : undefined}>
                                      Recrutamento{l.vaga_id ? ` · vaga #${l.vaga_id}` : ""}
                                    </Badge>
                                  )}
                                  {!l.admitido_senior && (
                                    <Badge variant="outline" className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-800">{NAO_ADMITIDO_SENIOR}</Badge>
                                  )}
                                  {l.saiu && <Badge variant="outline" className="h-5 border-red-300 bg-red-50 px-1.5 text-[10px] text-red-700">{l.situacao}</Badge>}
                                  {l.admitido_senior && !l.saiu && l.situacao !== "Trabalhando" && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{l.situacao}</Badge>}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-xs">{l.cargo}</td>
                              <td className="px-3 py-2 text-xs">{l.cidade || l.local || "—"}</td>
                              <td className="px-3 py-2 text-xs">
                                {l.admissao ? (
                                  <>
                                    {fmtData(l.admissao)}
                                    <div className="text-[11px] text-muted-foreground">{l.dias}d{(l.dias ?? 0) <= DIAS_EXPERIENCIA && !l.saiu ? " · experiência" : ""}</div>
                                  </>
                                ) : (
                                  <span className="text-amber-700" title="Ainda não está na EMPREGADOS (Senior)">
                                    —<div className="text-[11px]">na Admissão desde {fmtData(l.data_ref)}</div>
                                  </span>
                                )}
                              </td>
                              {MARCOS.map((m) => (
                                <td key={m} className="px-2 py-2 text-center">
                                  <CelulaMarco estado={estadoDoMarco(l, m, hoje)} podeEditar={podeEditar} onClick={() => abrirCheck(l, m)} />
                                </td>
                              ))}
                              <td className="px-3 py-2">
                                <button type="button" onClick={() => podeEditar && abrirLinha(l)} disabled={!podeEditar}
                                  className={cn("rounded-md border px-2 py-1 text-xs font-semibold",
                                    perm.valor === "Sim" ? "border-green-300 bg-green-50 text-green-700" : perm.valor === "Não" ? "border-red-300 bg-red-50 text-red-700" : "border-dashed text-slate-500")}
                                  title={perm.automatico && perm.valor ? "Pela situação na Senior — clique para confirmar" : undefined}>
                                  {perm.valor ?? "Em aberto"}{perm.automatico && perm.valor ? " *" : ""}
                                </button>
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {saida ? <>{fmtData(saida)}<div className="text-[11px] text-muted-foreground">{tipo ?? ""}</div></> : "—"}
                              </td>
                              <td className="max-w-[260px] px-3 py-2 text-xs">
                                <button type="button" onClick={() => podeEditar && abrirLinha(l)} disabled={!podeEditar} className="w-full text-left">
                                  {motivo && <div className="line-clamp-1"><b>Motivo:</b> {motivo}</div>}
                                  {l.acomp?.observacao ? <div className="line-clamp-2 text-muted-foreground">{l.acomp.observacao}</div>
                                    : !motivo && <span className="text-muted-foreground">{podeEditar ? "+ anotar" : "—"}</span>}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
          <p className="text-xs text-muted-foreground">* Preenchido pela situação na Senior; clique para confirmar ou corrigir.</p>
        </div>
      )}

      {/* Check-in de um marco */}
      <Dialog open={!!alvoCheck} onOpenChange={(v) => { if (!v) setAlvoCheck(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Check-in de {alvoCheck?.marco} dias</DialogTitle></DialogHeader>
          {alvoCheck && (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-semibold">{alvoCheck.l.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {alvoCheck.l.cargo} · {alvoCheck.l.contrato} · admitido em {fmtData(alvoCheck.l.admissao)} · vence em {alvoCheck.l.admissao ? fmtData(somarDias(alvoCheck.l.admissao, alvoCheck.marco)) : "—"}
                </div>
              </div>
              <div>
                <Label>Resultado *</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {RESULTADOS.map((r) => (
                    <button key={r.valor} type="button" onClick={() => setFCheck((f) => ({ ...f, resultado: r.valor }))}
                      className={cn("rounded-lg border px-3 py-2 text-left text-sm font-medium", fCheck.resultado === r.valor ? r.cls + " ring-2 ring-offset-1" : "hover:bg-slate-50")}>
                      {r.emoji} {r.rotulo}
                    </button>
                  ))}
                </div>
              </div>
              <div><Label>Data do check-in</Label><Input type="date" className="mt-1 w-44" value={fCheck.data} max={hoje} onChange={(e) => setFCheck((f) => ({ ...f, data: e.target.value }))} /></div>
              <div>
                <Label>Observação {fCheck.resultado && resultadoPedeObservacao(fCheck.resultado as Resultado) ? "*" : "(opcional)"}</Label>
                <Textarea className="mt-1" rows={3} value={fCheck.obs} onChange={(e) => setFCheck((f) => ({ ...f, obs: e.target.value }))}
                  placeholder="Como está a adaptação, o que o encarregado relatou, pontos de atenção…" />
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                {alvoCheck.l.checks.some((c) => c.marco === alvoCheck.marco)
                  ? <Button variant="ghost" className="text-red-600" onClick={() => salvarCheck(true)} disabled={salvando}>Remover check-in</Button> : <span />}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setAlvoCheck(null)} disabled={salvando}>Cancelar</Button>
                  <Button onClick={() => salvarCheck(false)} disabled={salvando}>{salvando ? "Salvando…" : "Registrar check-in"}</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Permaneceu / saída / motivo / observação */}
      <Dialog open={!!alvoLinha} onOpenChange={(v) => { if (!v) setAlvoLinha(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Acompanhamento — {alvoLinha?.nome}</DialogTitle></DialogHeader>
          {alvoLinha && (
            <div className="space-y-4">
              {alvoLinha.saiu && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <UserMinus className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Na Senior: <b>{alvoLinha.situacao}</b>{alvoLinha.afastamento ? ` em ${fmtData(alvoLinha.afastamento)}` : ""}{alvoLinha.causa ? ` · ${alvoLinha.causa}` : ""}.
                    {sugerirTipoSaida(alvoLinha.causa) ? ` Sugestão: ${sugerirTipoSaida(alvoLinha.causa)}.` : ""}</span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Permaneceu após a experiência?</Label>
                  <Select value={fLinha.permaneceu || "aberto"} onValueChange={(v) => setFLinha((f) => ({ ...f, permaneceu: v === "aberto" ? "" : v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aberto">Em aberto</SelectItem>
                      <SelectItem value="Sim">Sim</SelectItem>
                      <SelectItem value="Não">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Cidade</Label><Input className="mt-1" value={fLinha.cidade} onChange={(e) => setFLinha((f) => ({ ...f, cidade: e.target.value }))} placeholder={alvoLinha.local ?? ""} /></div>
                <div><Label>Data de saída {fLinha.permaneceu === "Não" ? "*" : ""}</Label><Input type="date" className="mt-1" value={fLinha.data_saida} onChange={(e) => setFLinha((f) => ({ ...f, data_saida: e.target.value }))} /></div>
                <div>
                  <Label>Demitido / demissionário</Label>
                  <Select value={fLinha.tipo_saida || "nenhum"} onValueChange={(v) => setFLinha((f) => ({ ...f, tipo_saida: v === "nenhum" ? "" : v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">—</SelectItem>
                      <SelectItem value="Demitido">Demitido</SelectItem>
                      <SelectItem value="Demissionário">Demissionário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Motivo</Label><Input className="mt-1" value={fLinha.motivo_saida} onChange={(e) => setFLinha((f) => ({ ...f, motivo_saida: e.target.value }))} placeholder="Motivo da saída" /></div>
              <div><Label>Observação</Label><Textarea className="mt-1" rows={3} value={fLinha.observacao} onChange={(e) => setFLinha((f) => ({ ...f, observacao: e.target.value }))} /></div>
              {alvoLinha.acomp?.atualizado_por && (
                <p className="text-xs text-muted-foreground">Última alteração: {alvoLinha.acomp.atualizado_por}{alvoLinha.acomp.atualizado_em ? ` · ${new Date(alvoLinha.acomp.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAlvoLinha(null)} disabled={salvando}>Cancelar</Button>
                <Button onClick={salvarLinha} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
