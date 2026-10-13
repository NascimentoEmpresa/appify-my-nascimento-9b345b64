// =====================================================================
// 3. DETALHAMENTO DO POSTO (/app/operacional/efetividade/posto?c=&p=&d=)
//
// Um posto por inteiro: quem a escala põe nele no dia e a situação de cada
// um, a cobertura da falta passo a passo, o local (mapa pelo endereço do
// contrato), os contatos para ligar/WhatsApp, as ausências dos últimos 30
// dias e as observações do Operacional.
// =====================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  ArrowLeft, Building2, CalendarDays, Clock, ExternalLink, FileText, History, MapPin, MessageSquare, Phone, Plus,
  Shield, Trash2, UserCog, Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEfetAcoes, useEfetBase, useEfetDiaristas, useEfetObsPosto, useEfetOcorrencias, usePodeAlterarEfetividade,
} from "@/hooks/useEfetividade";
import {
  avaliarDia, chaveContrato, chavePosto, diasEntre, estadoCobertura, fmtDataBR, fmtDuracao, fmtHoraTs, fmtMin, minutosEntre, pct,
  resumir, somaDias, AUSENCIAS, ROTULO_MOTIVO, ROTULO_SITUACAO, ROTULO_TURNO, type LinhaDia, type Ocorrencia,
} from "@/lib/efetividade";
import {
  AvisoSincronizacao, BadgeSituacao, BadgeStatus, BASE_ROTA, CabecalhoEfetividade, Carregando, Contato, Erro, Secao, Vazio,
  useDiaEfetividade, useFiltros,
} from "./shared";
import { AcionarDialog, LinhaDoTempo, PainelOcorrencia } from "./acoes";

export default function DetalhePosto() {
  const qc = useQueryClient();
  const pode = usePodeAlterarEfetividade();
  const { filtros, set } = useFiltros();
  // O dia do posto: todos os postos do contrato (o filtro de posto é local).
  const d = useDiaEfetividade({ ...filtros, posto: null, turno: null, encarregado: null });
  const [acionar, setAcionar] = useState<{ l: LinhaDia | null; o: Ocorrencia | null } | null>(null);
  const [ocSel, setOcSel] = useState<number | null>(null);

  const doPosto = useMemo(() => d.linhas.filter((l) => filtros.posto && chavePosto(l.p.c) === filtros.posto), [d.linhas, filtros.posto]);
  const ref = doPosto[0]?.p.c;
  const contrato = filtros.contrato ? d.contratoMap.get(filtros.contrato) : null;

  // Seletor quando o posto ainda não foi escolhido.
  const opcContratos = useMemo(() => d.contratos.map((c) => ({ value: chaveContrato(c.empresa, c.filial), label: c.nome })), [d.contratos]);
  const opcPostos = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of d.linhas) if (!filtros.contrato || chaveContrato(l.p.c.empresa, l.p.c.filial) === filtros.contrato) m.set(chavePosto(l.p.c), l.p.c.posto_nome);
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [d.linhas, filtros.contrato]);

  const ocorrenciasPosto = useMemo(() => d.ocorrencias.filter((o) => o.data === d.data && (
    doPosto.some((l) => l.p.c.id === o.empregado_id) || (!!ref && o.posto_nome === ref.posto_nome && o.filial === ref.filial))), [d.ocorrencias, d.data, doPosto, ref]);
  const ocAtual = ocorrenciasPosto.find((o) => o.id === ocSel) ?? ocorrenciasPosto.find((o) => !["ponto_confirmado", "cancelada", "nao_se_aplica"].includes(o.status)) ?? ocorrenciasPosto[ocorrenciasPosto.length - 1] ?? null;

  const r = resumir(doPosto.map((l) => l.dia));
  const cobertos = doPosto.filter((l) => l.cobertura === "coberto" || l.cobertura === "em_andamento").length;
  const descob = doPosto.filter((l) => l.cobertura === "descoberto" && AUSENCIAS.includes(l.dia.situacao)).length;
  const turnos = [...new Set(doPosto.map((l) => l.p.jornada.inicio != null ? `${fmtMin(l.p.jornada.inicio)} – ${fmtMin(l.p.jornada.fim)}` : ROTULO_TURNO[l.p.turno]))];

  // Histórico de 30 dias do contrato (só ele: base pequena).
  const iniHist = d.data ? somaDias(d.data, -29) : null;
  const hist = useEfetBase(ref ? iniHist : null, ref ? d.data : null, ref?.empresa ?? null, ref?.filial ?? null);
  const ocsHist = useEfetOcorrencias(ref ? iniHist : null, ref ? d.data : null);
  const historico = useMemo(() => {
    if (!ref || !iniHist || !d.data) return [];
    const preps = hist.preps.filter((p) => chavePosto(p.c) === filtros.posto);
    const sinc = hist.data?.sincronizado_ate ?? d.sincAte;
    const out: { data: string; nome: string; situacao: string; o: Ocorrencia | null; inicio: number | null }[] = [];
    for (const dia of diasEntre(iniHist, d.data).reverse()) {
      for (const p of preps) {
        const a = avaliarDia(p, dia, sinc);
        const o = (ocsHist.data ?? []).find((x) => x.data === dia && x.empregado_id === p.c.id) ?? null;
        if (AUSENCIAS.includes(a.situacao) || (o && o.status !== "cancelada")) out.push({ data: dia, nome: p.c.nome, situacao: o ? ROTULO_MOTIVO[o.motivo] : ROTULO_SITUACAO[a.situacao], o, inicio: p.jornada.inicio });
      }
    }
    return out.slice(0, 40);
  }, [hist.preps, hist.data, ocsHist.data, ref, iniHist, d.data, d.sincAte, filtros.posto]);

  const { data: diaristas = [] } = useEfetDiaristas();
  const diaristaLivre = diaristas.find((x) => x.disponivel && x.telefone && !x.em_aberto);
  const faltante = doPosto.find((l) => AUSENCIAS.includes(l.dia.situacao));
  const endereco = contrato?.endereco ? `${contrato.endereco}${contrato.cep ? `, ${contrato.cep}` : ""}` : null;
  const ehSubstitutoAqui = (id: number) => ocorrenciasPosto.find((o) => o.substituto_empregado_id === id);

  if (!filtros.posto || (!d.carregando && !ref)) {
    return (
      <div>
        <CabecalhoEfetividade titulo="Detalhamento do Posto" icone={FileText} subtitulo="Escolha o contrato e o posto." data={d.data} sincAte={d.sincAte} />
        <Erro erro={d.erro} />
        <Card className="grid gap-3 p-4 md:grid-cols-2">
          <div className="space-y-1 text-xs font-semibold">Contrato
            <SearchableSelect value={filtros.contrato ?? ""} onChange={(v) => set({ c: v || null, p: null })} options={opcContratos} placeholder="Escolha o contrato" searchPlaceholder="Buscar…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Posto
            <SearchableSelect value={filtros.posto ?? ""} onChange={(v) => set({ p: v || null })} options={opcPostos} disabled={d.carregando} placeholder={d.carregando ? "Carregando…" : "Escolha o posto"} searchPlaceholder="Buscar…" />
          </div>
          {filtros.posto && !ref && !d.carregando && <p className="text-sm text-muted-foreground md:col-span-2">Ninguém da escala neste posto na data escolhida.</p>}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <CabecalhoEfetividade
        titulo="Detalhamento do Posto" icone={FileText}
        subtitulo="A escala completa, os colaboradores, as faltas e o andamento das coberturas do posto."
        data={d.data} sincAte={d.sincAte}
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={d.base.isFetching}
        extra={<Button variant="outline" asChild className="gap-1"><Link to={`${BASE_ROTA}/postos?${new URLSearchParams({ ...(filtros.contrato ? { c: filtros.contrato } : {}), ...(d.data ? { d: d.data } : {}) })}`}><ArrowLeft className="h-4 w-4" />Voltar para a lista</Link></Button>}
      />
      <Erro erro={d.erro} />
      <AvisoSincronizacao data={d.data} sincAte={d.sincAte} />

      {d.carregando || !ref ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,1fr)]">
            <Card className="flex gap-4 p-4">
              <div className="hidden h-28 w-36 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex"><Shield className="h-12 w-12" /></div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-2xl font-bold text-primary">{ref.posto_nome}</h2>
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", descob ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
                    {descob ? `${descob} descoberto(s)` : "Em operação"}
                  </span>
                </div>
                <div className="grid gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
                  <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" />Contrato: <b className="truncate text-foreground">{ref.contrato}</b></span>
                  <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />Empresa: <b className="truncate text-foreground">{contrato?.empresa_nome ?? "—"}</b></span>
                  <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Turno: <b className="text-foreground">{turnos.join(" · ") || "—"}</b></span>
                  <span className="flex items-center gap-1.5"><Shield className="h-4 w-4" />Código: <b className="text-foreground">{ref.posto_codigo ?? "—"}</b></span>
                  <span className="flex items-center gap-1.5"><UserCog className="h-4 w-4" />Encarregado: <b className="truncate text-foreground">{contrato?.encarregados.map((e) => e.nome).join(", ") || "sem responsável na Hierarquia"}</b></span>
                  <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /><span className="truncate">{endereco ?? "endereço não cadastrado em CONTRATOS"}</span></span>
                </div>
              </div>
            </Card>

            <Card className="flex flex-col items-center justify-center gap-1 p-4">
              <p className="text-sm font-semibold">Efetividade do posto</p>
              <Anel v={r.efetividade} />
            </Card>

            <div className="grid grid-cols-3 gap-2">
              <MiniKpi r="Previstos" v={r.previsto} />
              <MiniKpi r="Presentes" v={r.presentes} cor="text-success" />
              <MiniKpi r="Faltas" v={r.faltas + r.atestados + r.afastamentos} cor="text-destructive" fundo={r.faltas + r.atestados + r.afastamentos > 0} />
              <MiniKpi r="Coberturas" v={cobertos} cor="text-info" />
              <MiniKpi r="Descobertos" v={descob} cor="text-destructive" fundo={descob > 0} span />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Secao titulo={`Escala do Posto — ${fmtDataBR(d.data)}`} icone={CalendarDays}
              acoes={<div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => d.data && set({ d: somaDias(d.data, -1) })}>‹ dia</Button>
                <Button size="sm" variant="ghost" onClick={() => d.data && set({ d: somaDias(d.data, 1) })}>dia ›</Button>
              </div>}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs"><tr><th className="p-2">#</th><th className="p-2 text-left">Colaborador</th><th className="p-2 text-left">Função</th><th className="p-2">Tipo</th><th className="p-2">Horário</th><th className="p-2">Situação</th><th className="p-2 text-left">Cobertura</th><th className="p-2">Ponto</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {doPosto.map((l, i) => {
                      const sub = ehSubstitutoAqui(l.p.c.id);
                      const aus = AUSENCIAS.includes(l.dia.situacao);
                      return (
                        <tr key={l.p.c.id} className="border-t">
                          <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                          <td className="p-2 font-semibold">{l.p.c.nome}</td>
                          <td className="max-w-[140px] truncate p-2 text-xs">{l.p.c.cargo}</td>
                          <td className="p-2 text-center text-xs">{sub ? "Substituto" : "Titular"}</td>
                          <td className="whitespace-nowrap p-2 text-center text-xs tabular-nums">{fmtMin(l.p.jornada.inicio)} – {fmtMin(l.p.jornada.fim)}</td>
                          <td className="p-2 text-center"><BadgeSituacao s={l.dia.situacao} /></td>
                          <td className="p-2 text-xs">{sub ? `(para ${sub.empregado_nome})` : l.ocorrencia?.substituto_nome ?? "—"}</td>
                          <td className={cn("p-2 text-center text-xs font-semibold tabular-nums", l.dia.atraso ? "text-warning" : "text-success")}>{fmtMin(l.dia.entrada)}</td>
                          <td className="p-2 text-right">
                            {pode && aus && l.cobertura === "descoberto" && <Button size="sm" className="gap-1" onClick={() => setAcionar({ l, o: l.ocorrencia })}><Phone className="h-3 w-3" />Acionar</Button>}
                            {l.ocorrencia && <Button size="sm" variant="outline" onClick={() => setOcSel(l.ocorrencia!.id)}>Ver</Button>}
                          </td>
                        </tr>
                      );
                    })}
                    {ocorrenciasPosto.filter((o) => o.substituto_nome && o.substituto_tipo === "diarista").map((o, i) => (
                      <tr key={`s${o.id}`} className="border-t bg-success/5">
                        <td className="p-2 text-center text-muted-foreground">{doPosto.length + i + 1}</td>
                        <td className="p-2 font-semibold">{o.substituto_nome}</td>
                        <td className="p-2 text-xs">Diarista</td>
                        <td className="p-2 text-center text-xs">Substituto</td>
                        <td className="p-2 text-center text-xs tabular-nums">{fmtMin(o.horario_previsto)}</td>
                        <td className="p-2 text-center"><BadgeStatus s={o.status} /></td>
                        <td className="p-2 text-xs">(para {o.empregado_nome})</td>
                        <td className="p-2 text-center text-xs tabular-nums">{fmtHoraTs(o.ponto_em)}</td>
                        <td className="p-2 text-right"><Button size="sm" variant="outline" onClick={() => setOcSel(o.id)}>Ver</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Secao>

            <Secao titulo="Mapa e Informações do Local" icone={MapPin}
              acoes={endereco && <Button size="sm" variant="outline" asChild className="gap-1"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(endereco)}`} target="_blank" rel="noreferrer">Ver rota<ExternalLink className="h-3 w-3" /></a></Button>}>
              {endereco ? (
                <iframe title="Mapa do posto" className="h-56 w-full border-0" loading="lazy" referrerPolicy="no-referrer"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(endereco)}&z=15&output=embed`} />
              ) : <Vazio texto="O contrato não tem endereço cadastrado (CONTRATOS › Endereço)." />}
              {endereco && <p className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{endereco}</p>}
            </Secao>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Secao titulo="Linha do Tempo da Cobertura" icone={Clock}
              acoes={ocorrenciasPosto.length > 1 && (
                <select className="rounded-md border bg-background px-2 py-1 text-xs" value={ocAtual?.id ?? ""} onChange={(e) => setOcSel(+e.target.value)}>
                  {ocorrenciasPosto.map((o) => <option key={o.id} value={o.id}>{o.empregado_nome}</option>)}
                </select>
              )}>
              {ocAtual ? (
                <div className="space-y-4 p-4">
                  <LinhaDoTempo o={ocAtual} />
                  <PainelOcorrencia o={ocAtual} onAcionar={() => setAcionar({ l: doPosto.find((l) => l.p.c.id === ocAtual.empregado_id) ?? null, o: ocAtual })} />
                </div>
              ) : <Vazio texto={faltante ? "A ausência ainda não tem cobertura — use Acionar na escala." : "Nenhuma ocorrência neste posto no dia."} />}
            </Secao>

            <Secao titulo="Contatos Rápidos" icone={Phone}>
              <div className="px-3">
                {contrato?.encarregados.map((e) => <Contato key={e.id} rotulo="Encarregado" nome={e.nome} telefone={e.telefone} />)}
                {faltante && <Contato rotulo="Colaborador" nome={faltante.p.c.nome} telefone={faltante.p.c.telefone} />}
                {ocAtual?.substituto_nome && <Contato rotulo="Substituto" nome={ocAtual.substituto_nome} telefone={ocAtual.substituto_telefone} />}
                {diaristaLivre && <Contato rotulo="Diarista disponível" nome={diaristaLivre.nome} telefone={diaristaLivre.telefone} />}
                {!contrato?.encarregados.length && !faltante && !ocAtual && !diaristaLivre && <Vazio texto="Sem contatos para este posto." />}
              </div>
            </Secao>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <Secao titulo="Histórico de Ocorrências do Posto" icone={History} sub="Ausências dos últimos 30 dias, pelo ponto e pelos registros">
              {hist.isLoading ? <Carregando texto="Lendo 30 dias de ponto…" /> : (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Colaborador</th><th className="p-2">Tipo</th><th className="p-2">Situação</th><th className="p-2 text-left">Cobertura</th><th className="p-2">Início</th><th className="p-2">Fim</th><th className="p-2">Tempo</th></tr></thead>
                    <tbody>
                      {historico.map((h, i) => {
                        const est = estadoCobertura(h.o);
                        const fim = h.o?.chegada_em ?? h.o?.ponto_em;
                        const inicioTs = h.o?.acionado_em ?? h.o?.created_at;
                        return (
                          <tr key={i} className="border-t">
                            <td className="p-2 tabular-nums">{fmtDataBR(h.data)}</td>
                            <td className="p-2">{h.nome}</td>
                            <td className="p-2 text-center"><span className="rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive">{h.situacao}</span></td>
                            <td className="p-2 text-center">{h.o ? <BadgeStatus s={h.o.status} /> : <span className="text-destructive">Não coberto</span>}</td>
                            <td className="p-2">{h.o?.substituto_nome ? `(${h.o.substituto_nome})` : "—"}</td>
                            <td className="p-2 text-center tabular-nums">{fmtMin(h.inicio)}</td>
                            <td className="p-2 text-center tabular-nums">{fim ? fmtHoraTs(fim) : "—"}</td>
                            <td className="p-2 text-center tabular-nums">{est === "coberto" || fim ? fmtDuracao(minutosEntre(inicioTs, fim)) : "—"}</td>
                          </tr>
                        );
                      })}
                      {!historico.length && <tr><td colSpan={8}><Vazio texto="Nenhuma ausência neste posto em 30 dias." /></td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>

            <ObservacoesPosto empresa={ref.empresa} filial={ref.filial} posto={ref.posto_codigo || ref.posto_nome} />
          </div>
        </div>
      )}

      {acionar && d.data && (
        <AcionarDialog open onOpenChange={(v) => !v && setAcionar(null)} linha={acionar.l} ocorrencia={acionar.o} data={d.data} sincAte={d.sincAte}
          candidatos={d.linhas.filter((l) => chaveContrato(l.p.c.empresa, l.p.c.filial) === filtros.contrato && (l.dia.situacao === "folga" || l.dia.situacao === "presente"))} />
      )}
    </div>
  );
}

function MiniKpi({ r, v, cor, fundo, span }: { r: string; v: number; cor?: string; fundo?: boolean; span?: boolean }) {
  return (
    <Card className={cn("flex flex-col items-center justify-center p-2", fundo && "bg-destructive/5", span && "col-span-2")}>
      <p className={cn("text-xs font-semibold", fundo ? "text-destructive" : "text-muted-foreground")}>{r}</p>
      <p className={cn("text-2xl font-bold tabular-nums", cor)}>{v}</p>
    </Card>
  );
}

function Anel({ v }: { v: number | null }) {
  const p = Math.max(0, Math.min(1, v ?? 0));
  const R = 38, C = 2 * Math.PI * R;
  const cor = v == null ? "hsl(var(--muted-foreground))" : p >= 0.95 ? "hsl(var(--success))" : p >= 0.91 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28" role="img" aria-label={`Efetividade ${pct(v)}`}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
      <circle cx="50" cy="50" r={R} fill="none" stroke={cor} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 50 50)" />
      <text x="50" y="55" textAnchor="middle" className="fill-foreground text-[15px] font-bold">{pct(v)}</text>
    </svg>
  );
}

function ObservacoesPosto({ empresa, filial, posto }: { empresa: number; filial: number; posto: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const pode = usePodeAlterarEfetividade();
  const { data: obs = [], isLoading } = useEfetObsPosto(posto);
  const { adicionarObs, removerObs } = useEfetAcoes();
  const [texto, setTexto] = useState("");
  const [abrir, setAbrir] = useState(false);

  const salvar = async () => {
    try { await adicionarObs.mutateAsync({ empresa, filial, posto, texto }); setTexto(""); setAbrir(false); }
    catch (e) { toast({ title: "Não foi possível salvar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  return (
    <Secao titulo="Observações do Posto" icone={MessageSquare}
      acoes={pode && <Button size="sm" variant="outline" className="gap-1" onClick={() => setAbrir((x) => !x)}><Plus className="h-4 w-4" />Adicionar</Button>}>
      {abrir && (
        <div className="space-y-2 border-b p-3">
          <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: posto com movimento intenso pela manhã." />
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setAbrir(false)}>Cancelar</Button><Button size="sm" disabled={!texto.trim() || adicionarObs.isPending} onClick={salvar}>Salvar</Button></div>
        </div>
      )}
      <div className="max-h-72 divide-y overflow-auto">
        {isLoading && <Carregando texto="Carregando…" />}
        {obs.map((o) => (
          <div key={o.id} className="flex gap-3 p-3 text-sm">
            <div className="w-28 shrink-0 text-xs text-muted-foreground">
              <p>{new Date(o.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              <p className="truncate font-semibold text-foreground">{o.autor_nome}</p>
            </div>
            <p className="flex-1 whitespace-pre-wrap">{o.texto}</p>
            {o.autor_id === user?.id && (
              <button title="Apagar" onClick={() => removerObs.mutate(o.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
        ))}
        {!isLoading && !obs.length && <Vazio texto="Sem observações." />}
      </div>
    </Secao>
  );
}

