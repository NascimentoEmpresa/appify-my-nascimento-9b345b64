// =====================================================================
// 2. CONTROLE DE POSTOS (/app/operacional/efetividade/postos)
//
// Cada colaborador previsto no dia, no seu posto: presente, faltou, de
// atestado; se há cobertura, quem é o substituto e em que pé está; a hora da
// entrada no relógio. Ao lado, os postos do contrato num mosaico, o resumo
// por turno e os postos que pedem atenção.
// =====================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertTriangle, BarChart3, Download, FileText, LayoutGrid, Phone, RefreshCw, Search, Stethoscope, UserCheck, UserMinus, UserX, Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePodeAlterarEfetividade } from "@/hooks/useEfetividade";
import {
  agrupar, chaveContrato, chavePosto, descoberto, fmtDuracao, fmtMin, pct, resumir, tempoSemCobertura, baixarCsv,
  AUSENCIAS, ROTULO_SITUACAO, ROTULO_TURNO, type LinhaDia, type SituacaoEfet, type Turno,
} from "@/lib/efetividade";
import {
  AvisoSincronizacao, BadgeSituacao, BadgeStatus, BarraFiltros, CabecalhoEfetividade, Carregando, CelulaPct, Erro, Kpi, Paginacao,
  Secao, Vazio, linkPosto, useDiaEfetividade, useFiltros,
} from "./shared";
import { AcionarDialog } from "./acoes";

const ORDEM: Record<SituacaoEfet, number> = {
  falta: 0, atestado: 1, afastamento: 2, aguardando: 3, presente: 4, ferias: 5, folga: 6, feriado: 7, sem_registro: 8, fora_contrato: 9,
};

export default function ControlePostos() {
  const qc = useQueryClient();
  const pode = usePodeAlterarEfetividade();
  const { filtros, set, limpar } = useFiltros();
  const d = useDiaEfetividade(filtros);
  const [situacao, setSituacao] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [acionar, setAcionar] = useState<LinhaDia | null>(null);

  // Opções de posto: do contrato escolhido (ou de todos).
  const postos = useMemo(() => {
    const m = new Map<string, { value: string; label: string; n: number }>();
    for (const l of d.linhas) {
      const k = chavePosto(l.p.c);
      if (!m.has(k)) m.set(k, { value: k, label: l.p.c.posto_nome, n: 0 });
      m.get(k)!.n++;
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")).map((x) => ({ value: x.value, label: x.label, hint: `${x.n} pessoa(s)` }));
  }, [d.linhas]);

  const r = useMemo(() => resumir(d.linhas.map((l) => l.dia)), [d.linhas]);
  const rOntem = useMemo(() => resumir(d.linhasOntem.map((l) => l.dia)), [d.linhasOntem]);
  const coberturas = d.linhas.filter((l) => l.cobertura === "coberto").length;
  const descobertos = d.linhas.filter(descoberto);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return d.linhas
      .filter((l) => !situacao || l.dia.situacao === situacao || (situacao === "ausencias" && AUSENCIAS.includes(l.dia.situacao)))
      .filter((l) => !q || l.p.c.nome.toLowerCase().includes(q) || l.p.c.posto_nome.toLowerCase().includes(q) || String(l.p.c.cadastro ?? "").includes(q))
      .sort((a, b) => ORDEM[a.dia.situacao] - ORDEM[b.dia.situacao] || a.p.c.posto_nome.localeCompare(b.p.c.posto_nome, "pt-BR") || a.p.c.nome.localeCompare(b.p.c.nome, "pt-BR"));
  }, [d.linhas, situacao, busca]);
  const pag = visiveis.slice((pagina - 1) * porPagina, pagina * porPagina);

  const porTurno = useMemo(() => {
    const g = agrupar(d.linhas, (l) => l.p.turno);
    return (["manha", "tarde", "noite", "flexivel"] as Turno[]).map((t) => ({ t, g: g.get(t) })).filter((x) => x.g);
  }, [d.linhas]);

  const porPosto = useMemo(() => [...agrupar(d.linhas, (l) => chavePosto(l.p.c)).values()]
    .filter((g) => g.previsto > 0)
    .sort((a, b) => b.descobertos - a.descobertos || (a.efetividade ?? 1) - (b.efetividade ?? 1)), [d.linhas]);

  const contrato = filtros.contrato ? d.contratoMap.get(filtros.contrato) : null;

  const exportar = () => baixarCsv(`postos_${d.data}_${contrato?.nome ?? "todos"}.csv`, [
    ["Contrato", "Posto", "Turno", "Horário previsto", "Matrícula", "Colaborador", "Cargo", "Situação", "Entrada no ponto", "Cobertura", "Substituto", "Status da cobertura"],
    ...visiveis.map((l) => [l.p.c.contrato, l.p.c.posto_nome, ROTULO_TURNO[l.p.turno], fmtMin(l.p.jornada.inicio), l.p.c.cadastro, l.p.c.nome, l.p.c.cargo,
      ROTULO_SITUACAO[l.dia.situacao], fmtMin(l.dia.entrada), l.cobertura ?? "", l.ocorrencia?.substituto_nome ?? "", l.ocorrencia?.status ?? ""]),
  ]);

  const candidatos = acionar ? d.linhas.filter((l) => chaveContrato(l.p.c.empresa, l.p.c.filial) === chaveContrato(acionar.p.c.empresa, acionar.p.c.filial)
    && (l.dia.situacao === "folga" || l.dia.situacao === "presente")) : [];

  return (
    <div>
      <CabecalhoEfetividade
        titulo="Controle de Postos" icone={Users}
        subtitulo={contrato ? contrato.nome : "A situação de cada posto e colaborador: presença, faltas e coberturas."}
        data={d.data} sincAte={d.sincAte} ultimaSinc={d.base.data?.ultima_sincronizacao}
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={d.base.isFetching}
      />
      <BarraFiltros contratos={d.contratos} filtros={filtros} set={(p) => { setPagina(1); set(p); }} limpar={() => { setSituacao(""); limpar(); }}
        sincAte={d.sincAte} postos={postos} mostrar={["data", "contrato", "posto", "turno"]} />
      <Erro erro={d.erro} />
      <AvisoSincronizacao data={d.data} sincAte={d.sincAte} />

      {d.carregando ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <Kpi icon={Users} rotulo="Efetivo previsto" valor={r.previsto} anterior={rOntem.previsto} tom="info" onClick={() => setSituacao("")} ativo={!situacao} />
            <Kpi icon={UserCheck} rotulo="Presentes" valor={r.presentes} anterior={rOntem.presentes} tom="success" dica={pct(r.efetividade)} onClick={() => setSituacao("presente")} ativo={situacao === "presente"} />
            <Kpi icon={UserX} rotulo="Faltas" valor={r.faltas} anterior={rOntem.faltas} tom="destructive" melhorSobe={false} onClick={() => setSituacao("falta")} ativo={situacao === "falta"} />
            <Kpi icon={Stethoscope} rotulo="Atestados" valor={r.atestados} anterior={rOntem.atestados} tom="violet" melhorSobe={false} onClick={() => setSituacao("atestado")} ativo={situacao === "atestado"} />
            <Kpi icon={UserMinus} rotulo="Afastamentos" valor={r.afastamentos} anterior={rOntem.afastamentos} tom="warning" melhorSobe={false} onClick={() => setSituacao("afastamento")} ativo={situacao === "afastamento"} />
            <Kpi icon={RefreshCw} rotulo="Coberturas realizadas" valor={coberturas} tom="warning" />
            <Kpi icon={AlertTriangle} rotulo="Postos descobertos" valor={descobertos.length} tom="destructive" melhorSobe={false} onClick={() => setSituacao("ausencias")} ativo={situacao === "ausencias"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Secao titulo="Lista de Postos" icone={FileText} sub={`${visiveis.length} colaborador(es) — ${r.semRegistro} sem registro de ponto ficam no fim da lista`}
              acoes={<Button size="sm" variant="outline" className="gap-1" onClick={exportar}><Download className="h-4 w-4" />Exportar</Button>}>
              <div className="flex flex-wrap gap-2 border-b p-3">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Buscar colaborador, posto ou matrícula…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
                </div>
                <SearchableSelect className="w-48" value={situacao} onChange={(v) => { setSituacao(v); setPagina(1); }} allowClear placeholder="Todas as situações"
                  options={[{ value: "ausencias", label: "Ausências (todas)" }, ...(Object.keys(ROTULO_SITUACAO) as SituacaoEfet[]).filter((s) => s !== "fora_contrato").map((s) => ({ value: s, label: ROTULO_SITUACAO[s] }))]} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs">
                    <tr>
                      <th className="p-2 text-left">Posto</th><th className="p-2 text-left">Turno</th><th className="p-2 text-left">Colaborador previsto</th>
                      <th className="p-2">Situação</th><th className="p-2">Cobertura</th><th className="p-2 text-left">Substituto</th>
                      <th className="p-2">Status da cobertura</th><th className="p-2">Ponto</th><th className="p-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pag.map((l) => {
                      const aus = AUSENCIAS.includes(l.dia.situacao);
                      return (
                        <tr key={l.p.c.id} className="border-t hover:bg-muted/30">
                          <td className="max-w-[180px] p-2">
                            <Link to={linkPosto(l, d.data)} className="block truncate font-semibold text-primary hover:underline">{l.p.c.posto_nome}</Link>
                            {!filtros.contrato && <p className="truncate text-[11px] text-muted-foreground">{l.p.c.contrato}</p>}
                          </td>
                          <td className="whitespace-nowrap p-2 text-xs tabular-nums">
                            {l.p.jornada.inicio != null ? `${fmtMin(l.p.jornada.inicio)} – ${fmtMin(l.p.jornada.fim)}` : ROTULO_TURNO[l.p.turno]}
                          </td>
                          <td className="max-w-[200px] p-2"><p className="truncate">{l.p.c.nome}</p><p className="truncate text-[11px] text-muted-foreground">{l.p.c.cargo}</p></td>
                          <td className="p-2 text-center"><BadgeSituacao s={l.dia.situacao} /></td>
                          <td className="p-2 text-center text-xs font-semibold">
                            {!aus ? "—" : l.cobertura === "coberto" || l.cobertura === "em_andamento"
                              ? <span className="rounded bg-success/10 px-2 py-0.5 text-success">Sim</span>
                              : <span className="rounded bg-destructive/10 px-2 py-0.5 text-destructive">Não</span>}
                          </td>
                          <td className="max-w-[160px] truncate p-2 text-xs">{l.ocorrencia?.substituto_nome ?? "—"}</td>
                          <td className="p-2 text-center">{aus ? <BadgeStatus s={l.ocorrencia?.status} /> : <span className="text-muted-foreground">—</span>}</td>
                          <td className={cn("p-2 text-center text-xs font-semibold tabular-nums", l.dia.atraso > 0 ? "text-warning" : "text-success")}>
                            {l.dia.entrada != null ? fmtMin(l.dia.entrada) : "—"}
                          </td>
                          <td className="whitespace-nowrap p-2 text-center">
                            <Button size="sm" variant="outline" asChild><Link to={linkPosto(l, d.data)}>Ver</Link></Button>
                            {pode && aus && l.cobertura === "descoberto" && (
                              <Button size="sm" className="ml-1 gap-1" onClick={() => setAcionar(l)}><Phone className="h-3 w-3" />Acionar</Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!pag.length && <tr><td colSpan={9}><Vazio texto="Ninguém com esses filtros." /></td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <Paginacao pagina={pagina} total={visiveis.length} porPagina={porPagina} onPagina={setPagina} />
                <select className="mr-4 rounded-md border bg-background px-2 py-1 text-xs" value={porPagina} onChange={(e) => { setPorPagina(+e.target.value); setPagina(1); }}>
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
              </div>
            </Secao>

            <div className="space-y-4">
              <Secao titulo="Mapa de Postos" icone={LayoutGrid} sub="Cada bloco é um posto — clique para detalhar">
                <div className="flex max-h-64 flex-wrap gap-1.5 overflow-auto p-3">
                  {porPosto.slice(0, 120).map((g) => {
                    const l0 = g.linhas[0];
                    const cls = g.descobertos ? "border-destructive/50 bg-destructive/15" : g.emAndamento ? "border-warning/50 bg-warning/15" : g.aguardando ? "border-info/40 bg-info/10" : "border-success/40 bg-success/15";
                    return (
                      <Link key={g.chave} to={linkPosto(l0, d.data)} title={`${l0.p.c.posto_nome} — ${g.presentes}/${g.previsto} presentes`}
                        className={cn("w-[118px] rounded-md border p-1.5 text-[10px] leading-tight hover:shadow", cls)}>
                        <p className="line-clamp-2 font-semibold">{l0.p.c.posto_nome}</p>
                        <p className="tabular-nums text-muted-foreground">{g.presentes}/{g.previsto}{g.descobertos ? ` · ${g.descobertos} descob.` : ""}</p>
                      </Link>
                    );
                  })}
                  {!porPosto.length && <Vazio texto="Sem postos." />}
                </div>
                <div className="flex flex-wrap gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-destructive/30" />Sem cobertura ({porPosto.filter((g) => g.descobertos).length})</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-warning/30" />Cobertura em andamento ({porPosto.filter((g) => !g.descobertos && g.emAndamento).length})</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-success/30" />Coberto</span>
                </div>
              </Secao>

              <Secao titulo="Resumo por Turno" icone={BarChart3}>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr><th className="p-2 text-left">Turno</th><th className="p-2">Previstos</th><th className="p-2">Presentes</th><th className="p-2">Faltas</th><th className="p-2">Atest.</th><th className="p-2">Afast.</th><th className="p-2">Cobert.</th><th className="p-2">Efetividade</th></tr></thead>
                  <tbody>
                    {porTurno.map(({ t, g }) => (
                      <tr key={t} className="border-t">
                        <td className="p-2 font-semibold">{ROTULO_TURNO[t]}</td>
                        <td className="p-2 text-center tabular-nums">{g!.previsto}</td>
                        <td className="p-2 text-center tabular-nums">{g!.presentes}</td>
                        <td className="p-2 text-center tabular-nums text-destructive">{g!.faltas}</td>
                        <td className="p-2 text-center tabular-nums">{g!.atestados}</td>
                        <td className="p-2 text-center tabular-nums">{g!.afastamentos}</td>
                        <td className="p-2 text-center tabular-nums">{g!.coberturas}</td>
                        <td className="p-2 text-center"><CelulaPct v={g!.efetividade} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Secao>

              <Secao titulo="Postos em Atenção" icone={AlertTriangle}>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr><th className="p-2 text-left">Posto</th><th className="p-2 text-left">Turno</th><th className="p-2">Sem cobertura</th><th className="p-2 text-left">Motivo</th></tr></thead>
                  <tbody>
                    {descobertos.slice(0, 8).map((l) => {
                      const t = tempoSemCobertura(l.dia.data, l.dia.horarioPrevisto, l.ocorrencia);
                      return (
                        <tr key={l.p.c.id} className="border-t">
                          <td className="max-w-[140px] p-2"><Link to={linkPosto(l, d.data)} className="block truncate font-semibold text-primary hover:underline">{l.p.c.posto_nome}</Link></td>
                          <td className="whitespace-nowrap p-2 tabular-nums">{fmtMin(l.p.jornada.inicio)}</td>
                          <td className="p-2 text-center font-bold text-destructive">{t == null ? "dia todo" : fmtDuracao(t)}</td>
                          <td className="p-2">{ROTULO_SITUACAO[l.dia.situacao]} sem cobertura</td>
                        </tr>
                      );
                    })}
                    {!descobertos.length && <tr><td colSpan={4}><Vazio texto="Nenhum posto descoberto. ✅" /></td></tr>}
                  </tbody>
                </table>
              </Secao>
            </div>
          </div>
        </div>
      )}

      {acionar && d.data && (
        <AcionarDialog open={!!acionar} onOpenChange={(v) => !v && setAcionar(null)} linha={acionar} ocorrencia={acionar.ocorrencia}
          data={d.data} sincAte={d.sincAte} candidatos={candidatos} />
      )}
    </div>
  );
}
