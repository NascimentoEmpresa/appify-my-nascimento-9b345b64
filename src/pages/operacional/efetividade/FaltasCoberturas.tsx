// =====================================================================
// 4. FALTAS E COBERTURAS (/app/operacional/efetividade/faltas)
//
// A mesa de trabalho do Operacional: todas as ausências do dia (pelo ponto e
// as avisadas), quanto tempo cada posto está descoberto, acionar diarista ou
// remanejar colaborador e acompanhar até o ponto confirmado.
// =====================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock, Download, Phone, PhoneCall, Plus, Search, Users, UserX, Ban,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEfetAcoes, useEfetDiaristas, usePodeAlterarEfetividade } from "@/hooks/useEfetividade";
import {
  chaveContrato, fmtDuracao, fmtMin, linkWhatsapp, tempoSemCobertura, baixarCsv,
  AUSENCIAS, COBERTURA_EM_ANDAMENTO, ROTULO_SITUACAO, ROTULO_STATUS, type LinhaDia, type StatusCobertura,
} from "@/lib/efetividade";
import {
  AvisoSincronizacao, BadgeSituacao, BadgeStatus, BarraFiltros, CabecalhoEfetividade, Carregando, Erro, Kpi, Paginacao, Secao, Vazio,
  hojeLocal, linkPosto, useDiaEfetividade, useFiltros,
} from "./shared";
import { AcionarDialog, DiaristasDialog, LinhaDoTempo, PainelOcorrencia, RegistrarFaltaDialog, novaDeLinha } from "./acoes";

const POR_PAGINA = 15;

export default function FaltasCoberturas() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const pode = usePodeAlterarEfetividade();
  const { filtros, set, limpar } = useFiltros();
  const d = useDiaEfetividade(filtros);
  const { data: diaristas = [] } = useEfetDiaristas();
  const { registrar, status } = useEfetAcoes();

  const [filtroStatus, setFiltroStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState<number | null>(null);
  const [acionar, setAcionar] = useState<LinhaDia | null>(null);
  const [registrarAberto, setRegistrarAberto] = useState(false);
  const [diaristasAberto, setDiaristasAberto] = useState(false);

  const ausencias = useMemo(() => d.linhas.filter((l) => AUSENCIAS.includes(l.dia.situacao)), [d.linhas]);
  const statusDe = (l: LinhaDia): StatusCobertura => l.ocorrencia?.status ?? "sem_cobertura";

  const comTempo = useMemo(() => ausencias.map((l) => ({ l, t: tempoSemCobertura(l.dia.data, l.dia.horarioPrevisto, l.ocorrencia) })), [ausencias]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return comTempo
      .filter(({ l }) => !filtroStatus || statusDe(l) === filtroStatus)
      .filter(({ l }) => !q || l.p.c.nome.toLowerCase().includes(q) || l.p.c.posto_nome.toLowerCase().includes(q) || l.p.c.contrato.toLowerCase().includes(q)
        || (l.ocorrencia?.substituto_nome ?? "").toLowerCase().includes(q))
      // Descoberto primeiro; dentro, quem está há mais tempo sem cobertura.
      .sort((a, b) => (a.l.cobertura === "descoberto" ? 0 : 1) - (b.l.cobertura === "descoberto" ? 0 : 1)
        || (b.t ?? -1) - (a.t ?? -1) || (a.l.dia.horarioPrevisto ?? 9999) - (b.l.dia.horarioPrevisto ?? 9999));
  }, [comTempo, filtroStatus, busca]);
  const pag = visiveis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const selecionada = ausencias.find((l) => l.p.c.id === sel) ?? visiveis[0]?.l ?? null;

  const k = {
    total: ausencias.length,
    acionado: ausencias.filter((l) => l.ocorrencia?.substituto_nome).length,
    confirmadas: ausencias.filter((l) => l.ocorrencia?.status === "ponto_confirmado").length,
    aguardando: ausencias.filter((l) => l.ocorrencia?.status === "aguardando_ponto").length,
    sem: ausencias.filter((l) => l.cobertura === "descoberto").length,
  };
  const kOntem = {
    total: d.linhasOntem.filter((l) => AUSENCIAS.includes(l.dia.situacao)).length,
    acionado: d.linhasOntem.filter((l) => l.ocorrencia?.substituto_nome).length,
    confirmadas: d.linhasOntem.filter((l) => l.ocorrencia?.status === "ponto_confirmado").length,
  };
  const disponiveis = diaristas.filter((x) => x.disponivel && !x.em_aberto);
  const pendentes = ausencias.filter((l) => l.ocorrencia && COBERTURA_EM_ANDAMENTO.includes(l.ocorrencia.status));
  const semCobertura = comTempo.filter(({ l }) => l.cobertura === "descoberto").sort((a, b) => (b.t ?? -1) - (a.t ?? -1));

  const dispensar = async (l: LinhaDia) => {
    if (!d.data) return;
    try {
      const id = l.ocorrencia?.id ?? (await registrar.mutateAsync(novaDeLinha(l, d.data, d.sincAte)));
      await status.mutateAsync({ id, status: "nao_se_aplica" });
    } catch (e) { toast({ title: "Não foi possível atualizar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  const exportar = () => baixarCsv(`faltas_${d.data}.csv`, [
    ["Entrada prevista", "Tempo sem cobertura", "Posto", "Contrato", "Colaborador", "Motivo", "Substituto", "Status da cobertura", "Origem"],
    ...visiveis.map(({ l, t }) => [fmtMin(l.dia.horarioPrevisto), t == null ? "" : fmtDuracao(t), l.p.c.posto_nome, l.p.c.contrato, l.p.c.nome,
      ROTULO_SITUACAO[l.dia.situacao], l.ocorrencia?.substituto_nome ?? "", ROTULO_STATUS[statusDe(l)], l.ocorrencia?.origem === "manual" ? "avisada" : "ponto"]),
  ]);

  const candidatos = acionar ? d.linhas.filter((l) => chaveContrato(l.p.c.empresa, l.p.c.filial) === chaveContrato(acionar.p.c.empresa, acionar.p.c.filial)
    && (l.dia.situacao === "folga" || l.dia.situacao === "presente")) : [];

  return (
    <div>
      <CabecalhoEfetividade
        titulo="Faltas e Coberturas" icone={AlertTriangle}
        subtitulo="As ausências do dia: acione substitutos e acompanhe cada cobertura até o ponto confirmado."
        data={d.data} sincAte={d.sincAte} ultimaSinc={d.base.data?.ultima_sincronizacao}
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={d.base.isFetching || d.ocs.isFetching}
        extra={<>
          <Button variant="outline" className="gap-1" onClick={() => setDiaristasAberto(true)}><Users className="h-4 w-4" />Diaristas</Button>
          {pode && <Button className="gap-1" onClick={() => setRegistrarAberto(true)}><Plus className="h-4 w-4" />Registrar falta</Button>}
        </>}
      />
      <BarraFiltros contratos={d.contratos} filtros={filtros} set={(p) => { setPagina(1); set(p); }} limpar={() => { setFiltroStatus(""); limpar(); }} sincAte={d.sincAte} />
      <Erro erro={d.erro} />
      <AvisoSincronizacao data={d.data} sincAte={d.sincAte} />

      {d.carregando ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={UserX} rotulo="Total de ausências" valor={k.total} anterior={kOntem.total} tom="destructive" melhorSobe={false} onClick={() => setFiltroStatus("")} ativo={!filtroStatus} />
            <Kpi icon={Phone} rotulo="Com substituto acionado" valor={k.acionado} anterior={kOntem.acionado} tom="success" />
            <Kpi icon={CheckCircle2} rotulo="Coberturas confirmadas" valor={k.confirmadas} anterior={kOntem.confirmadas} tom="info" onClick={() => setFiltroStatus("ponto_confirmado")} ativo={filtroStatus === "ponto_confirmado"} />
            <Kpi icon={Clock} rotulo="Aguardando ponto" valor={k.aguardando} tom="warning" onClick={() => setFiltroStatus("aguardando_ponto")} ativo={filtroStatus === "aguardando_ponto"} />
            <Kpi icon={AlertTriangle} rotulo="Sem cobertura" valor={k.sem} tom="destructive" melhorSobe={false} onClick={() => setFiltroStatus("sem_cobertura")} ativo={filtroStatus === "sem_cobertura"} />
            <Kpi icon={Users} rotulo="Diaristas disponíveis" valor={disponiveis.length} tom="violet" dica="clique para o banco de diaristas" onClick={() => setDiaristasAberto(true)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Secao titulo="Lista de Faltas e Coberturas" icone={ClipboardList} sub={`${visiveis.length} ausência(s) — descobertas primeiro`}
              acoes={<Button size="sm" variant="outline" className="gap-1" onClick={exportar}><Download className="h-4 w-4" />Exportar</Button>}>
              <div className="flex flex-wrap gap-2 border-b p-3">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Buscar colaborador, posto, contrato ou substituto…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
                </div>
                <SearchableSelect className="w-52" value={filtroStatus} onChange={(v) => { setFiltroStatus(v); setPagina(1); }} allowClear placeholder="Situação da cobertura"
                  options={(Object.keys(ROTULO_STATUS) as StatusCobertura[]).map((s) => ({ value: s, label: ROTULO_STATUS[s] }))} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs">
                    <tr><th className="p-2">Entrada</th><th className="p-2">Tempo sem cobertura</th><th className="p-2 text-left">Posto</th><th className="p-2 text-left">Contrato</th>
                      <th className="p-2 text-left">Colaborador (previsto)</th><th className="p-2">Motivo</th><th className="p-2 text-left">Substituto</th><th className="p-2">Status da cobertura</th><th className="p-2">Ação</th></tr>
                  </thead>
                  <tbody>
                    {pag.map(({ l, t }) => (
                      <tr key={l.p.c.id} onClick={() => setSel(l.p.c.id)}
                        className={cn("cursor-pointer border-t hover:bg-muted/40", selecionada?.p.c.id === l.p.c.id && "bg-primary/5")}>
                        <td className="p-2 text-center tabular-nums">{fmtMin(l.dia.horarioPrevisto)}</td>
                        <td className={cn("p-2 text-center font-bold tabular-nums", l.cobertura === "descoberto" ? (t != null && t > 60 ? "text-destructive" : "text-warning") : "text-muted-foreground")}>
                          {l.cobertura === "coberto" ? "—" : t == null ? (l.cobertura === "descoberto" ? "dia todo" : "—") : fmtDuracao(t)}
                        </td>
                        <td className="max-w-[140px] p-2"><Link to={linkPosto(l, d.data)} onClick={(e) => e.stopPropagation()} className="block truncate font-semibold text-primary hover:underline">{l.p.c.posto_nome}</Link></td>
                        <td className="max-w-[160px] truncate p-2 text-xs">{l.p.c.contrato}</td>
                        <td className="max-w-[160px] truncate p-2">{l.p.c.nome}{l.ocorrencia?.origem === "manual" && <span className="ml-1 rounded bg-info/10 px-1 text-[10px] font-semibold text-info">avisada</span>}</td>
                        <td className="p-2 text-center"><BadgeSituacao s={l.dia.situacao} /></td>
                        <td className="max-w-[140px] truncate p-2 text-xs">{l.ocorrencia?.substituto_nome ?? "—"}</td>
                        <td className="p-2 text-center"><BadgeStatus s={statusDe(l)} /></td>
                        <td className="whitespace-nowrap p-2 text-center" onClick={(e) => e.stopPropagation()}>
                          {pode && l.cobertura === "descoberto" ? (
                            <Button size="sm" className="gap-1" onClick={() => setAcionar(l)}><PhoneCall className="h-3 w-3" />Acionar</Button>
                          ) : <Button size="sm" variant="outline" onClick={() => setSel(l.p.c.id)}>Detalhe</Button>}
                        </td>
                      </tr>
                    ))}
                    {!pag.length && <tr><td colSpan={9}><Vazio texto="Nenhuma ausência com esses filtros. ✅" /></td></tr>}
                  </tbody>
                </table>
              </div>
              <Paginacao pagina={pagina} total={visiveis.length} porPagina={POR_PAGINA} onPagina={setPagina} />
            </Secao>

            <Secao titulo="Detalhe da Ocorrência" icone={ClipboardList} acoes={selecionada && <BadgeStatus s={statusDe(selecionada)} />}>
              {!selecionada ? <Vazio texto="Escolha uma ausência na lista." /> : selecionada.ocorrencia ? (
                <div className="space-y-4 p-4">
                  <PainelOcorrencia o={selecionada.ocorrencia} compacto onAcionar={() => setAcionar(selecionada)} />
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Linha do tempo da cobertura</p>
                    <LinhaDoTempo o={selecionada.ocorrencia} vertical />
                  </div>
                </div>
              ) : (
                <div className="space-y-3 p-4 text-sm">
                  <p><b>{selecionada.p.c.nome}</b> — {ROTULO_SITUACAO[selecionada.dia.situacao].toLowerCase()} no posto <b>{selecionada.p.c.posto_nome}</b> ({selecionada.p.c.contrato}).</p>
                  <p className="text-muted-foreground">Entrada prevista {fmtMin(selecionada.dia.horarioPrevisto)}. Ninguém foi acionado ainda.</p>
                  {pode && (
                    <div className="flex flex-wrap gap-2">
                      <Button className="gap-1" onClick={() => setAcionar(selecionada)}><PhoneCall className="h-4 w-4" />Acionar substituto</Button>
                      <Button variant="ghost" className="gap-1 text-muted-foreground" onClick={() => dispensar(selecionada)}><Ban className="h-4 w-4" />Sem necessidade</Button>
                    </div>
                  )}
                  {selecionada.p.c.telefone && <a className="text-xs font-semibold text-success hover:underline" href={linkWhatsapp(selecionada.p.c.telefone) ?? undefined} target="_blank" rel="noreferrer">WhatsApp de {selecionada.p.c.nome.split(" ")[0]}</a>}
                </div>
              )}
            </Secao>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Secao titulo={`Postos sem Cobertura (${semCobertura.length})`} icone={AlertTriangle}>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Posto</th><th className="p-2 text-left">Contrato</th><th className="p-2">Tempo</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {semCobertura.map(({ l, t }) => (
                      <tr key={l.p.c.id} className="border-t">
                        <td className="max-w-[120px] truncate p-2 font-semibold">{l.p.c.posto_nome}</td>
                        <td className="max-w-[120px] truncate p-2">{l.p.c.contrato}</td>
                        <td className="p-2 text-center font-bold text-destructive">{t == null ? "dia todo" : fmtDuracao(t)}</td>
                        <td className="p-2 text-right">{pode && <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => setAcionar(l)}>Acionar</Button>}</td>
                      </tr>
                    ))}
                    {!semCobertura.length && <tr><td colSpan={4}><Vazio texto="Tudo coberto. ✅" /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>

            <Secao titulo={`Coberturas em Andamento (${pendentes.length})`} icone={Clock}>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Substituto</th><th className="p-2 text-left">Posto</th><th className="p-2">Acionado</th><th className="p-2">Situação</th></tr></thead>
                  <tbody>
                    {pendentes.map((l) => (
                      <tr key={l.p.c.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSel(l.p.c.id)}>
                        <td className="max-w-[120px] truncate p-2 font-semibold">{l.ocorrencia!.substituto_nome}</td>
                        <td className="max-w-[120px] truncate p-2">{l.p.c.posto_nome}</td>
                        <td className="p-2 text-center tabular-nums">{l.ocorrencia!.acionado_em ? new Date(l.ocorrencia!.acionado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td className="p-2 text-center"><BadgeStatus s={l.ocorrencia!.status} /></td>
                      </tr>
                    ))}
                    {!pendentes.length && <tr><td colSpan={4}><Vazio texto="Nenhuma cobertura em andamento." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>

            <Secao titulo={`Diaristas Disponíveis (${disponiveis.length})`} icone={Users}
              acoes={<Button size="sm" variant="ghost" onClick={() => setDiaristasAberto(true)}>Ver todas</Button>}>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Diarista</th><th className="p-2 text-left">Telefone</th><th className="p-2">Coberturas</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {disponiveis.slice(0, 30).map((x) => (
                      <tr key={x.id} className="border-t">
                        <td className="max-w-[130px] truncate p-2 font-semibold">{x.nome}</td>
                        <td className="p-2">{x.telefone || <span className="text-warning">sem telefone</span>}</td>
                        <td className="p-2 text-center tabular-nums">{x.confirmados + x.diarias}</td>
                        <td className="p-2 text-right">
                          {linkWhatsapp(x.telefone) && <a href={linkWhatsapp(x.telefone)!} target="_blank" rel="noreferrer" className="rounded bg-success/10 px-2 py-1 font-semibold text-success hover:bg-success/20">Chamar</a>}
                        </td>
                      </tr>
                    ))}
                    {!disponiveis.length && <tr><td colSpan={4}><Vazio texto="Nenhuma diarista disponível." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>
          </div>
        </div>
      )}

      {acionar && d.data && (
        <AcionarDialog open onOpenChange={(v) => !v && setAcionar(null)} linha={acionar} ocorrencia={acionar.ocorrencia} data={d.data} sincAte={d.sincAte} candidatos={candidatos} />
      )}
      {registrarAberto && d.data && (
        <RegistrarFaltaDialog open onOpenChange={setRegistrarAberto} contratos={d.contratos} preps={d.base.preps} data={hojeLocal()} contratoInicial={filtros.contrato} />
      )}
      <DiaristasDialog open={diaristasAberto} onOpenChange={setDiaristasAberto} />
    </div>
  );
}
