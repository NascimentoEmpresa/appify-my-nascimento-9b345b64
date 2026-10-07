import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowLeft, CalendarDays, ChevronDown, Info, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useTurnoverPainel } from "@/hooks/useRelatoriosDiretoria";
import {
  LIMITES, META_ANUAL, META_MENSAL, analistas, dozeMeses, nomeContrato, rotuloMeses, totalAnalistas, turnoverDoAno, turnoverPorContrato,
  type LinhaAnalista, type PainelTurnover, type TipoLimite,
} from "@/lib/diretoria/turnover";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { MENU_IA, rotuloMes } from "./sistemas";
import { PainelIA } from "./componentes";

// =====================================================================
// DIRETORIA › RELATÓRIOS › TURN-OVER (mig 20261006000003, 06/10/2026)
//
// No formato do Power BI "TURNOVER GRUPO NASCIMENTO", no visual do ERP:
//   · Resumo Turnover — turnover do ano × meta de 41%, mês a mês × 3,42%,
//     demissões por período, por empresa e por contrato (sobre o efetivo do
//     grupo e sobre o do próprio contrato), com filtro por tipo de
//     desligamento ("Selecione o que deve ser considerado no Turnover");
//   · Analistas — aviso trabalhado (até 23%), indenizado (até 5%) e
//     demissões (até 100%) por contrato, acumulado e projeção do ano.
//   · Valores (rescisões) — depende das verbas da Senior; aba avisa.
// Filtro de meses (07/10/2026, mig 20261007000003): era "Até <mês>"; agora
// marca um ou vários meses soltos (FiltroMeses) e a RPC recebe _meses.
// Contas em src/lib/diretoria/turnover.ts (com teste).
// =====================================================================

const ANO_ATUAL = new Date().getFullYear();
const ANOS = [ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const VERMELHO = "#dc2626", VERDE = "#16a34a", AMBAR = "#f59e0b", AZUL = "#1d4ed8";
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

export default function TurnoverPainel() {
  const [ano, setAno] = useState(ANO_ATUAL);
  // null = ano inteiro; senão os meses marcados.
  const [meses, setMeses] = useState<number[] | null>(null);
  const [contrato, setContrato] = useState<string | null>(null);
  // null = todos os tipos de desligamento.
  const [causas, setCausas] = useState<string[] | null>(null);
  const q = useTurnoverPainel({ ano, meses, contrato, causas });
  const p = q.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Turn-over" subtitle="Turnover do Grupo Nascimento — metas, contratos e avisos" module="Diretoria e Presidência" breadcrumb={["Diretoria", "Relatórios", "Turn-over"]} />
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/app/diretoria/relatorios" className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Relatório Geral
        </Link>
        <Select value={String(ano)} onValueChange={(v) => { setAno(Number(v)); setMeses(null); }}>
          <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{ANOS.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <FiltroMeses ano={ano} meses={meses} onChange={setMeses} />
        <SearchableSelect
          value={contrato ?? ""} onChange={(v) => setContrato(v || null)} allowClear clearValue=""
          options={(p?.contratos ?? []).map((c) => ({ value: c, label: nomeContrato(c) }))}
          placeholder="Todos os contratos" searchPlaceholder="Buscar contrato…" triggerClassName="h-9 w-72"
        />
      </div>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o turnover…</Card>
      ) : q.error || !p ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <Tabs defaultValue="resumo" className={q.isFetching ? "opacity-70 transition-opacity" : ""}>
          <TabsList>
            <TabsTrigger value="resumo">Resumo Turnover</TabsTrigger>
            <TabsTrigger value="analistas">Analistas</TabsTrigger>
            <TabsTrigger value="valores">Turnover em Valores</TabsTrigger>
          </TabsList>
          <TabsContent value="resumo" className="space-y-4">
            <FiltroCausas p={p} causas={causas} onChange={setCausas} />
            <Resumo p={p} />
          </TabsContent>
          <TabsContent value="analistas" className="space-y-4"><Analistas p={p} /></TabsContent>
          <TabsContent value="valores">
            <Card className="flex items-start gap-3 p-6 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
              <div>
                <p className="font-semibold text-foreground">Ainda não disponível no ERP</p>
                <p>Os valores gastos em rescisões (tabela × prejuízo, por verba, por contrato e por tempo de empresa) vêm das verbas de rescisão da folha na Senior, que o ERP ainda não importa. Esta aba entra quando essa importação existir.</p>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      {p && (
        <AcessoGate menu={MENU_IA} acao="visualizar">
          <PainelIA sistema="turnover" de={p.de} ate={p.ate} titulo="Turn-over" />
        </AcessoGate>
      )}
    </div>
  );
}

// ---- Meses -----------------------------------------------------------------------

/** Um, vários ou todos os meses; os que ainda não chegaram ficam desligados. */
function FiltroMeses({ ano, meses, onChange }: { ano: number; meses: number[] | null; onChange: (m: number[] | null) => void }) {
  const hoje = new Date();
  const ultimo = ano < hoje.getFullYear() ? 12 : ano > hoje.getFullYear() ? 0 : hoje.getMonth() + 1;
  const marcado = (m: number) => meses == null || meses.includes(m);
  const alternar = (m: number) => {
    const atual = meses ?? Array.from({ length: ultimo }, (_, i) => i + 1);
    const prox = atual.includes(m) ? atual.filter((x) => x !== m) : [...atual, m].sort((a, b) => a - b);
    onChange(prox.length === 0 || prox.length >= ultimo ? null : prox);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 w-44 justify-between font-normal">
          <span className="flex items-center gap-2 truncate"><CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />{rotuloMeses(meses)}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Clique para marcar um ou mais meses</p>
          <Button size="sm" variant={meses == null ? "default" : "outline"} className="h-7 text-xs" onClick={() => onChange(null)}>Ano inteiro</Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MESES.map((nome, i) => {
            const m = i + 1, futuro = m > ultimo;
            return (
              <button key={nome} type="button" disabled={futuro} onClick={() => (meses == null ? onChange([m]) : alternar(m))}
                title={futuro ? "Mês ainda não começou" : undefined}
                className={`rounded-md border px-2 py-1.5 text-xs capitalize transition ${futuro ? "cursor-not-allowed opacity-40" : meses != null && marcado(m) ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
                {nome.slice(0, 3)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{meses == null ? "Mostrando o ano inteiro. O primeiro clique escolhe só aquele mês." : `Selecionado: ${rotuloMeses(meses)}.`}</p>
      </PopoverContent>
    </Popover>
  );
}

// ---- Tipo de desligamento ------------------------------------------------------

function FiltroCausas({ p, causas, onChange }: { p: PainelTurnover; causas: string[] | null; onChange: (c: string[] | null) => void }) {
  const todas = p.causas.map((c) => c.causa);
  const marcada = (c: string) => causas == null || causas.includes(c);
  const alternar = (c: string) => {
    const atual = causas ?? todas;
    const prox = atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c];
    onChange(prox.length === todas.length ? null : prox);
  };
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold">Tipo de desligamento considerado no turnover</p>
        <Button size="sm" variant={causas == null ? "default" : "outline"} className="ml-auto h-7 text-xs" onClick={() => onChange(null)}>Selecionar tudo</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {p.causas.map((c) => (
          <button key={c.causa} type="button" onClick={() => alternar(c.causa)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${marcada(c.causa) ? "border-primary bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            {c.causa} <span className="tabular-nums opacity-70">{c.n}</span>
          </button>
        ))}
      </div>
      {causas != null && causas.length === 0 && <p className="mt-2 text-xs text-warning">Nenhum tipo marcado — o turnover fica zerado.</p>}
    </Card>
  );
}

// ---- Resumo ----------------------------------------------------------------------

function Resumo({ p }: { p: PainelTurnover }) {
  const ano = turnoverDoAno(p);
  const meses = dozeMeses(p).map((m) => ({ ...m, rotulo: MESES[Number(m.mes.slice(5)) - 1] }));
  const passados = meses.filter((m) => m.taxa != null);
  const contratos = useMemo(() => turnoverPorContrato(p), [p]);
  const doGrupo = [...contratos].sort((a, b) => (b.grupo ?? 0) - (a.grupo ?? 0)).slice(0, 12);
  const doProprio = [...contratos].filter((c) => c.proprio != null).sort((a, b) => (b.proprio ?? 0) - (a.proprio ?? 0)).slice(0, 12);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-semibold">Turnover geral {p.meses?.length && p.meses.length < 12 ? `${rotuloMeses(p.meses)} ${p.ano}` : p.ano}</p>
          <p className="text-xs text-muted-foreground">Turnover aceitável no ano é de {META_ANUAL}%</p>
          <div className="mt-3 flex items-end gap-4">
            <p className={`text-4xl font-black tabular-nums ${ano.acimaDaMeta ? "text-destructive" : "text-foreground"}`}>{pct(ano.taxa)}</p>
            <div className="pb-1 text-xs text-muted-foreground">
              <div><b className="tabular-nums text-foreground">{ano.demissoes.toLocaleString("pt-BR")}</b> demissões</div>
              <div>efetivo médio <b className="tabular-nums text-foreground">{Math.round(p.efetivo_medio).toLocaleString("pt-BR")}</b></div>
            </div>
          </div>
          <BarraMeta valor={ano.taxa} meta={META_ANUAL} />
          {p.fator_projecao > 1.001 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Projeção para o ano: <b className={ano.projecao > META_ANUAL ? "text-destructive" : "text-success"}>{pct(ano.projecao)}</b>
            </p>
          )}
        </Card>
        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Turnover mês a mês</p>
          <p className="text-xs text-muted-foreground">Turnover aceitável no mês é de {pct(META_MENSAL)} (demissões ÷ efetivo no fim do mês)</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={meses} margin={{ top: 22, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} interval={0} tickFormatter={(m: string) => m.slice(0, 3)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number) => [pct(v), "Turnover"]} labelFormatter={(l) => l} />
              <ReferenceLine y={META_MENSAL} stroke={AMBAR} strokeDasharray="5 4" label={{ value: `meta ${pct(META_MENSAL)}`, position: "insideTopRight", fontSize: 10, fill: AMBAR }} />
              <Bar dataKey="taxa" radius={[4, 4, 0, 0]}>
                {meses.map((m) => <Cell key={m.mes} fill={(m.taxa ?? 0) > META_MENSAL ? VERMELHO : VERDE} />)}
                <LabelList dataKey="taxa" position="top" fontSize={10} formatter={(v: number | null) => (v == null ? "" : pct(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-4">
        <p className="mb-1 text-sm font-semibold">Demissões por período</p>
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={passados} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickFormatter={rotuloMes} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number, _n, item) => [`${v} demissões (efetivo ${item.payload.efetivo})`, ""]} labelFormatter={(l) => rotuloMes(String(l))} />
            <Bar dataKey="demissoes" fill={AZUL} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="demissoes" position="top" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-semibold">Turnover geral por empresa</p>
          <p className="text-xs text-muted-foreground">Meta de {META_ANUAL}% no ano</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={p.por_empresa} margin={{ top: 22, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="empresa" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, _n, item) => [`${pct(v)} — ${item.payload.demissoes} demissões / efetivo médio ${item.payload.efetivo_medio}`, ""]} />
              <ReferenceLine y={META_ANUAL} stroke={AMBAR} strokeDasharray="5 4" />
              <Bar dataKey="taxa" radius={[4, 4, 0, 0]}>
                {p.por_empresa.map((e) => <Cell key={e.empresa} fill={(e.taxa ?? 0) > META_ANUAL ? VERMELHO : (e.taxa ?? 0) > META_ANUAL * 0.75 ? AMBAR : VERDE} />)}
                <LabelList dataKey="taxa" position="top" fontSize={10} formatter={(v: number) => pct(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <RankingContratos titulo="Turnover por contrato" subtitulo="Em relação ao efetivo geral do grupo" itens={doGrupo.map((c) => ({ nome: c.nome, valor: c.grupo ?? 0, dica: `${c.demissoes} demissões` }))} cor={() => AZUL} />
        <RankingContratos titulo="Turnover por contrato" subtitulo="Em relação ao próprio contrato" itens={doProprio.map((c) => ({ nome: c.nome, valor: c.proprio ?? 0, dica: `${c.demissoes} demissões` }))}
          cor={(v) => (v > META_ANUAL ? VERMELHO : v > META_ANUAL * 0.75 ? AMBAR : VERDE)} />
      </div>
    </>
  );
}

function BarraMeta({ valor, meta }: { valor: number; meta: number }) {
  const escala = Math.max(valor, meta) * 1.15 || 1;
  return (
    <div className="relative mb-5 mt-3 h-3 rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (valor / escala) * 100)}%`, background: valor > meta ? VERMELHO : AMBAR }} />
      <div className="absolute -top-1 h-5 w-0.5 bg-foreground/70" style={{ left: `${(meta / escala) * 100}%` }} title={`Meta ${meta}%`} />
      <span className="absolute top-4 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-muted-foreground" style={{ left: `${(meta / escala) * 100}%` }}>meta {meta}%</span>
    </div>
  );
}

function RankingContratos({ titulo, subtitulo, itens, cor }: {
  titulo: string; subtitulo: string; itens: { nome: string; valor: number; dica: string }[]; cor: (v: number) => string;
}) {
  const max = Math.max(...itens.map((i) => i.valor), 0.01);
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="mb-3 text-xs text-muted-foreground">{subtitulo}</p>
      {itens.length === 0 ? <p className="text-xs text-muted-foreground">Sem demissões no período.</p> : (
        <div className="space-y-1.5">
          {itens.map((i) => (
            <div key={i.nome} className="text-[11px]" title={`${i.nome} — ${i.dica}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-muted-foreground">{i.nome}</span>
                <span className="shrink-0 font-semibold tabular-nums">{pct(i.valor)}</span>
              </div>
              <div className="h-2 rounded-sm bg-muted"><div className="h-full rounded-sm" style={{ width: `${(i.valor / max) * 100}%`, background: cor(i.valor) }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---- Analistas -------------------------------------------------------------------

const TITULO: Record<TipoLimite, string> = { trabalhado: "% Aviso trabalhado", indenizado: "% Aviso indenizado", demissao: "% De demissão" };

function Analistas({ p }: { p: PainelTurnover }) {
  const tipos: TipoLimite[] = ["trabalhado", "indenizado", "demissao"];
  const linhas = useMemo(() => Object.fromEntries(tipos.map((t) => [t, analistas(p, t)])) as Record<TipoLimite, LinhaAnalista[]>, [p]);
  const tabela = useMemo(() => [...p.por_contrato].filter((c) => c.efetivo_atual > 0).sort((a, b) => nomeContrato(a.contrato).localeCompare(nomeContrato(b.contrato))), [p]);
  const proj = p.fator_projecao > 1.001;

  return (
    <>
      <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <p>
          O tipo de aviso vem das solicitações feitas em <b className="text-foreground">Solicitar Demissão</b> no ERP (sem canceladas e reprovadas) — demissões anteriores ao ERP não têm aviso registrado.
          Os limites são sobre o efetivo atual de cada contrato, no ano.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {tipos.map((t) => <Mostrador key={t} titulo={TITULO[t]} total={totalAnalistas(p, t)} mostrarProjecao={proj} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {tipos.map((t) => (
          <Card key={t} className="p-4">
            <p className="text-sm font-semibold">{TITULO[t]} por contrato (até {LIMITES[t]}%)</p>
            <p className="mb-3 text-xs text-muted-foreground">Acumulado atual{proj ? " e, embaixo, a projeção do ano" : ""}</p>
            <div className="space-y-2">
              {linhas[t].filter((l) => l.qtd > 0).slice(0, 10).map((l) => (
                <div key={l.contrato} className="text-[11px]" title={`${l.nome}: ${l.qtd} de ${l.limite} (efetivo ${l.efetivo})`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">{l.nome}</span>
                    <span className={`font-semibold tabular-nums ${l.estourou ? "text-destructive" : ""}`}>{pct(l.pct)}</span>
                  </div>
                  <div className="h-2 rounded-sm bg-muted"><div className="h-full rounded-sm" style={{ width: `${Math.min(100, (l.pct / LIMITES[t]) * 100)}%`, background: l.estourou ? VERMELHO : VERDE }} /></div>
                  {proj && <div className={`text-right tabular-nums ${l.vaiEstourar ? "text-destructive" : "text-success"}`}>projeção {pct(l.projecao)}</div>}
                </div>
              ))}
              {linhas[t].every((l) => l.qtd === 0) && <p className="text-xs text-muted-foreground">Nenhum registro no período.</p>}
            </div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden p-0">
        <div className="px-4 pt-4">
          <p className="text-sm font-semibold">Quantidade por contrato</p>
          <p className="text-xs text-muted-foreground">Acumulado atual / limite do ano (efetivo × limite, arredondado para cima)</p>
        </div>
        <div className="mt-3 max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-2 font-medium">Contrato</th>
                <th className="px-2 py-2 text-right font-medium">Efetivo</th>
                <th className="px-2 py-2 text-right font-medium">Aviso trabalhado</th>
                <th className="px-2 py-2 text-right font-medium">Aviso indenizado</th>
                <th className="px-4 py-2 text-right font-medium">Demissões</th>
              </tr>
            </thead>
            <tbody>
              {tabela.map((c) => (
                <tr key={c.contrato} className="border-t">
                  <td className="px-4 py-1.5">{nomeContrato(c.contrato)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.efetivo_atual}</td>
                  <Qtd valor={c.aviso_trabalhado} efetivo={c.efetivo_atual} tipo="trabalhado" />
                  <Qtd valor={c.aviso_indenizado} efetivo={c.efetivo_atual} tipo="indenizado" />
                  <Qtd valor={c.demissoes_todas} efetivo={c.efetivo_atual} tipo="demissao" ultima />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Qtd({ valor, efetivo, tipo, ultima }: { valor: number; efetivo: number; tipo: TipoLimite; ultima?: boolean }) {
  const limite = Math.ceil((efetivo * LIMITES[tipo]) / 100);
  return (
    <td className={`${ultima ? "px-4" : "px-2"} py-1.5 text-right tabular-nums`}>
      <span className={valor > limite ? "font-bold text-destructive" : valor > 0 ? "font-semibold" : "text-muted-foreground"}>{valor}</span>
      <span className="text-muted-foreground"> / {limite}</span>
    </td>
  );
}

/** Meio-círculo com o % atual frente ao limite, e a projeção ao lado. */
function Mostrador({ titulo, total, mostrarProjecao }: { titulo: string; total: ReturnType<typeof totalAnalistas>; mostrarProjecao: boolean }) {
  const cheio = Math.min(total.pct / total.limite, 1);
  const estourou = total.pct > total.limite;
  const dados = [{ v: cheio }, { v: 1 - cheio }];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{titulo}</p>
          <p className="text-xs text-muted-foreground">Limite de {total.limite}% do efetivo total no ano</p>
        </div>
        {mostrarProjecao && (
          <div className="rounded-md border px-2 py-1 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Projeção</p>
            <p className={`text-lg font-bold tabular-nums ${total.projecao > total.limite ? "text-destructive" : "text-success"}`}>{pct(total.projecao)}</p>
          </div>
        )}
      </div>
      <div className="relative mx-auto mt-1 h-28 w-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={dados} dataKey="v" startAngle={180} endAngle={0} cx="50%" cy="100%" innerRadius="140%" outerRadius="190%" stroke="none" isAnimationActive={false}>
              <Cell fill={estourou ? VERMELHO : VERDE} />
              <Cell fill="hsl(var(--muted))" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <p className="absolute inset-x-0 bottom-0 text-center text-2xl font-black tabular-nums">{pct(total.pct)}</p>
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground">{total.qtd.toLocaleString("pt-BR")} sobre efetivo de {total.efetivo.toLocaleString("pt-BR")}</p>
    </Card>
  );
}
