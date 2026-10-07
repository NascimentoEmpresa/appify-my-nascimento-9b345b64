// =====================================================================
// RH › GESTÃO DE PONTO (/app/rh/gestao-ponto) — branch local gestaoponto
//
// O mês de cada colaborador, das marcações da Senior (espelho."BiMarcacoes"),
// casadas pela matrícula ("Cadastro") + empresa. Por filial: quem trabalhou
// quanto, quem tem batida ímpar, dia útil sem batida, atraso, hora extra; e o
// espelho de ponto de cada um, dia a dia, para imprimir ou exportar.
// Cálculo em src/lib/gestaoPonto.ts (com teste); dados pela RPC gp_mes
// (mig 20261007000001).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, CalendarDays, Clock, Download, Fingerprint, Loader2, Printer, Search,
  ShieldAlert, TimerReset, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { usePontoFiliais, usePontoMes } from "@/hooks/useGestaoPonto";
import {
  montarEspelho, fmtHoras, ROTULO_SITUACAO, NOME_DIA,
  type ColaboradorPonto, type EspelhoMes,
} from "@/lib/gestaoPonto";
import { formatarHora24 } from "@/lib/ponto";

const LS_FILIAL = "gestao-ponto:filial";
const mesAtual = () => new Date().toISOString().slice(0, 7);
const rotuloMes = (m: string) => {
  const [a, mm] = m.split("-").map(Number);
  return new Date(a, mm - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};
const fmtData = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—");

/** Batida já ajustada → "07:00"; depois da meia-noite da jornada "07:00 (+1)"; entrada na véspera "23:55 (−1)". */
const fmtBatida = (min: number) =>
  min < 0 ? `${formatarHora24(min + 1440)} (−1)` : `${formatarHora24(min)}${min >= 1440 ? " (+1)" : ""}`;

type Linha = { c: ColaboradorPonto; e: EspelhoMes };

function Kpi({ icon: Icon, valor, rotulo, dica, tom = "primary" }: {
  icon: typeof Users; valor: React.ReactNode; rotulo: string; dica?: string; tom?: string;
}) {
  const tons: Record<string, string> = {
    primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tons[tom]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {dica && <p className="truncate text-[11px] text-muted-foreground/70">{dica}</p>}
      </div>
    </Card>
  );
}

export default function GestaoPonto() {
  const [mes, setMes] = useState(mesAtual());
  const [filial, setFilial] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_FILIAL); } catch { return null; }
  });
  const [busca, setBusca] = useState("");
  const [soPendencia, setSoPendencia] = useState(false);
  const [aberto, setAberto] = useState<Linha | null>(null);

  useEffect(() => { try { if (filial) localStorage.setItem(LS_FILIAL, filial); } catch { /* sem storage */ } }, [filial]);

  const { data: filiais = [], error: erroFiliais } = usePontoFiliais();
  const { data, isLoading, error, isFetching } = usePontoMes(mes, filial);

  const hoje = new Date().toISOString().slice(0, 10);
  const linhas: Linha[] = useMemo(
    () => (data?.colaboradores ?? []).map((c) => ({ c, e: montarEspelho(c, mes, hoje) })),
    [data, mes, hoje],
  );
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => !soPendencia || l.e.inconsistencias > 0)
      .filter((l) => !q || l.c.nome.toLowerCase().includes(q) || String(l.c.cadastro ?? "").includes(q) || (l.c.cargo ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.e.inconsistencias - a.e.inconsistencias || a.c.nome.localeCompare(b.c.nome, "pt-BR"));
  }, [linhas, busca, soPendencia]);

  const tot = useMemo(() => ({
    colaboradores: linhas.length,
    semMarcacao: linhas.filter((l) => !l.c.batidas.length).length,
    comPendencia: linhas.filter((l) => l.e.inconsistencias > 0).length,
    impares: linhas.reduce((s, l) => s + l.e.totais.impares, 0),
    semBatida: linhas.reduce((s, l) => s + l.e.totais.semBatida, 0),
    extra: linhas.reduce((s, l) => s + l.e.totais.minutosExtra, 0),
    devendo: linhas.reduce((s, l) => s + l.e.totais.minutosDevendo, 0),
    atraso: linhas.reduce((s, l) => s + l.e.totais.minutosAtraso, 0),
  }), [linhas]);

  const opcoesFilial = useMemo(() => filiais.map((f) => ({ value: f.filial, label: f.filial, hint: `${f.ativos} ativos` })), [filiais]);

  const exportarFilial = () => {
    const cab = ["Matrícula", "Nome", "Cargo", "Escala", "Dias trabalhados", "Trabalhado", "Previsto", "Saldo", "Hora extra", "Devendo", "Atraso", "Batidas ímpares", "Dias úteis sem batida"];
    const ls = visiveis.map(({ c, e }) => [c.cadastro, c.nome, c.cargo, c.escala.descricao, e.totais.diasTrabalhados,
      fmtHoras(e.totais.trabalhado), fmtHoras(e.totais.previsto), fmtHoras(e.totais.saldo), fmtHoras(e.totais.minutosExtra),
      fmtHoras(e.totais.minutosDevendo), fmtHoras(e.totais.minutosAtraso), e.totais.impares, e.totais.semBatida]);
    baixarCsv(`ponto_${mes}_${(filial ?? "").slice(0, 40)}.csv`, [cab, ...ls]);
  };

  const erro = (erroFiliais ?? error) as Error | null;

  return (
    <div>
      <PageHeader
        title="Gestão de Ponto"
        subtitle="As marcações da Senior de cada colaborador, mês a mês: horas trabalhadas, batidas ímpares, dias sem batida, atrasos e horas extras."
        module="Recursos Humanos"
        breadcrumb={["Recursos Humanos", "Gestão de Ponto"]}
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mês</p>
          <Input type="month" className="h-9 w-44" value={mes} max={mesAtual()} onChange={(e) => e.target.value && setMes(e.target.value)} />
        </div>
        <div className="min-w-[280px] flex-1 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filial / contrato</p>
          <SearchableSelect value={filial} onChange={(v) => setFilial(v || null)} options={opcoesFilial}
            placeholder="Escolha a filial…" searchPlaceholder="Buscar filial…" emptyLabel="Nenhuma filial" />
        </div>
        <div className="relative w-full space-y-1 sm:w-64">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Buscar</p>
          <Search className="absolute bottom-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Nome, matrícula ou cargo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="flex h-9 items-center gap-2 text-xs">
          <Checkbox checked={soPendencia} onCheckedChange={(v) => setSoPendencia(v === true)} /> Só com pendência
        </label>
        <Button variant="outline" className="h-9 gap-1.5" disabled={!visiveis.length} onClick={exportarFilial}><Download className="h-4 w-4" /> Exportar</Button>
      </Card>

      {erro ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" /> {erro.message}
        </Card>
      ) : !filial ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <Fingerprint className="h-8 w-8 text-primary" />
          Escolha a filial para ver o ponto de {rotuloMes(mes)}.
        </Card>
      ) : isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo as marcações da Senior…</Card>
      ) : data && !data.disponivel ? (
        <Card className="p-6 text-sm text-muted-foreground">{data.motivo}</Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Kpi icon={Users} valor={tot.colaboradores} rotulo="Colaboradores" dica={`${tot.semMarcacao} sem nenhuma marcação`} />
            <Kpi icon={AlertTriangle} valor={tot.comPendencia} rotulo="Com pendência" dica="ímpar, sem batida ou atraso" tom="destructive" />
            <Kpi icon={Fingerprint} valor={tot.impares} rotulo="Batidas ímpares" dica="dias sem fechar o par" tom="destructive" />
            <Kpi icon={CalendarDays} valor={tot.semBatida} rotulo="Dias úteis sem batida" dica="falta, atestado ou folga a conferir" tom="warning" />
            <Kpi icon={TrendingUp} valor={fmtHoras(tot.extra)} rotulo="Horas além do previsto" tom="info" />
            <Kpi icon={TrendingDown} valor={fmtHoras(tot.devendo + tot.atraso)} rotulo="Horas a menos + atrasos" dica={`atrasos: ${fmtHoras(tot.atraso)}`} tom="warning" />
          </div>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>{visiveis.length} de {linhas.length} colaborador(es) · {rotuloMes(mes)}{isFetching ? " · atualizando…" : ""}</span>
              <span>Clique no colaborador para ver o espelho do mês</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2">Colaborador</th>
                    <th className="px-3 py-2">Escala</th>
                    <th className="px-3 py-2 text-right">Dias</th>
                    <th className="px-3 py-2 text-right">Trabalhado</th>
                    <th className="px-3 py-2 text-right">Previsto</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-center">Pendências</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => {
                    const { c, e } = l;
                    return (
                      <tr key={c.id} className="cursor-pointer border-b border-border/60 hover:bg-muted/30" onClick={() => setAberto(l)}>
                        <td className="px-4 py-2">
                          <p className="font-medium">{c.nome}</p>
                          <p className="text-[11px] text-muted-foreground">Matr. {c.cadastro ?? "—"} · {c.cargo ?? "—"}{c.situacao && c.situacao !== "Trabalhando" ? ` · ${c.situacao}` : ""}</p>
                        </td>
                        <td className="max-w-[220px] px-3 py-2 text-xs text-muted-foreground"><span className="line-clamp-2">{c.escala.descricao ?? "—"}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.totais.diasTrabalhados}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHoras(e.totais.trabalhado)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtHoras(e.totais.previsto)}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${e.totais.saldo < -10 ? "text-warning" : e.totais.saldo > 10 ? "text-info" : "text-success"}`}>{fmtHoras(e.totais.saldo)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-center gap-1">
                            {!c.batidas.length && <Badge variant="outline" className="text-[10px]">Sem marcação</Badge>}
                            {e.totais.impares > 0 && <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">{e.totais.impares} ímpar</Badge>}
                            {e.totais.semBatida > 0 && c.batidas.length > 0 && <Badge variant="outline" className="border-warning/30 text-[10px] text-warning">{e.totais.semBatida} sem batida</Badge>}
                            {e.totais.atrasos > 0 && <Badge variant="outline" className="text-[10px]">{e.totais.atrasos} atraso</Badge>}
                            {e.inconsistencias === 0 && c.batidas.length > 0 && <span className="text-[11px] text-success">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Ninguém neste filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Fonte: marcações do relógio na Senior (espelho atualizado uma vez por dia), casadas pela matrícula. Previsto pela escala da Senior;
            feriados nacionais descontados (municipais aparecem como dia sem batida). Revezamento (12x36, 6x1): o previsto vale nos dias trabalhados e dia sem batida não conta como falta. Afastado sem batida no mês aparece como Afastado. Tolerância de 10 minutos.
          </p>
        </>
      )}

      <DialogEspelho linha={aberto} mes={mes} onClose={() => setAberto(null)} />
    </div>
  );
}

// ---- Espelho do mês ----------------------------------------------------------

function DialogEspelho({ linha, mes, onClose }: { linha: Linha | null; mes: string; onClose: () => void }) {
  if (!linha) return null;
  const { c, e } = linha;
  const j = e.jornada;
  const maxPares = Math.max(2, ...e.dias.map((d) => Math.ceil(d.batidas.length / 2)));

  const exportar = () => {
    const cab = ["Data", "Dia", ...Array.from({ length: maxPares }, (_, i) => [`Entrada ${i + 1}`, `Saída ${i + 1}`]).flat(), "Trabalhado", "Previsto", "Saldo", "Situação"];
    const ls = e.dias.map((d) => [d.data, NOME_DIA[d.diaSemana],
      ...Array.from({ length: maxPares * 2 }, (_, i) => (d.batidas[i] != null ? fmtBatida(d.batidas[i]) : "")),
      fmtHoras(d.trabalhado), fmtHoras(d.previsto), fmtHoras(d.saldo), ROTULO_SITUACAO[d.situacao].label + (d.feriado ? ` (${d.feriado})` : "")]);
    baixarCsv(`espelho_${mes}_${c.cadastro}_${c.nome.split(" ")[0]}.csv`, [cab, ...ls]);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">Espelho de ponto · {rotuloMes(mes)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <p className="text-base font-bold">{c.nome}</p>
            <p className="text-xs text-muted-foreground">Matr. {c.cadastro ?? "—"} · empresa {c.empresa ?? "—"} · {c.cargo ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{c.filial ?? "—"}{c.posto ? ` · ${c.posto}` : ""}</p>
            <p className="mt-1 flex items-center gap-1 text-xs"><Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {c.escala.descricao ?? "Sem escala"} — previsto {fmtHoras(j.minutosDia)} por dia{j.escala12x36 ? " (12x36)" : j.revezamento ? " (revezamento: vale nos dias trabalhados)" : j.sabado ? ` + sábado ${fmtHoras(j.minutosSabado)}` : ""}
              {j.origem === "padrao" && <span className="text-warning"> · escala não lida, usando 8h</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={exportar}><Download className="h-4 w-4" /> Exportar</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => imprimirEspelho(c, e, mes, maxPares)}><Printer className="h-4 w-4" /> Imprimir</Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {([
            ["Trabalhado", fmtHoras(e.totais.trabalhado)], ["Previsto", fmtHoras(e.totais.previsto)],
            ["Saldo", fmtHoras(e.totais.saldo)], ["Horas extras", fmtHoras(e.totais.minutosExtra)],
            ["Atrasos", `${e.totais.atrasos} (${fmtHoras(e.totais.minutosAtraso)})`],
            ["Pendências", `${e.totais.impares} ímpar · ${e.totais.semBatida} sem batida`],
          ] as const).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</p>
              <p className="text-sm font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Dia</th>
                {Array.from({ length: maxPares }, (_, i) => (
                  <th key={i} className="px-2 py-2 text-center" colSpan={2}>{i === 0 ? "Entrada / Saída" : `Intervalo ${i}`}</th>
                ))}
                <th className="px-2 py-2 text-right">Trab.</th>
                <th className="px-2 py-2 text-right">Prev.</th>
                <th className="px-2 py-2 text-right">Saldo</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {e.dias.map((d) => {
                const r = ROTULO_SITUACAO[d.situacao];
                const fimDeSemana = d.diaSemana === 0 || d.diaSemana === 6;
                return (
                  <tr key={d.data} className={`border-b border-border/50 last:border-0 ${fimDeSemana || d.feriado ? "bg-muted/30" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-1.5"><b className="tabular-nums">{d.data.slice(8)}</b> <span className="text-muted-foreground">{NOME_DIA[d.diaSemana]}</span></td>
                    {Array.from({ length: maxPares * 2 }, (_, i) => (
                      <td key={i} className={`px-2 py-1.5 text-center font-mono tabular-nums ${i === d.batidas.length - 1 && d.batidas.length % 2 ? "text-destructive" : ""}`}>
                        {d.batidas[i] != null ? fmtBatida(d.batidas[i]) : ""}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums">{d.trabalhado ? fmtHoras(d.trabalhado) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{d.previsto ? fmtHoras(d.previsto) : ""}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${d.saldo < -10 ? "text-warning" : d.saldo > 10 ? "text-info" : ""}`}>{d.batidas.length && d.previsto ? fmtHoras(d.saldo) : ""}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${r.cls}`}>
                      {r.label}{d.atrasoMin > 0 && ` ${fmtHoras(d.atrasoMin)}`}
                      {d.feriado && <span className="font-normal text-muted-foreground"> · {d.feriado}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <TimerReset className="h-3.5 w-3.5" /> "(+1)" = batida depois da meia-noite, na jornada que começou no dia anterior; "(−1)" = entrada batida na véspera (turno da meia-noite). Batida em vermelho = ficou sem par.
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ---- Exportar / imprimir -------------------------------------------------------

function baixarCsv(nome: string, linhas: unknown[][]) {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nome.replace(/[\\/:*?"<>|]/g, "_"); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imprimirEspelho(c: ColaboradorPonto, e: EspelhoMes, mes: string, maxPares: number) {
  const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[x]!));
  const linhas = e.dias.map((d) => `<tr${d.diaSemana === 0 || d.diaSemana === 6 || d.feriado ? ' class="fs"' : ""}>
    <td>${d.data.slice(8)}/${d.data.slice(5, 7)} ${NOME_DIA[d.diaSemana]}</td>
    ${Array.from({ length: maxPares * 2 }, (_, i) => `<td class="c">${d.batidas[i] != null ? fmtBatida(d.batidas[i]) : ""}</td>`).join("")}
    <td class="r">${d.trabalhado ? fmtHoras(d.trabalhado) : ""}</td><td class="r">${d.previsto ? fmtHoras(d.previsto) : ""}</td>
    <td class="r">${d.batidas.length && d.previsto ? fmtHoras(d.saldo) : ""}</td>
    <td>${h(ROTULO_SITUACAO[d.situacao].label)}${d.feriado ? " · " + h(d.feriado) : ""}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Espelho de ponto ${h(c.nome)} ${mes}</title>
  <style>body{font:11px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:16px;margin:0 0 4px}p{margin:2px 0}
  table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #ccc;padding:3px 5px}th{background:#f3f3f3;font-size:10px}
  .c{text-align:center;font-family:monospace}.r{text-align:right}.fs td{background:#f7f7f7}.tot{margin-top:10px}
  .ass{margin-top:48px;display:flex;gap:60px}.ass div{border-top:1px solid #333;padding-top:4px;width:260px;text-align:center}
  @page{size:A4 landscape;margin:12mm}</style></head><body>
  <h1>Espelho de ponto — ${h(rotuloMes(mes))}</h1>
  <p><b>${h(c.nome)}</b> · Matrícula ${h(c.cadastro)} · ${h(c.cargo)}</p>
  <p>${h(c.filial)}${c.posto ? " · " + h(c.posto) : ""}</p>
  <p>Escala: ${h(c.escala.descricao)} — previsto ${fmtHoras(e.jornada.minutosDia)} por dia</p>
  <table><thead><tr><th>Dia</th>${Array.from({ length: maxPares }, (_, i) => `<th colspan="2">${i === 0 ? "Entrada / Saída" : "Intervalo " + i}</th>`).join("")}
  <th>Trab.</th><th>Prev.</th><th>Saldo</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table>
  <p class="tot">Trabalhado ${fmtHoras(e.totais.trabalhado)} · Previsto ${fmtHoras(e.totais.previsto)} · Saldo ${fmtHoras(e.totais.saldo)} ·
  Horas extras ${fmtHoras(e.totais.minutosExtra)} · Atrasos ${e.totais.atrasos} (${fmtHoras(e.totais.minutosAtraso)}) ·
  Batidas ímpares ${e.totais.impares} · Dias úteis sem batida ${e.totais.semBatida}</p>
  <p style="color:#666">Fonte: marcações do relógio na Senior. Gerado no ERP em ${new Date().toLocaleString("pt-BR")}.</p>
  <div class="ass"><div>Colaborador</div><div>Responsável</div></div>
  <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
