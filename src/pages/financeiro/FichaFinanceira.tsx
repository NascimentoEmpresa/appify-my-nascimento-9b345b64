// =====================================================================
// FINANCEIRO › FICHA FINANCEIRA (/app/financeiro/ficha-financeira)
//
// Tudo o que cada colaborador já recebeu, dos eventos de pagamento da Senior
// (espelho."BiFichaFinanceira"). No molde da Gestão de Ponto: pesquisa-se a
// pessoa — pelo nome, CPF, matrícula ou pelo login dela no ERP — e aparece a
// ficha inteira: cada folha paga (mensal, férias, 13º, rescisão,
// adiantamento) com proventos, descontos e líquido, os eventos, e os totais.
//
// Dados: RPCs ff_buscar / ff_ficha (mig 20261029004700), por ANOS de
// pagamento (os dois últimos de saída; "carregar anos anteriores" pede mais).
// Conta: src/lib/fichaFinanceira.ts (com teste). R$ só para quem tem o
// fantasma financeiro_ficha_financeira_valores — a RPC nem manda o número.
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarRange, ChevronDown, ChevronRight, EyeOff,
  FileSpreadsheet, FileText, History, Loader2, Receipt, Search, ShieldAlert, UserRound, Wallet, X,
} from "lucide-react";
import { useBuscaFicha, useFicha, type ColaboradorBusca } from "@/hooks/useFichaFinanceira";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  ROTULO_FOLHA, TIPOS_FOLHA, filtrarCalculos, fmtData, fmtMoeda, fmtRef, montarCalculos, resumir, rotuloMes, somarPorEvento,
  type CalculoFicha, type TipoFolha,
} from "@/lib/fichaFinanceira";
import { exportarFichaExcel, exportarFichaPdf } from "@/lib/fichaFinanceiraExportar";

const MENU = "financeiro_ficha_financeira";

const COR_FOLHA: Record<TipoFolha, string> = {
  mensal: "border-primary/30 text-primary",
  ferias: "border-info/30 text-info",
  decimo: "border-success/30 text-success",
  rescisao: "border-destructive/30 text-destructive",
  adiantamento: "border-warning/30 text-warning",
};

function Kpi({ icon: Icon, valor, rotulo, dica, tom = "primary" }: {
  icon: typeof Wallet; valor: React.ReactNode; rotulo: string; dica?: string; tom?: string;
}) {
  const tons: Record<string, string> = {
    primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tons[tom]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {dica && <p className="truncate text-[11px] text-muted-foreground/70">{dica}</p>}
      </div>
    </Card>
  );
}

export default function FichaFinanceira() {
  const [params, setParams] = useSearchParams();
  const empregadoId = Number(params.get("id")) || null;
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [anos, setAnos] = useState<{ de: number | null; ate: number | null }>({ de: null, ate: null });
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [tipos, setTipos] = useState<TipoFolha[]>([]);

  // Debounce da busca: a RPC varre o EMPREGADOS pelo nome.
  useEffect(() => { const t = setTimeout(() => setTermo(busca), 300); return () => clearTimeout(t); }, [busca]);
  // Pessoa nova = filtros do zero.
  useEffect(() => { setAnos({ de: null, ate: null }); setDe(""); setAte(""); setTipos([]); }, [empregadoId]);

  const { data: resultados = [], isFetching: buscando, error: erroBusca } = useBuscaFicha(termo);
  const { data: ficha, isLoading, isFetching, error } = useFicha(empregadoId, anos.de, anos.ate);
  const { data: podeExportar } = useScreenAccess(MENU, "exportar");

  const escolher = (c: ColaboradorBusca) => { setParams({ id: String(c.id) }); setBusca(""); setTermo(""); };

  const calculos = useMemo(() => montarCalculos(ficha?.eventos ?? []), [ficha]);
  const filtrados = useMemo(() => filtrarCalculos(calculos, { de: de || null, ate: ate || null, tipos }), [calculos, de, ate, tipos]);
  const resumo = useMemo(() => resumir(filtrados, calculos, tipos), [filtrados, calculos, tipos]);
  const porEvento = useMemo(() => somarPorEvento(filtrados), [filtrados]);

  const veValores = !!ficha?.ve_valores;
  const m = (v: number | null) => (veValores ? fmtMoeda(v) : "•••");
  const primeiroAno = ficha?.anos[0]?.ano ?? null;
  const temAnterior = !!ficha && primeiroAno != null && ficha.ano_de > primeiroAno;
  const matriculas = ficha?.vinculos.map((v) => `${v.empresa}/${v.cadastro}`).join(", ") || "—";

  const filtroTexto = [
    de || ate ? `pagamentos de ${de ? rotuloMes(de) : "o início"} a ${ate ? rotuloMes(ate) : "hoje"}` : `pagamentos de ${ficha?.ano_de ?? ""} a ${ficha?.ano_ate ?? ""}`,
    tipos.length ? tipos.map((t) => ROTULO_FOLHA[t]).join(", ") : "todas as folhas",
  ].join(" · ");
  const cabecalho = () => ({
    nome: ficha!.colaborador.nome, matriculas, cargo: ficha!.colaborador.cargo, filial: ficha!.colaborador.filial,
    situacao: ficha!.colaborador.situacao,
    usuario: ficha!.colaborador.usuario ? (ficha!.colaborador.usuario.email ?? ficha!.colaborador.usuario.nome) : null,
    filtro: filtroTexto, veValores,
  });

  const atalho = (q: "12m" | "ano" | "tudo") => {
    const hoje = new Date();
    const mesAtual = hoje.toISOString().slice(0, 7);
    if (q === "12m") { const d = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1); setDe(d.toISOString().slice(0, 7)); setAte(mesAtual); }
    if (q === "ano") { const a = ficha?.ano_ate ?? hoje.getFullYear(); setDe(`${a}-01`); setAte(`${a}-12`); }
    if (q === "tudo") { setDe(""); setAte(""); }
  };
  const carregarAnteriores = (tudo = false) => {
    if (!ficha || primeiroAno == null) return;
    const ateAno = ficha.ano_ate;
    const deAno = tudo ? Math.max(primeiroAno, ateAno - 9) : Math.max(primeiroAno, ficha.ano_de - 3);
    setAnos({ de: deAno, ate: ateAno });
  };

  const erro = (error ?? erroBusca) as Error | null;

  return (
    <div>
      <PageHeader
        title="Ficha Financeira"
        subtitle="Tudo o que cada colaborador já recebeu na Senior: folha a folha, com proventos, descontos, líquido e os eventos pagos."
        module="Financeiro"
        breadcrumb={["Financeiro", "Ficha Financeira"]}
      />

      {/* ── Busca ─────────────────────────────────────────────────────── */}
      <Card className="relative mb-4 p-4">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Colaborador</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" autoFocus={!empregadoId} value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, CPF, matrícula, ou nome / e-mail do login no ERP" />
          {buscando && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {termo.trim() && (termo.trim().length >= 2 || /^\d+$/.test(termo.trim())) && (
          <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border">
            {resultados.length === 0 && !buscando && (
              <p className="p-4 text-center text-sm text-muted-foreground">Ninguém encontrado.</p>
            )}
            {resultados.map((c) => (
              <button key={c.id} type="button" onClick={() => escolher(c)}
                className="flex w-full items-start justify-between gap-3 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-muted/40">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nome}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Matr. {c.empresa}/{c.cadastro} · {c.cargo ?? "—"} · {c.filial ?? "—"}{c.cpf ? ` · CPF ${c.cpf}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {c.usuario_id && <Badge variant="outline" className="gap-1 text-[10px]"><UserRound className="h-3 w-3" />{c.usuario_email ?? c.usuario_nome}</Badge>}
                  <Badge variant="outline" className={`text-[10px] ${c.ativo ? "border-success/30 text-success" : "text-muted-foreground"}`}>
                    {c.ativo ? c.situacao ?? "Ativo" : `${c.situacao ?? "Desligado"}${c.afastamento ? ` em ${fmtData(c.afastamento)}` : ""}`}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {erro ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" /> {erro.message}
        </Card>
      ) : !empregadoId ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <Receipt className="h-8 w-8 text-primary" />
          Pesquise um colaborador para ver a ficha financeira dele.
        </Card>
      ) : isLoading || !ficha ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lendo a ficha financeira na Senior…</Card>
      ) : (
        <>
          {/* ── Quem é ─────────────────────────────────────────────────── */}
          <Card className="mb-4 flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 text-sm">
              <p className="text-base font-bold">{ficha.colaborador.nome}</p>
              <p className="text-xs text-muted-foreground">
                {ficha.colaborador.cargo ?? "—"} · {ficha.colaborador.filial ?? "—"} · {ficha.colaborador.situacao ?? "—"}
                {ficha.colaborador.admissao ? ` · admissão ${fmtData(ficha.colaborador.admissao)}` : ""}
                {ficha.colaborador.afastamento ? ` · saída ${fmtData(ficha.colaborador.afastamento)}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Matrícula{ficha.vinculos.length > 1 ? "s (mesmo CPF)" : ""}: <b className="text-foreground">{matriculas}</b>
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs">
                <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                {ficha.colaborador.usuario
                  ? <>Usuário do ERP: <b>{ficha.colaborador.usuario.nome ?? "—"}</b>{ficha.colaborador.usuario.email ? ` (${ficha.colaborador.usuario.email})` : ""}</>
                  : <span className="text-muted-foreground">Sem login no ERP vinculado a este cadastro</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {podeExportar && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!filtrados.length}
                    onClick={() => exportarFichaExcel(cabecalho(), filtrados, resumo, porEvento)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!filtrados.length}
                    onClick={() => exportarFichaPdf(cabecalho(), filtrados, resumo)}><FileText className="h-4 w-4" /> PDF</Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setParams({})}><X className="h-4 w-4" /> Fechar</Button>
            </div>
          </Card>

          {!ficha.disponivel ? (
            <Card className="p-6 text-sm text-muted-foreground">{ficha.motivo}</Card>
          ) : (
            <>
              {!veValores && (
                <Card className="mb-4 flex items-center gap-2 border-warning/40 bg-warning/5 p-3 text-xs">
                  <EyeOff className="h-4 w-4 shrink-0 text-warning" />
                  Você vê os eventos e as referências, mas não os valores em R$. Isso depende da permissão
                  <b>"Ficha Financeira — Ver valores (R$)"</b> em Administração › Acesso por Usuário.
                </Card>
              )}

              {/* ── Filtros ────────────────────────────────────────────── */}
              <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pago de</p>
                  <Input type="month" className="h-9 w-40" value={de} onChange={(e) => setDe(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">até</p>
                  <Input type="month" className="h-9 w-40" value={ate} onChange={(e) => setAte(e.target.value)} />
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-9" onClick={() => atalho("12m")}>12 meses</Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => atalho("ano")}>{ficha.ano_ate}</Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => atalho("tudo")}>Tudo</Button>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo de folha</p>
                  <div className="flex flex-wrap gap-1">
                    {TIPOS_FOLHA.map((t) => {
                      const on = tipos.includes(t);
                      return (
                        <Button key={t} size="sm" variant={on ? "default" : "outline"} className="h-9"
                          onClick={() => setTipos((ts) => (on ? ts.filter((x) => x !== t) : [...ts, t]))}>
                          {ROTULO_FOLHA[t]}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" />
                    Carregado: {ficha.ano_de}–{ficha.ano_ate}{primeiroAno != null ? ` · a ficha começa em ${primeiroAno}` : ""}
                    {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
                  </span>
                  {temAnterior && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => carregarAnteriores(false)}><History className="h-3.5 w-3.5" /> +3 anos anteriores</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => carregarAnteriores(true)}>Até 10 anos</Button>
                    </div>
                  )}
                </div>
              </Card>

              {/* ── Totais ─────────────────────────────────────────────── */}
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Kpi icon={Wallet} valor={m(resumo.liquido)} rotulo="Total recebido no período" dica="líquido: proventos − descontos" tom="success" />
                <Kpi icon={CalendarRange} valor={m(resumo.liquidoAno)} rotulo={`Recebido em ${resumo.ano}`} dica="líquido, pelo mês de pagamento" />
                <Kpi icon={Receipt} valor={m(resumo.mediaMensal)} rotulo="Média mensal" dica={`${resumo.meses.length} mês(es) com pagamento`} tom="info" />
                <Kpi icon={ArrowUpCircle} valor={m(resumo.proventos)} rotulo="Proventos" tom="success" />
                <Kpi icon={ArrowDownCircle} valor={m(resumo.descontos)} rotulo="Descontos" tom="destructive" />
                <Kpi icon={FileText} valor={resumo.calculos} rotulo="Folhas no período"
                  dica={resumo.semValor ? `${resumo.semValor} evento(s) sem valor` : undefined} tom="muted" />
              </div>

              {ficha.limite && (
                <Card className="mb-4 flex items-center gap-2 p-3 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4" /> Período grande demais: vieram só os primeiros 60 mil eventos. Carregue menos anos.
                </Card>
              )}

              <Tabs defaultValue="folhas">
                <TabsList>
                  <TabsTrigger value="folhas">Por folha ({filtrados.length})</TabsTrigger>
                  <TabsTrigger value="meses">Por mês ({resumo.meses.length})</TabsTrigger>
                  <TabsTrigger value="eventos">Por evento ({porEvento.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="folhas">
                  <Card className="p-0">
                    {filtrados.length === 0 ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">Nenhum pagamento neste filtro.</p>
                    ) : filtrados.map((c) => <LinhaCalculo key={c.chave} c={c} m={m} />)}
                  </Card>
                </TabsContent>

                <TabsContent value="meses">
                  <Card className="overflow-x-auto p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Mês de pagamento</th>
                          <th className="px-3 py-2 text-right">Folhas</th>
                          <th className="px-3 py-2 text-right">Proventos</th>
                          <th className="px-3 py-2 text-right">Descontos</th>
                          <th className="px-3 py-2 text-right">Líquido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.meses.map((x) => (
                          <tr key={x.mes} className="border-b border-border/60 last:border-0">
                            <td className="px-4 py-2 font-medium">{rotuloMes(x.mes)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{x.calculos}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-success">{m(x.proventos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-destructive">{m(x.descontos)}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{m(x.liquido)}</td>
                          </tr>
                        ))}
                        {!resumo.meses.length && <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Nenhum pagamento neste filtro.</td></tr>}
                      </tbody>
                    </table>
                  </Card>
                </TabsContent>

                <TabsContent value="eventos">
                  <Card className="overflow-x-auto p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2">Código</th>
                          <th className="px-3 py-2">Evento</th>
                          <th className="px-3 py-2">Classe</th>
                          <th className="px-3 py-2 text-right">Vezes</th>
                          <th className="px-3 py-2 text-right">Total no período</th>
                        </tr>
                      </thead>
                      <tbody>
                        {porEvento.map((e) => (
                          <tr key={`${e.codigo}|${e.classe}`} className="border-b border-border/60 last:border-0">
                            <td className="px-4 py-2 tabular-nums text-muted-foreground">{e.codigo ?? "—"}</td>
                            <td className="px-3 py-2">{e.descricao}</td>
                            <td className={`px-3 py-2 text-xs ${COR_CLASSE[e.classe]}`}>{ROT_CLASSE[e.classe]}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{e.vezes}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">{m(e.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </TabsContent>
              </Tabs>

              <p className="mt-3 text-[11px] text-muted-foreground">
                Fonte: eventos de pagamento da Senior (espelho atualizado a cada ~10 minutos), casados pela empresa + matrícula, a partir
                da admissão de cada cadastro; matrículas com o mesmo CPF entram juntas. O período é pelo mês do PAGAMENTO; a competência
                vem do cálculo na Senior ("est." = estimada pelo pagamento). Provento/desconto vem do cadastro de eventos da Senior quando
                existe; senão, da descrição do evento ("est."). Informativos (bases, FGTS) aparecem entre parênteses e não entram no líquido.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

const ROT_CLASSE = { provento: "Provento", desconto: "Desconto", informativo: "Informativo" } as const;
const COR_CLASSE = { provento: "text-success", desconto: "text-destructive", informativo: "text-muted-foreground" } as const;

function LinhaCalculo({ c, m }: { c: CalculoFicha; m: (v: number | null) => string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button type="button" onClick={() => setAberto((a) => !a)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-muted/30">
        {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="w-24 tabular-nums">{fmtData(c.pagamento)}</span>
        <Badge variant="outline" className={`w-28 justify-center text-[10px] ${COR_FOLHA[c.tipo]}`}>{ROTULO_FOLHA[c.tipo]}</Badge>
        <span className="w-36 text-xs text-muted-foreground">
          comp. {rotuloMes(c.competencia)}{c.competenciaEstimada ? " (est.)" : ""}
        </span>
        <span className="text-[11px] text-muted-foreground">cálc. {c.calculo ?? "—"} · {c.eventos.length} evento(s)</span>
        <span className="ml-auto flex gap-4 tabular-nums">
          <span className="text-success">{m(c.proventos)}</span>
          <span className="text-destructive">−{m(c.descontos)}</span>
          <b className="w-28 text-right">{m(c.liquido)}</b>
        </span>
      </button>
      {aberto && (
        <div className="overflow-x-auto bg-muted/20 px-4 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-3">Código</th>
                <th className="py-1.5 pr-3">Evento</th>
                <th className="py-1.5 pr-3">Classe</th>
                <th className="py-1.5 pr-3 text-right">Referência</th>
                <th className="py-1.5 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {c.eventos.map((e, i) => (
                <tr key={`${e.codigo}-${i}`} className="border-t border-border/40">
                  <td className="py-1 pr-3 tabular-nums text-muted-foreground">{e.codigo ?? "—"}</td>
                  <td className="py-1 pr-3">{e.descricao}</td>
                  <td className={`py-1 pr-3 ${COR_CLASSE[e.classe]}`}>{ROT_CLASSE[e.classe]}{e.classeEstimada ? <span className="text-muted-foreground"> (est.)</span> : null}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtRef(e.referencia)}</td>
                  <td className={`py-1 text-right tabular-nums ${e.classe === "informativo" ? "text-muted-foreground" : ""}`}>
                    {e.valor == null && m(0) !== "•••" ? <span className="text-muted-foreground">sem valor</span>
                      : e.classe === "informativo" ? `(${m(e.valor)})` : m(e.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
