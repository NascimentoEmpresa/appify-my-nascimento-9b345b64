import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { emLotes } from "@/lib/emLotes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { corDoStatus, fmtData, type SolicitacaoDemissao } from "@/lib/demissao/solicitacao";
import {
  HOMOLOGACOES, MEIOS_ENVIO, MEIOS_RETORNO, STATUS_RESCISAO, TABELA_RESCISAO, TIPOS_DESLIGAMENTO,
  casarComSolicitacoes, completarVazios, corStatusRescisao, edicaoInicial, erroDatasRescisao,
  filtrarRescisoes, lerPlanilhaRescisao, limparEdicao, montarLinhasRescisao, ordenarRescisoes,
  planilhaDasRescisoes, sugerirDataDemissao, sugerirDataPagamento, textoProgramadas,
  type EdicaoRescisao, type FiltroRescisao, type LinhaPlanilhaRescisao, type LinhaRescisao,
  type OrdemRescisao, type RescisaoRH, type VinculoEmpregado,
} from "@/lib/demissao/rescisao";
import { CheckCircle2, Download, Eye, FileSpreadsheet, Loader2, Pencil, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// RH_RESCISAO e EMPREGADOS fora do types.ts gerado — mesmo padrão do PainelDemissoes.
const sb = supabase as unknown as SupabaseClient;

/**
 * RH › Solicitações de Demissão — a tabela no formato da PLANILHA DE
 * RESCISÃO do RH (19/10/2026). Uma linha por desligamento: as solicitações do
 * ERP que chegaram ao RH e as linhas importadas da planilha. As regras
 * (sugestão de datas, leitura da planilha, filtro) moram em
 * lib/demissao/rescisao.ts; aqui ficam a tela, a gravação e a importação.
 *
 * O fluxo da solicitação (liberar pro SST, devolver, cancelar) continua no
 * card de sempre — o botão "Ver" abre ele. O lápis abre a ficha da rescisão.
 */

const PAGINA = 1000;
const EXIBIR_DE_CADA_VEZ = 200;

async function buscarTodasRescisoes(): Promise<RescisaoRH[]> {
  const todas: RescisaoRH[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await sb.from(TABELA_RESCISAO).select("*").order("id").range(de, de + PAGINA - 1);
    if (error) throw error;
    todas.push(...((data ?? []) as RescisaoRH[]));
    if (!data || data.length < PAGINA) return todas;
  }
}

/** Empresa + matrícula de quem está nas solicitações (EMPREGADOS), em lotes por causa do limite de URL do cluster. */
async function buscarEmpregados(ids: number[]): Promise<Map<number, VinculoEmpregado>> {
  const unicos = [...new Set(ids)].map(String);
  const rows = await emLotes<{ ID: number; Cadastro: unknown; Empresa: unknown }>(unicos, 40,
    (lote) => sb.from("EMPREGADOS").select("ID,Cadastro,Empresa").in("ID", lote), 4);
  return new Map(rows.map((r) => [Number(r.ID), {
    empresa: r.Empresa == null ? null : String(r.Empresa),
    matricula: r.Cadastro == null ? null : String(r.Cadastro),
  }]));
}

function DataCelula({ iso, sugerido }: { iso: string | null; sugerido?: boolean }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("whitespace-nowrap", sugerido && "italic text-muted-foreground")}
      title={sugerido ? "Sugerido pela solicitação / régua da planilha — grave na ficha para confirmar" : undefined}>
      {fmtData(iso)}
    </span>
  );
}

function MeioData({ meio, data, obs }: { meio: string | null; data: string | null; obs: string | null }) {
  if (!meio && !data) return obs ? <span className="text-xs" title={obs}>{obs}</span> : <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap text-xs" title={obs ?? undefined}>
      {meio ?? "—"}{data ? ` · ${fmtData(data)}` : ""}
    </span>
  );
}

export function TabelaRescisoes({ solicitacoes, carregandoSolicitacoes, onAbrirSolicitacao, quemSou, onAtualizar }: {
  solicitacoes: SolicitacaoDemissao[];
  carregandoSolicitacoes: boolean;
  onAbrirSolicitacao: (s: SolicitacaoDemissao) => void;
  quemSou: string;
  onAtualizar: () => void;
}) {
  const [rescisoes, setRescisoes] = useState<RescisaoRH[]>([]);
  const [empregados, setEmpregados] = useState<Map<number, VinculoEmpregado>>(new Map());
  const [carregando, setCarregando] = useState(true);

  // Lançar/editar: "alterar" OU "aprovar" na tela — a mesma régua da RLS
  // (mig 20261019000030). O RH que libera pro SST já tem "aprovar".
  const { data: podeAlterar } = useScreenAccess("rh_demissoes", "alterar");
  const { data: podeAprovar } = useScreenAccess("rh_demissoes", "aprovar");
  const podeEditar = !!podeAlterar || !!podeAprovar;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setRescisoes(await buscarTodasRescisoes());
    } catch (e) {
      toast.error("Erro ao carregar o controle de rescisões: " + (e as Error).message);
    }
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const idsColaboradores = useMemo(
    () => solicitacoes.map((s) => s.colaborador_id).filter((v): v is number => v != null),
    [solicitacoes],
  );
  useEffect(() => {
    if (!idsColaboradores.length) return;
    buscarEmpregados(idsColaboradores).then(setEmpregados)
      .catch((e) => console.warn("EMPREGADOS (empresa/matrícula):", e));
  }, [idsColaboradores]);

  const linhas = useMemo(() => montarLinhasRescisao(solicitacoes, rescisoes, empregados), [solicitacoes, rescisoes, empregados]);

  // ── Filtros (os da planilha) ─────────────────────────────────────
  const [filtro, setFiltro] = useState<FiltroRescisao>({ campoMes: "pagamento" });
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [ordem, setOrdem] = useState<OrdemRescisao>("pagamento");
  const [exibir, setExibir] = useState(EXIBIR_DE_CADA_VEZ);
  const muda = (p: Partial<FiltroRescisao>) => { setFiltro((f) => ({ ...f, ...p })); setExibir(EXIBIR_DE_CADA_VEZ); };

  const empresas = useMemo(() => [...new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])].sort(), [linhas]);
  const linhasContrato = useMemo(() => linhas.map((l) => ({ contrato: l.contrato })), [linhas]);
  const filtradas = useMemo(() => ordenarRescisoes(
    filtrarRescisoes(linhas, filtro).filter((l) => passaNoFiltroContratos({ contrato: l.contrato }, "contrato", fContratos)),
    ordem,
  ), [linhas, filtro, fContratos, ordem]);

  const contar = (st: string) => linhas.filter((l) => l.statusRescisao === st).length;

  // ── Edição ───────────────────────────────────────────────────────
  const [editando, setEditando] = useState<LinhaRescisao | null>(null);

  const salvar = async (l: LinhaRescisao, e: EdicaoRescisao): Promise<boolean> => {
    const dados = { ...limparEdicao(e), atualizado_por: quemSou || null };
    const { data, error } = l.rescisao
      ? await sb.from(TABELA_RESCISAO).update(dados).eq("id", l.rescisao.id).select().single()
      : await sb.from(TABELA_RESCISAO).insert({ ...dados, solicitacao_id: l.solicitacao?.id ?? null, origem: "erp" }).select().single();
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    const nova = data as RescisaoRH;
    setRescisoes((rs) => (l.rescisao ? rs.map((r) => (r.id === nova.id ? nova : r)) : [...rs, nova]));
    toast.success(`Rescisão de ${l.nome} salva.`);
    return true;
  };

  // ── Exportar ─────────────────────────────────────────────────────
  // Sem gate próprio: exporta exatamente o que a tela já mostra a quem a vê.
  const exportar = () => {
    const wb = planilhaDasRescisoes(filtradas);
    XLSX.writeFile(wb, `rescisoes-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const [importando, setImportando] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_RESCISAO.map((st) => (
          <button key={st} type="button" onClick={() => muda({ statusRescisao: filtro.statusRescisao === st ? "" : st })}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", corStatusRescisao(st),
              filtro.statusRescisao === st && "ring-2 ring-primary ring-offset-1")}>
            {st}: <b>{contar(st)}</b>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Rescisões ({filtradas.length})</CardTitle>
            <div className="flex flex-wrap gap-2">
              {podeEditar && (
                <Button variant="outline" onClick={() => setImportando(true)}>
                  <Upload className="mr-2 h-4 w-4" /> Importar planilha
                </Button>
              )}
              <Button variant="outline" onClick={exportar} disabled={!filtradas.length}>
                <Download className="mr-2 h-4 w-4" /> Exportar Excel
              </Button>
              <Button variant="outline" onClick={() => { carregar(); onAtualizar(); }} disabled={carregando || carregandoSolicitacoes}>
                {carregando || carregandoSolicitacoes ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="w-56 pl-8" placeholder="Funcionário, matrícula, contrato…"
                value={filtro.busca ?? ""} onChange={(e) => muda({ busca: e.target.value })} />
            </div>
            <FiltroContratos linhas={linhasContrato} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
            <Select value={filtro.empresa || "todas"} onValueChange={(v) => muda({ empresa: v === "todas" ? "" : v })}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Empresa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Empresa</SelectItem>
                {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtro.homologacao || "todas"} onValueChange={(v) => muda({ homologacao: v === "todas" ? "" : v })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Homologação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Homologação</SelectItem>
                {HOMOLOGACOES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtro.tipo || "todos"} onValueChange={(v) => muda({ tipo: v === "todos" ? "" : v })}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Tipo de desligamento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Tipo de desligamento</SelectItem>
                {TIPOS_DESLIGAMENTO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtro.campoMes ?? "pagamento"} onValueChange={(v) => muda({ campoMes: v as FiltroRescisao["campoMes"] })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Mês do pagamento</SelectItem>
                <SelectItem value="demissao">Mês da demissão</SelectItem>
                <SelectItem value="recebido">Mês recebido</SelectItem>
              </SelectContent>
            </Select>
            <Input type="month" className="w-40" value={filtro.mes ?? ""} onChange={(e) => muda({ mes: e.target.value })} />
            <Select value={filtro.origem || "todas"} onValueChange={(v) => muda({ origem: v === "todas" ? "" : (v as "erp" | "planilha") })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">ERP + planilha</SelectItem>
                <SelectItem value="erp">Só do ERP</SelectItem>
                <SelectItem value="planilha">Só importadas</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!filtro.soNaoProgramadas} onCheckedChange={(v) => muda({ soNaoProgramadas: !!v })} />
              Falta programar
            </label>
            <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemRescisao)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Ordem: pagamento</SelectItem>
                <SelectItem value="demissao">Ordem: demissão</SelectItem>
                <SelectItem value="recebido">Ordem: recebido</SelectItem>
                <SelectItem value="nome">Ordem: nome</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {carregando || carregandoSolicitacoes ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {linhas.length === 0 ? "Nenhuma rescisão por aqui ainda." : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow className="whitespace-nowrap">
                    <TableHead>Recebido</TableHead>
                    <TableHead>Emp.</TableHead>
                    <TableHead>Mat.</TableHead>
                    <TableHead className="min-w-[200px]">Funcionário</TableHead>
                    <TableHead className="min-w-[160px]">Contrato</TableHead>
                    <TableHead>Homologação</TableHead>
                    <TableHead>SST</TableHead>
                    <TableHead>Aviso</TableHead>
                    <TableHead>Solicitado por</TableHead>
                    <TableHead>Último dia</TableHead>
                    <TableHead>Demissão</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead className="min-w-[170px]">Tipo de desl.</TableHead>
                    <TableHead>Programadas</TableHead>
                    <TableHead>Malote</TableHead>
                    <TableHead>Envio doc.</TableHead>
                    <TableHead>Retorno doc.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-[160px]">Observação</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.slice(0, exibir).map((l) => (
                    <TableRow key={l.chave} className="align-top">
                      <TableCell><DataCelula iso={l.recebido} /></TableCell>
                      <TableCell>{l.empresa ?? "—"}</TableCell>
                      <TableCell>{l.matricula ?? "—"}</TableCell>
                      <TableCell>
                        <div className="font-medium">{l.nome}</div>
                        {l.solicitacao ? (
                          <Badge variant="outline" className={cn("mt-0.5 text-[10px]", corDoStatus(l.solicitacao.status))}>
                            #{l.solicitacao.id} · {l.solicitacao.status}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">importada da planilha</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{l.contrato ?? "—"}</TableCell>
                      <TableCell>{l.homologacao ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{l.sstOk == null ? "—" : l.sstOk ? <span className="font-semibold text-emerald-700">OK</span> : <span className="text-amber-700">Não</span>}</TableCell>
                      <TableCell><DataCelula iso={l.aviso} sugerido={l.sugerido.aviso} /></TableCell>
                      <TableCell className="text-xs">{l.solicitadoPor ?? "—"}</TableCell>
                      <TableCell><DataCelula iso={l.ultimoDia} sugerido={l.sugerido.ultimoDia} /></TableCell>
                      <TableCell><DataCelula iso={l.demissao} sugerido={l.sugerido.demissao} /></TableCell>
                      <TableCell><DataCelula iso={l.pagamento} sugerido={l.sugerido.pagamento} /></TableCell>
                      <TableCell className={cn("text-xs", l.sugerido.tipo && "italic text-muted-foreground")}>{l.tipo ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {l.rescisaoProgramada && l.valesProgramados
                          ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Rescisão e vales OK</span>
                          : textoProgramadas(l) || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {l.maloteData ? <span className="whitespace-nowrap text-xs" title={l.maloteObs ?? undefined}>{fmtData(l.maloteData)}</span>
                          : l.maloteObs ? <span className="text-xs">{l.maloteObs}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><MeioData meio={l.envioMeio} data={l.envioData} obs={l.envioObs} /></TableCell>
                      <TableCell><MeioData meio={l.retornoMeio} data={l.retornoData} obs={l.retornoObs} /></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("whitespace-nowrap", corStatusRescisao(l.statusRescisao))}>{l.statusRescisao}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs" title={l.observacao ?? undefined}>{l.observacao ?? ""}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {podeEditar && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar a rescisão" onClick={() => setEditando(l)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {l.solicitacao && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Abrir a solicitação"
                              onClick={() => onAbrirSolicitacao(l.solicitacao!)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtradas.length > exibir && (
                <div className="mt-3 text-center">
                  <Button variant="outline" onClick={() => setExibir((n) => n + EXIBIR_DE_CADA_VEZ)}>
                    Mostrar mais ({filtradas.length - exibir} restantes)
                  </Button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Datas e tipo em <i>itálico</i> são sugestão (da solicitação, ou pela régua da planilha: trabalhado = último dia + 7; pagamento = demissão + 5) — viram valor quando a ficha é salva.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <FichaRescisao linha={editando} onFechar={() => setEditando(null)}
        onSalvar={async (l, e) => { const ok = await salvar(l, e); if (ok) setEditando(null); }} />

      <ImportarPlanilha aberto={importando} onFechar={() => setImportando(false)}
        solicitacoes={solicitacoes} rescisoes={rescisoes} empregados={empregados} quemSou={quemSou}
        onImportado={() => { setImportando(false); carregar(); }} />
    </>
  );
}

// ── Ficha (edição) ───────────────────────────────────────────────────
function FichaRescisao({ linha, onFechar, onSalvar }: {
  linha: LinhaRescisao | null;
  onFechar: () => void;
  onSalvar: (l: LinhaRescisao, e: EdicaoRescisao) => Promise<void>;
}) {
  const [e, setE] = useState<EdicaoRescisao | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setE(linha ? edicaoInicial(linha) : null); }, [linha]);
  if (!linha || !e) return null;

  const set = <K extends keyof EdicaoRescisao>(k: K, v: EdicaoRescisao[K]) => setE((x) => (x ? { ...x, [k]: v } : x));
  const erro = erroDatasRescisao(e);

  const campoData = (k: "data_aviso" | "data_ultimo_dia" | "data_demissao" | "data_pagamento", rotulo: string) => (
    <div>
      <Label htmlFor={k}>{rotulo}</Label>
      <Input id={k} type="date" className="mt-1" value={e[k] ?? ""} onChange={(ev) => set(k, ev.target.value || null)} />
    </div>
  );
  const escolha = <K extends keyof EdicaoRescisao>(k: K, rotulo: string, opcoes: readonly string[]) => (
    <div>
      <Label>{rotulo}</Label>
      <Select value={(e[k] as string | null) ?? "nenhum"} onValueChange={(v) => set(k, (v === "nenhum" ? null : v) as EdicaoRescisao[K])}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="nenhum">—</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  // Recalcular pela régua: só preenche demissão e pagamento a partir do que
  // está na ficha — não sai mexendo sozinho em data que o RH digitou.
  const recalcular = () => {
    const dem = sugerirDataDemissao(e.data_ultimo_dia, e.tipo_desligamento);
    setE((x) => (x ? { ...x, data_demissao: dem ?? x.data_demissao, data_pagamento: sugerirDataPagamento(dem ?? x.data_demissao) ?? x.data_pagamento } : x));
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Rescisão · {linha.nome}
            {linha.solicitacao && <Badge variant="outline" className={corDoStatus(linha.solicitacao.status)}>#{linha.solicitacao.id} · {linha.solicitacao.status}</Badge>}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {[linha.empresa, linha.matricula && `mat. ${linha.matricula}`, linha.contrato].filter(Boolean).join(" · ") || "—"}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {escolha("homologacao", "Homologação", HOMOLOGACOES)}
          {escolha("tipo_desligamento", "Tipo de desligamento", TIPOS_DESLIGAMENTO)}
        </div>

        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Datas</h3>
            <Button type="button" variant="ghost" size="sm" onClick={recalcular} disabled={!e.data_ultimo_dia}>
              Recalcular demissão e pagamento
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {campoData("data_aviso", "Aviso")}
            {campoData("data_ultimo_dia", "Último dia")}
            {campoData("data_demissao", "Demissão")}
            {campoData("data_pagamento", "Pagamento")}
          </div>
          {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
        </div>

        <div className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-semibold">Programadas</h3>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={e.rescisao_programada} onCheckedChange={(v) => set("rescisao_programada", !!v)} /> Rescisão programada
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={e.vales_programados} onCheckedChange={(v) => set("vales_programados", !!v)} /> Vales programados
            </label>
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-semibold">Malote (rescisão e FGTS)</h3>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <div>
              <Label htmlFor="malote_data">Data</Label>
              <Input id="malote_data" type="date" className="mt-1" value={e.malote_data ?? ""} onChange={(ev) => set("malote_data", ev.target.value || null)} />
            </div>
            <div>
              <Label htmlFor="malote_obs">Observação</Label>
              <Input id="malote_obs" className="mt-1" value={e.malote_obs ?? ""} onChange={(ev) => set("malote_obs", ev.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["envio", "retorno"] as const).map((lado) => (
            <div key={lado} className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">{lado === "envio" ? "Envio da documentação" : "Retorno da documentação"}</h3>
              <div className="grid grid-cols-2 gap-2">
                {escolha(`${lado}_meio`, "Meio", lado === "envio" ? MEIOS_ENVIO : MEIOS_RETORNO)}
                <div>
                  <Label htmlFor={`${lado}_data`}>Data</Label>
                  <Input id={`${lado}_data`} type="date" className="mt-1" value={e[`${lado}_data`] ?? ""}
                    onChange={(ev) => set(`${lado}_data`, ev.target.value || null)} />
                </div>
              </div>
              <Input placeholder={lado === "envio" ? "Ex.: impresso entregue ao Carlos" : "Observação"}
                value={e[`${lado}_obs`] ?? ""} onChange={(ev) => set(`${lado}_obs`, ev.target.value)} />
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {escolha("status_rescisao", "Status da rescisão", STATUS_RESCISAO)}
        </div>
        <div>
          <Label htmlFor="observacao">Observação</Label>
          <Textarea id="observacao" className="mt-1" value={e.observacao ?? ""} onChange={(ev) => set("observacao", ev.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button disabled={salvando || !!erro} onClick={async () => { setSalvando(true); await onSalvar(linha, e); setSalvando(false); }}>
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Importar a planilha ──────────────────────────────────────────────
interface PlanoImportacao {
  novasAvulsas: LinhaPlanilhaRescisao[];
  novasNoErp: { linha: LinhaPlanilhaRescisao; solicitacaoId: number }[];
  completar: { id: number; patch: Partial<RescisaoRH> }[];
  semMudanca: number;
}

const camposDaLinha = (l: LinhaPlanilhaRescisao) => {
  const { chave, ...resto } = l;
  return { ...resto, planilha_chave: chave };
};

function planejarImportacao(
  linhas: LinhaPlanilhaRescisao[], solicitacoes: SolicitacaoDemissao[], rescisoes: RescisaoRH[], empregados: Map<number, VinculoEmpregado>,
): PlanoImportacao {
  const porChave = new Map(rescisoes.filter((r) => r.planilha_chave).map((r) => [r.planilha_chave!, r]));
  const porSolicitacao = new Map(rescisoes.filter((r) => r.solicitacao_id != null).map((r) => [r.solicitacao_id!, r]));
  const jaVinculadas = new Set(rescisoes.filter((r) => r.solicitacao_id != null && r.planilha_chave).map((r) => r.solicitacao_id!));
  const novas = linhas.filter((l) => !porChave.has(l.chave));
  const casadas = casarComSolicitacoes(novas, solicitacoes, empregados, jaVinculadas);

  const plano: PlanoImportacao = { novasAvulsas: [], novasNoErp: [], completar: [], semMudanca: 0 };
  for (const l of linhas) {
    const existente = porChave.get(l.chave);
    if (existente) {
      const patch = completarVazios(existente, l);
      if (patch) plano.completar.push({ id: existente.id, patch });
      else plano.semMudanca++;
      continue;
    }
    const sid = casadas.get(l.chave);
    if (sid == null) { plano.novasAvulsas.push(l); continue; }
    const daSolicitacao = porSolicitacao.get(sid);
    if (daSolicitacao) {
      // O RH já tinha começado a ficha no ERP: a planilha só completa o vazio.
      plano.completar.push({ id: daSolicitacao.id, patch: { ...(completarVazios(daSolicitacao, l) ?? {}), planilha_chave: l.chave } });
    } else {
      plano.novasNoErp.push({ linha: l, solicitacaoId: sid });
    }
  }
  return plano;
}

function ImportarPlanilha({ aberto, onFechar, solicitacoes, rescisoes, empregados, quemSou, onImportado }: {
  aberto: boolean;
  onFechar: () => void;
  solicitacoes: SolicitacaoDemissao[];
  rescisoes: RescisaoRH[];
  empregados: Map<number, VinculoEmpregado>;
  quemSou: string;
  onImportado: () => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [lido, setLido] = useState<{ nome: string; linhas: LinhaPlanilhaRescisao[]; avisos: string[] } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [progresso, setProgresso] = useState("");
  useEffect(() => { if (!aberto) { setLido(null); setProgresso(""); } }, [aberto]);

  const plano = useMemo(
    () => (lido ? planejarImportacao(lido.linhas, solicitacoes, rescisoes, empregados) : null),
    [lido, solicitacoes, rescisoes, empregados],
  );

  const ler = async (f: File) => {
    try {
      const r = lerPlanilhaRescisao(await f.arrayBuffer());
      setLido({ nome: f.name, linhas: r.linhas, avisos: r.avisos });
    } catch (e) {
      toast.error("Não consegui ler a planilha: " + (e as Error).message);
    }
  };

  const importar = async () => {
    if (!plano) return;
    setGravando(true);
    try {
      const inserir = [
        ...plano.novasAvulsas.map((l) => ({ ...camposDaLinha(l), origem: "planilha", atualizado_por: quemSou || null })),
        ...plano.novasNoErp.map(({ linha, solicitacaoId }) => ({ ...camposDaLinha(linha), solicitacao_id: solicitacaoId, origem: "erp", atualizado_por: quemSou || null })),
      ];
      // Lotes no corpo do POST (não na URL): 200 por vez.
      for (let i = 0; i < inserir.length; i += 200) {
        setProgresso(`Gravando ${Math.min(i + 200, inserir.length)} de ${inserir.length}…`);
        const { error } = await sb.from(TABELA_RESCISAO).insert(inserir.slice(i, i + 200));
        if (error) throw error;
      }
      for (let i = 0; i < plano.completar.length; i++) {
        setProgresso(`Completando ${i + 1} de ${plano.completar.length}…`);
        const { id, patch } = plano.completar[i];
        const { error } = await sb.from(TABELA_RESCISAO).update({ ...patch, atualizado_por: quemSou || null }).eq("id", id);
        if (error) throw error;
      }
      toast.success(`Importação concluída: ${inserir.length} nova(s), ${plano.completar.length} completada(s).`);
      onImportado();
    } catch (e) {
      toast.error("Erro na importação (o que já foi gravado fica; importar de novo continua de onde parou): " + (e as Error).message);
    }
    setGravando(false);
    setProgresso("");
  };

  if (!aberto) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !gravando) onFechar(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Importar a planilha de rescisão</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Lê a aba de rescisões do Excel do RH. Cada linha entra uma vez só — importar de novo não duplica,
          só traz as linhas novas e completa campos que estão vazios no sistema (o que o RH já lançou aqui
          não é sobrescrito). Quando a linha é de uma solicitação do ERP (mesma matrícula ou mesmo nome),
          ela vira a ficha daquela solicitação.
        </p>
        <input ref={arquivo} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) ler(f); ev.target.value = ""; }} />
        <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={gravando}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> {lido ? `Trocar arquivo (${lido.nome})` : "Escolher o arquivo .xlsx"}
        </Button>
        {lido && plano && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p><b>{lido.linhas.length}</b> linha(s) lidas.</p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li><b>{plano.novasNoErp.length}</b> ligadas a solicitações do ERP</li>
              <li><b>{plano.novasAvulsas.length}</b> novas, só da planilha</li>
              <li><b>{plano.completar.length}</b> já no sistema com campos a completar</li>
              <li><b>{plano.semMudanca}</b> já importadas, sem mudança</li>
            </ul>
            {lido.avisos.map((a) => <p key={a} className="text-amber-700">{a}</p>)}
          </div>
        )}
        {progresso && <p className="text-sm text-muted-foreground">{progresso}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravando}>Fechar</Button>
          <Button onClick={importar}
            disabled={gravando || !plano || plano.novasAvulsas.length + plano.novasNoErp.length + plano.completar.length === 0}>
            {gravando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
