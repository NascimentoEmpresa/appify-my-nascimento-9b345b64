import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass, Loader2, LogOut, UserCheck, Users, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ETAPAS, fmtDias, type PainelVagas, type VagaPainel } from "@/lib/relatorios/vagasPainel";
import {
  ETAPA_ADMISSAO, FILTRO_ACOMP_PADRAO, filtrarAcompanhamento, montarAcompanhamento, resumoDesistencias, vagasPorContrato,
  type ExtraVaga, type FiltroAcompanhamento,
} from "@/lib/recrutamento/acompanhamentoVagas";

// =====================================================================
// Relatórios › Vagas › ACOMPANHAMENTO (mig 20261020000050, 19/10/2026)
//
// O dashboard gerencial do chamado de distribuição das vagas: por vaga,
// a recrutadora e quem está com a etapa atual (a Admissão, depois do
// encaminhamento), há quantos dias está aberta desde a SOLICITAÇÃO, a
// etapa atual e desde quando, o tempo em cada etapa; vagas por contrato;
// desistências (etapa e motivo) separadas das reprovações. Filtros por
// contrato, cidade, responsável, etapa e situação; o período é o do topo
// da página. Clicar numa vaga abre a aba "Por vaga" (trechos e candidatos).
// Contas em src/lib/recrutamento/acompanhamentoVagas.ts (com teste).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const COR_ETAPA: Record<string, string> = {
  aprovacao: "#94a3b8", recrutamento: "#7c3aed", selecao: "#2563eb", juridico: "#0891b2", entrevistas: "#db2777",
  aprovado: "#ea580c", sst_compras: "#f59e0b", contratado: "#16a34a", admissao: "#059669", outros: "#64748b", legado: "#a8a29e",
};
const ETAPAS_ACOMP = [...ETAPAS.filter((e) => e.chave !== "legado"), ETAPA_ADMISSAO];
const tituloDe = (chave: string) => ETAPAS_ACOMP.find((e) => e.chave === chave)?.titulo ?? chave;
const fmtData = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const corDiasAberto = (d: number) => (d <= 15 ? "text-emerald-700" : d <= 30 ? "text-amber-700" : "text-red-600");

function useExtras(ids: number[]) {
  return useQuery({
    queryKey: ["rec-acompanhamento-vagas", ids],
    enabled: ids.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<Record<number, ExtraVaga>> => {
      const out: Record<number, ExtraVaga> = {};
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await sb.rpc("rec_acompanhamento_vagas", { p_ids: ids.slice(i, i + 500) });
        if (error) throw new Error(error.message);
        for (const x of (data ?? []) as ExtraVaga[]) out[x.id] = x;
      }
      return out;
    },
  });
}

export function AbaAcompanhamento({ p, onAbrir }: { p: PainelVagas; onAbrir: (v: VagaPainel) => void }) {
  const ids = useMemo(() => p.vagas.map((v) => v.id), [p.vagas]);
  const extras = useExtras(ids);
  const [f, setF] = useState<FiltroAcompanhamento>(FILTRO_ACOMP_PADRAO);
  const set = (x: Partial<FiltroAcompanhamento>) => setF((a) => ({ ...a, ...x }));

  const todas = useMemo(() => montarAcompanhamento(p.vagas, extras.data ?? {}, p.agora), [p.vagas, p.agora, extras.data]);
  const linhas = useMemo(
    () => filtrarAcompanhamento(todas, f).sort((a, b) => b.diasAberto - a.diasAberto),
    [todas, f],
  );
  const contratos = useMemo(() => vagasPorContrato(linhas), [linhas]);
  const desist = useMemo(() => resumoDesistencias(linhas), [linhas]);

  const opcoes = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)).map((x) => ({ value: x, label: x }));
  const optContrato = useMemo(() => opcoes(todas.map((l) => l.v.contrato)), [todas]);
  const optCidade = useMemo(() => opcoes(todas.map((l) => l.v.cidade)), [todas]);
  const optResp = useMemo(() => opcoes(todas.flatMap((l) => [l.recrutadora, l.responsavelAtual])), [todas]);
  const etapasPresentes = ETAPAS_ACOMP.filter((e) => todas.some((l) => l.etapa === e.chave));

  if (extras.isLoading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando responsáveis e desistências…</Card>;
  }
  if (extras.error) {
    return <Card className="p-6 text-sm text-red-600">{(extras.error as Error).message}</Card>;
  }

  const abertas = linhas.filter((l) => l.aberta);
  const mediaAberto = abertas.length ? abertas.reduce((s, l) => s + l.diasAberto, 0) / abertas.length : null;
  const aguardandoAdm = linhas.filter((l) => l.aguardandoAdmissao).length;

  return (
    <div className="space-y-4">
      {/* ── Filtros ── */}
      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Filtro rotulo="Contrato" className="min-w-[240px] flex-1">
          <SearchableSelect value={f.contrato} onChange={(v) => set({ contrato: v })} options={optContrato} placeholder="Todos" allowClear clearValue="" />
        </Filtro>
        <Filtro rotulo="Cidade" className="w-48">
          <SearchableSelect value={f.cidade} onChange={(v) => set({ cidade: v })} options={optCidade} placeholder="Todas" allowClear clearValue="" />
        </Filtro>
        <Filtro rotulo="Responsável" className="w-48">
          <SearchableSelect value={f.responsavel} onChange={(v) => set({ responsavel: v })} options={optResp} placeholder="Todas" allowClear clearValue="" />
        </Filtro>
        <Filtro rotulo="Etapa atual" className="w-52">
          <Select value={f.etapa || "_"} onValueChange={(v) => set({ etapa: v === "_" ? "" : v })}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Todas</SelectItem>
              {etapasPresentes.map((e) => <SelectItem key={e.chave} value={e.chave}>{e.titulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Situação" className="w-36">
          <Select value={f.situacao} onValueChange={(v) => set({ situacao: v as FiltroAcompanhamento["situacao"] })}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertas">Em aberto</SelectItem>
              <SelectItem value="fechadas">Concluídas/encerradas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </Filtro>
      </Card>

      {/* ── Números ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Numero icone={Users} rotulo="Vagas" valor={linhas.length} dica={`${abertas.length} em aberto`} />
        <Numero icone={Hourglass} rotulo="Média em aberto" valor={mediaAberto == null ? "—" : `${fmtDias(mediaAberto)} d`} dica="desde a solicitação" />
        <Numero icone={UserCheck} rotulo="Aguardando admissão" valor={aguardandoAdm} dica="encaminhadas pelo recrutamento" />
        <Numero icone={LogOut} rotulo="Desistências" valor={desist.total} dica={`em ${desist.vagasComDesistencia} vaga(s)`} tom="text-amber-700" />
        <Numero icone={XCircle} rotulo="Reprovações" valor={desist.reprovados} dica="decisão da empresa" tom="text-red-600" />
      </div>

      {/* ── Vagas ── */}
      <Card className="overflow-x-auto">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Vagas — responsáveis, etapa atual e tempos</div>
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Vaga</th><th className="px-3 py-2">Contrato · cidade</th>
              <th className="px-3 py-2">Recrutadora</th><th className="px-3 py-2">Responsável atual</th>
              <th className="px-3 py-2">Etapa atual</th><th className="px-3 py-2 text-right">Em aberto</th>
              <th className="px-3 py-2">Tempo em cada etapa</th><th className="px-3 py-2 text-center">Desist.</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nenhuma vaga com esses filtros.</td></tr>}
            {linhas.slice(0, 300).map((l) => (
              <tr key={l.v.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => onAbrir(l.v)}>
                <td className="px-3 py-1.5"><span className="text-muted-foreground">#{l.v.id}</span> <span className="font-medium">{l.v.cargo ?? "—"}</span>
                  <div className="text-[10px] text-muted-foreground">pedida em {fmtData(l.v.criada)}</div></td>
                <td className="max-w-[220px] truncate px-3 py-1.5 text-muted-foreground" title={l.v.contrato ?? ""}>{l.v.contrato ?? "—"}{l.v.cidade ? ` · ${l.v.cidade}` : ""}</td>
                <td className="px-3 py-1.5 font-medium">{l.recrutadora ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-1.5">{l.responsavelAtual ?? <span className="text-muted-foreground">—</span>}
                  {l.aguardandoAdmissao && <div className="text-[10px] font-semibold text-emerald-700">Admissão</div>}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="outline" className="font-semibold" style={{ borderColor: COR_ETAPA[l.etapa], color: COR_ETAPA[l.etapa] }}>{l.etapaTitulo}</Badge>
                  {l.aberta && l.desde && <div className="mt-0.5 text-[10px] text-muted-foreground">desde {fmtData(l.desde)} · {fmtDias(l.diasEtapa ?? 0)} d</div>}
                </td>
                <td className={cn("px-3 py-1.5 text-right font-semibold", l.aberta ? corDiasAberto(l.diasAberto) : "text-muted-foreground")}>
                  {fmtDias(l.diasAberto)} d{!l.aberta && <div className="text-[10px] font-normal">concluída</div>}
                </td>
                <td className="px-3 py-1.5"><BarraEtapas porEtapa={l.porEtapa} /></td>
                <td className="px-3 py-1.5 text-center">{l.desistencias.length || <span className="text-muted-foreground">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {linhas.length > 300 && <p className="px-4 py-2 text-xs text-muted-foreground">Mostrando as 300 abertas há mais tempo de {linhas.length}. Use os filtros.</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-[10.5px] text-muted-foreground">
          {ETAPAS_ACOMP.map((e) => (
            <span key={e.chave} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: COR_ETAPA[e.chave] }} />{e.titulo}</span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Vagas por contrato ── */}
        <Card className="overflow-x-auto">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Vagas por contrato</div>
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Contrato</th><th className="px-3 py-2 text-right">Vagas</th><th className="px-3 py-2 text-right">Abertas</th><th className="px-3 py-2">Por etapa</th></tr>
            </thead>
            <tbody>
              {contratos.slice(0, 40).map((c) => (
                <tr key={c.contrato} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => set({ contrato: c.contrato === "Sem contrato" ? "" : c.contrato })}>
                  <td className="max-w-[240px] truncate px-3 py-1.5 font-medium" title={c.contrato}>{c.contrato}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{c.total}</td>
                  <td className="px-3 py-1.5 text-right">{c.abertas}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex h-3 w-40 overflow-hidden rounded bg-muted">
                      {Object.entries(c.porEtapa).map(([e, n]) => (
                        <div key={e} title={`${tituloDe(e)}: ${n}`} style={{ width: `${(n / c.total) * 100}%`, background: COR_ETAPA[e] ?? "#64748b" }} />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* ── Desistências ── */}
        <Card>
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Desistências <span className="font-normal text-muted-foreground">— contadas à parte das {desist.reprovados} reprovações</span></div>
          {desist.total === 0 ? <p className="p-4 text-xs text-muted-foreground">Nenhuma desistência nas vagas filtradas.</p> : (
            <div className="space-y-3 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Contagem titulo="Em que etapa" itens={desist.porEtapa} total={desist.total} />
                <Contagem titulo="Motivo" itens={desist.porMotivo} total={desist.total} />
              </div>
              <div className="max-h-56 overflow-y-auto rounded border">
                <table className="w-full text-xs">
                  <tbody>
                    {desist.lista.map((d) => (
                      <tr key={`${d.vaga.id}-${d.candidato_id}`} className="cursor-pointer border-t first:border-t-0 hover:bg-muted/30" onClick={() => onAbrir(d.vaga)}>
                        <td className="px-2 py-1 font-medium">{d.nome ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">#{d.vaga.id} {d.vaga.cargo ?? ""}</td>
                        <td className="px-2 py-1">{d.etapa}</td>
                        <td className="px-2 py-1">{d.motivo}</td>
                        <td className="px-2 py-1 text-muted-foreground">{fmtData(d.em)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Filtro({ rotulo, className, children }: { rotulo: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      {children}
    </div>
  );
}

function Numero({ icone: Icone, rotulo, valor, dica, tom }: { icone: typeof Users; rotulo: string; valor: number | string; dica?: string; tom?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Icone className="h-3.5 w-3.5" /> {rotulo}</div>
      <div className={cn("mt-1 text-2xl font-bold", tom)}>{valor}</div>
      {dica && <div className="text-[11px] text-muted-foreground">{dica}</div>}
    </Card>
  );
}

function BarraEtapas({ porEtapa }: { porEtapa: Record<string, number> }) {
  const itens = ETAPAS_ACOMP.map((e) => ({ ...e, d: porEtapa[e.chave] ?? 0 })).filter((e) => e.d > 0.05);
  const total = itens.reduce((s, e) => s + e.d, 0);
  if (!total) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex h-3 w-48 overflow-hidden rounded bg-muted" title={itens.map((e) => `${e.titulo}: ${fmtDias(e.d)} d`).join("\n")}>
      {itens.map((e) => <div key={e.chave} style={{ width: `${(e.d / total) * 100}%`, background: COR_ETAPA[e.chave] ?? "#64748b" }} />)}
    </div>
  );
}

function Contagem({ titulo, itens, total }: { titulo: string; itens: { nome: string; n: number }[]; total: number }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <ul className="space-y-1">
        {itens.slice(0, 8).map((i) => (
          <li key={i.nome} className="text-xs">
            <div className="flex justify-between gap-2"><span className="truncate" title={i.nome}>{i.nome}</span><b>{i.n}</b></div>
            <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-amber-500" style={{ width: `${(i.n / total) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

