// =====================================================================
// SISTEMAS › BONIFICAÇÃO COLETIVA POR NOTA DA EQUIPE — /app/sistemas/bonificacao
//
// Pedido do Pablo (05/11/2026), a partir do protótipo
// Painel_ERP_Bonificacao_Coletiva.html (5 abas, fórmulas e ajudas "i").
// O protótipo era demonstração com dados fictícios e localStorage; aqui as
// entregas são os chamados de desenvolvimento CONCLUÍDOS do mês (RPC
// bonificacao_dev_entregas) e verba/pesos/avaliações ficam no banco
// (mig 20261105004700).
//
// Acesso (nasce sem ninguém):
//   sistemas_bonificacao        visualizar = painel · alterar = avaliar
//                               entregas · exportar = CSV e impressão
//   sistemas_bonificacao_regras alterar = verba/pesos/dificuldade/referência
//                               aprovar = fechar/reabrir o período
//
// Toda conta: src/lib/sistemas/bonificacaoColetiva.ts (com teste). O filtro
// de desenvolvedor só muda o que se VÊ — nota coletiva e rateio usam sempre
// todas as entregas do mês.
// =====================================================================
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BarChart3, ChevronDown, ClipboardList, Download, ExternalLink, Lock, Printer, RefreshCw,
  Save, Scale, Settings2, User, Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useEntregasBonificacao, useEquipeBonificacao, usePeriodosBonificacao, useSalariosBonificacao, useSalvarPeriodo } from "@/hooks/useBonificacaoColetiva";
import { completarComEquipe, type ModoDivisao } from "@/lib/sistemas/bonificacaoColetiva";
import {
  CRITERIOS, ROTULO_CRITERIO, ROTULO_DIFICULDADE, ROTULO_QUALIDADE,
  configDoPeriodo, contribuicao, textoEscalaDificuldade, distribuirPorPeso, pesoIgual, redistribuirPesos, cltDoMes, aplicarPesosSalvos, pesosPadrao, pesosSalvosDoMes, type PesosSalvos, contribuicaoParaEquipe, gerarCsv, htmlProposta, intervaloDaCompetencia, linhaDaConfig,
  mediasDosCriterios, noPrazo, notaDaEntrega, notaDoGrupo, notasDaEntrega, pendenciasDaEntrega, pontosPerdidos,
  ratearBonificacao, referenciaDoPeriodo, resolverPeriodo, resumoPorDev, rotuloCompetencia, somar, ultimasCompetencias, validarVerba,
  type ConfigBonificacao, type Criterio, type EntregaDetalhada, type NotasCriterios, type Rateio, type ResumoDev,
} from "@/lib/sistemas/bonificacaoColetiva";
import { AbaRegras } from "./componentes/AbaRegras";
import { AvaliarEntregaDialog } from "./componentes/AvaliarEntregaDialog";
import { ChatBonificacaoIa } from "./componentes/ChatBonificacaoIa";
import { ValorDetalhado } from "./componentes/ValorDetalhado";
import { hrefNaLista } from "@/lib/chamados/navegacaoLista";
import { AJUDA, Ajuda, BarraCriterio, Kpi, Titulo, Vazio, dataBr, moeda, num } from "./componentes/comum";

const MENU = "sistemas_bonificacao";
const MENU_REGRAS = "sistemas_bonificacao_regras";

const AJUDA_CRITERIO: Record<Criterio, string> = {
  qualidade: AJUDA.qualidade, satisfacao: AJUDA.satisfacao, prazo: AJUDA.prazo, dificuldade: AJUDA.dificuldade, valor: AJUDA.valor,
};

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function BonificacaoColetiva() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Bonificação Coletiva da Equipe"
        subtitle="Desempenho das entregas de desenvolvimento e bonificação liberada pela nota coletiva — Presidência e Gerência de Sistemas"
        module="Sistemas"
        breadcrumb={["Bonificação Coletiva"]}
      />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <Painel />
      </AcessoGate>
    </div>
  );
}

function Painel() {
  const hoje = hojeLocal();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [dev, setDev] = useState("todos");
  const [aba, setAba] = useState("equipe");
  const [avaliando, setAvaliando] = useState<EntregaDetalhada | null>(null);

  const { data: entregas = [], isLoading, isFetching, error, refetch } = useEntregasBonificacao(mes);
  const { data: periodos = [] } = usePeriodosBonificacao();
  const { data: equipe = [] } = useEquipeBonificacao(mes);
  const { data: podeAvaliar = false } = useScreenAccess(MENU, "alterar");
  const { data: podeExportar = false } = useScreenAccess(MENU, "exportar");
  const { data: podeConfigurar = false } = useScreenAccess(MENU_REGRAS, "alterar");
  const { data: podeFechar = false } = useScreenAccess(MENU_REGRAS, "aprovar");

  const periodo = useMemo(() => resolverPeriodo(mes, periodos), [mes, periodos]);
  const pesosSalvos = useMemo(() => pesosSalvosDoMes(mes, periodos), [mes, periodos]);
  const meses = useMemo(() => {
    const s = new Set(ultimasCompetencias(hoje, 18));
    for (const p of periodos) s.add(String(p.competencia).slice(0, 7));
    return [...s].sort().reverse();
  }, [hoje, periodos]);

  // Nota coletiva e rateio: SEMPRE todas as entregas válidas do mês.
  const validas = useMemo(() => entregas.filter((e) => !e.foraDaBonificacao), [entregas]);
  const excluidas = useMemo(() => entregas.filter((e) => e.foraDaBonificacao), [entregas]);
  // Régua do Valor relativa ao mês (percentil 75 de TODAS as entregas válidas).
  const referencia = useMemo(() => referenciaDoPeriodo(validas, periodo.config.referenciaValor), [validas, periodo.config.referenciaValor]);
  const cfg = useMemo(() => configDoPeriodo(periodo.config, validas), [periodo.config, validas]);
  const devsDoMes = useMemo(() => resumoPorDev(validas, cfg), [validas, cfg]);
  const devSelecionado = dev !== "todos" && devsDoMes.some((d) => d.devId === dev) ? dev : "todos";
  // Peso no valor: a equipe inteira, quem não entregou no mês com 0 (Thamires, 05/11).
  const devsEquipe = useMemo(() => completarComEquipe(devsDoMes, equipe), [devsDoMes, equipe]);
  const filtradas = useMemo(
    () => (devSelecionado === "todos" ? validas : validas.filter((e) => e.devId === devSelecionado)),
    [validas, devSelecionado],
  );

  const notaEquipe = useMemo(() => notaDoGrupo(validas, cfg), [validas, cfg]);
  const mediasEquipe = useMemo(() => mediasDosCriterios(validas, cfg), [validas, cfg]);
  const mediasFiltro = useMemo(() => mediasDosCriterios(filtradas, cfg), [filtradas, cfg]);
  const notaFiltro = useMemo(() => notaDoGrupo(filtradas, cfg), [filtradas, cfg]);
  const rateio = useMemo(() => ratearBonificacao(periodo.verba, notaEquipe, validas), [periodo.verba, notaEquipe, validas]);
  const devsFiltro = useMemo(() => resumoPorDev(filtradas, cfg), [filtradas, cfg]);
  const comPendencia = useMemo(() => validas.filter((e) => pendenciasDaEntrega(e).length > 0), [validas]);

  const verDev = (id: string, destino: string) => { setDev(id); setAba(destino); };

  const exportarCsv = () => {
    const csv = gerarCsv(filtradas, cfg, rateio);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bonificacao_coletiva_${mes}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const imprimir = () => {
    const html = htmlProposta({
      mes, cfg, rateio, medias: mediasEquipe, devs: devsDoMes, totalEntregas: validas.length,
      geradoEm: new Date().toLocaleString("pt-BR"), fechado: periodo.fechado,
    });
    const janela = window.open("", "_blank");
    if (!janela) { toast.error("O navegador bloqueou a janela de impressão. Libere pop-ups para o ERP."); return; }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
  };

  const fotoDoResultado = () => ({
    gerado_em: new Date().toISOString(),
    nota_equipe: rateio.notaEquipe,
    verba: rateio.verba,
    liberado: rateio.liberado,
    saldo: rateio.saldo,
    entregas: validas.length,
    excluidas: excluidas.length,
    medias: mediasEquipe,
    config: cfg,
    participantes: rateio.participantes,
  });

  return (
    <>
      {/* Filtros */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span className="flex items-center">Período<Ajuda texto={AJUDA.periodo} /></span>
            <Select value={mes} onValueChange={(v) => setMes(v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{meses.map((m) => <SelectItem key={m} value={m}>{rotuloCompetencia(m)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span className="flex items-center">Desenvolvedor<Ajuda texto={AJUDA.desenvolvedor} /></span>
            <Select value={devSelecionado} onValueChange={setDev}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {devsDoMes.map((d) => <SelectItem key={d.devId} value={d.devId}>{d.devNome}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {periodo.fechado && <Badge variant="outline" className="gap-1 border-warning/50 text-warning"><Lock className="h-3 w-3" /> Período fechado</Badge>}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            {podeExportar && (
              <Button variant="outline" size="sm" onClick={exportarCsv} disabled={!filtradas.length}>
                <Download className="mr-1.5 h-4 w-4" /> Exportar CSV<Ajuda texto={AJUDA.csv} />
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && <Card className="border-destructive/40 p-4 text-sm text-destructive">Não foi possível carregar as entregas: {(error as Error).message}</Card>}

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="equipe" className="gap-1.5"><Users className="h-4 w-4" /> Resumo da equipe</TabsTrigger>
          <TabsTrigger value="individual" className="gap-1.5"><User className="h-4 w-4" /> Individual por desenvolvedor</TabsTrigger>
          <TabsTrigger value="tarefas" className="gap-1.5"><ClipboardList className="h-4 w-4" /> Detalhes por tarefa</TabsTrigger>
          <TabsTrigger value="bonificacao" className="gap-1.5"><Wallet className="h-4 w-4" /> Distribuição da bonificação</TabsTrigger>
          <TabsTrigger value="regras" className="gap-1.5"><Settings2 className="h-4 w-4" /> Pesos e regras</TabsTrigger>
        </TabsList>

        {isLoading ? <Card className="mt-3 p-6"><Vazio>Carregando entregas de {rotuloCompetencia(mes)}…</Vazio></Card> : (
          <>
            <TabsContent value="equipe" className="space-y-4">
              <AbaEquipe
                filtradas={filtradas} validas={validas} cfg={cfg} notaEquipe={notaEquipe} notaFiltro={notaFiltro}
                filtrando={devSelecionado !== "todos"} medias={mediasFiltro} rateio={rateio} devs={devsFiltro}
                pendentes={comPendencia.length} abrirBonificacao={() => setAba("bonificacao")}
                verDetalhes={(id) => verDev(id, "individual")} verPendencias={() => setAba("tarefas")}
              />
            </TabsContent>
            <TabsContent value="individual" className="space-y-4">
              <AbaIndividual devs={devsFiltro} cfg={cfg} mes={mes} hoje={hoje} />
            </TabsContent>
            <TabsContent value="tarefas" className="space-y-4">
              <AbaTarefas
                filtradas={filtradas} excluidas={devSelecionado === "todos" ? excluidas : excluidas.filter((e) => e.devId === devSelecionado)}
                cfg={cfg} totalPeriodo={validas.length} podeAvaliar={podeAvaliar} avaliar={setAvaliando}
              />
            </TabsContent>
            <TabsContent value="bonificacao" className="space-y-4">
              <AbaBonificacao
                mes={mes} cfg={cfg} rateio={rateio} devs={devsFiltro} devsMes={devsEquipe} todos={devSelecionado === "todos"} filtradas={filtradas} totalPeriodo={validas.length}
                verba={periodo.verba} fechado={periodo.fechado} foto={periodo.linha?.resultado ?? null}
                podeConfigurar={podeConfigurar} podeExportar={podeExportar} imprimir={imprimir}
                verIndividual={(id) => verDev(id, "individual")} pendentes={comPendencia.length}
                pesosSalvos={pesosSalvos} temLinha={!!periodo.linha}
              />
            </TabsContent>
            <TabsContent value="regras">
              <AbaRegras periodo={periodo} referencia={referencia}podeAlterar={podeConfigurar} podeAprovar={podeFechar} fotoDoResultado={fotoDoResultado} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <AvaliarEntregaDialog entrega={avaliando} aberto={!!avaliando} aoFechar={() => setAvaliando(null)} fechado={periodo.fechado} />
    </>
  );
}

// ── Resumo da equipe ─────────────────────────────────────────────────────
function AbaEquipe({ filtradas, validas, cfg, notaEquipe, notaFiltro, filtrando, medias, rateio, devs, pendentes, abrirBonificacao, verDetalhes, verPendencias }: {
  filtradas: EntregaDetalhada[]; validas: EntregaDetalhada[]; cfg: ConfigBonificacao; notaEquipe: number | null; notaFiltro: number | null;
  filtrando: boolean; medias: NotasCriterios; rateio: Rateio; devs: ResumoDev[]; pendentes: number;
  abrirBonificacao: () => void; verDetalhes: (id: string) => void; verPendencias: () => void;
}) {
  const n = filtradas.length;
  const semAjuste = filtradas.filter((e) => e.qualidade === "sem_ajuste").length;
  const comSat = filtradas.filter((e) => e.satisfacao !== null);
  const comPrazo = filtradas.filter((e) => noPrazo(e) !== null);
  const noPrazoQtd = comPrazo.filter((e) => noPrazo(e)).length;
  const contrib = contribuicao(medias, cfg.pesos);
  const notaVista = filtrando ? notaFiltro : notaEquipe;

  return (
    <>
      {pendentes > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span>{pendentes} de {validas.length} entrega(s) do mês com critério sem dado ou qualidade não confirmada.<Ajuda texto={AJUDA.pendencias} /></span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={verPendencias}>Ver tarefas</Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Entregas" valor={n} ajuda={AJUDA.entregas} />
        <Kpi rotulo={filtrando ? "Nota do desenvolvedor" : "Nota coletiva"} valor={`${num(notaVista)}/100`} tom="verde"
          ajuda={filtrando ? AJUDA.notaFinal : AJUDA.notaColetiva}
          detalhe={filtrando ? <>Nota coletiva do mês: {num(notaEquipe)}/100</> : undefined} />
        <Kpi rotulo="Qualidade sem ajustes" valor={n ? `${num((semAjuste / n) * 100)}%` : "—"} tom="verde" ajuda={AJUDA.qualidadeSemAjustes} />
        <Kpi rotulo="Satisfação média" valor={comSat.length ? `${num(comSat.reduce((a, e) => a + (e.satisfacao ?? 0), 0) / comSat.length)}/5` : "—"} tom="violeta"
          ajuda={AJUDA.satisfacaoMedia} detalhe={n ? `${comSat.length} de ${n} avaliada(s)` : undefined} />
        <Kpi rotulo="No prazo" valor={comPrazo.length ? `${num((noPrazoQtd / comPrazo.length) * 100)}%` : "—"} ajuda={AJUDA.noPrazo}
          detalhe={n && comPrazo.length < n ? `${n - comPrazo.length} sem prazo` : undefined} />
        <Kpi rotulo="Mercado IA" valor={moeda(somar(filtradas, "valorMercado"))} tom="ambar" ajuda={AJUDA.mercadoIa} />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Titulo className="mb-0" ajuda="Resumo da verba máxima, valor liberado pela nota coletiva, saldo não liberado e parcela igual por participante.">Resumo financeiro da bonificação</Titulo>
          <Button variant="outline" size="sm" onClick={abrirBonificacao}>Abrir bonificação coletiva</Button>
        </div>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">O desempenho da equipe determina o valor liberado. O pagamento é igual para todos os participantes, independentemente da nota individual.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi rotulo="Verba máxima" valor={moeda(rateio.verba)} ajuda={AJUDA.verba} />
          <Kpi rotulo="Liberado pela nota coletiva" valor={moeda(rateio.liberado)} tom="verde" ajuda={AJUDA.liberado} />
          <Kpi rotulo="Saldo não liberado" valor={moeda(rateio.saldo)} tom="ambar" ajuda={AJUDA.saldo} />
          <Kpi rotulo="Valor igual por participante" valor={moeda(rateio.cotaMedia)} tom="violeta" ajuda={AJUDA.cota} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <Titulo ajuda={AJUDA.resultadoCriterios}>Resultado dos cinco critérios — {filtrando ? "desenvolvedor" : "equipe"}</Titulo>
          {n ? CRITERIOS.map((k) => (
            <BarraCriterio key={k} rotulo={ROTULO_CRITERIO[k]} nota={medias[k]} peso={cfg.pesos[k]} pontos={contrib[k]} ajuda={AJUDA_CRITERIO[k]} />
          )) : <Vazio>Sem entregas concluídas para o filtro selecionado.</Vazio>}
          <p className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 p-3 text-xs text-muted-foreground">
            Nota de 0 a 100 obtida pela média dos critérios de todas as tarefas filtradas, multiplicada pelos pesos definidos. O valor financeiro não é considerado economia realizada. {textoEscalaDificuldade(cfg.pontosDificuldade)}
          </p>
        </Card>
        <Card className="p-5">
          <Titulo ajuda={AJUDA.composicao}>Composição da pontuação</Titulo>
          {n ? (
            <>
              {CRITERIOS.map((k) => (
                <div key={k} className="my-3 flex justify-between text-sm">
                  <span>{ROTULO_CRITERIO[k]}</span>
                  <b className="tabular-nums">{medias[k] === null ? "sem dado" : `${num(contrib[k])} / ${cfg.pesos[k]} pontos`}</b>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t pt-3 text-sm font-semibold">
                <span>Nota consolidada</span><span className="text-success">{num(notaVista)}/100</span>
              </div>
            </>
          ) : <Vazio>Sem entregas.</Vazio>}
          <p className="mt-3 text-xs text-muted-foreground">
            Valor IA agregado — Mercado: {moeda(somar(filtradas, "valorMercado"))} • Freelancer: {moeda(somar(filtradas, "valorFreelancer"))} • CLT: {moeda(somar(filtradas, "valorClt"))}. Valores estimados, não economias comprovadas.
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <Titulo ajuda={AJUDA.porDev}>Resultado por desenvolvedor</Titulo>
        <TabelaDevs devs={devs} acao={(d) => <Button size="sm" variant="outline" onClick={() => verDetalhes(d.devId)}>Ver detalhes</Button>} />
      </Card>
    </>
  );
}

function TabelaDevs({ devs, acao, extras = false, clt, rotuloMes }: {
  devs: ResumoDev[]; acao?: (d: ResumoDev) => ReactNode; extras?: boolean;
  /** Mês do filtro, para o título do detalhe dos valores (12/11/2026). */
  rotuloMes?: string;
  /** Substitui o "CLT IA" pelo salário do mês (Comparativo individual). */
  clt?: (d: ResumoDev) => number | null;
}) {
  if (!devs.length) return <Vazio>Sem dados.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Desenvolvedor</TableHead><TableHead>Entregas</TableHead>
            {CRITERIOS.map((k) => <TableHead key={k}>{ROTULO_CRITERIO[k]}</TableHead>)}
            <TableHead>Nota final</TableHead>
            {/* 11/11/2026 (Pablo): média por entrega ao lado do total — o total cresce com a quantidade de entregas; a média compara o porte do que cada um entregou. */}
            {extras && <><TableHead>Mercado IA</TableHead><TableHead><span className="inline-flex items-center gap-1">Média por entrega<Ajuda texto="Mercado IA ÷ número de entregas do mês. O total cresce com a quantidade de entregas; a média mostra o porte médio do que cada um entregou." /></span></TableHead><TableHead>Freelancer IA</TableHead><TableHead>{clt ? <span className="inline-flex items-center gap-1">CLT (salário do mês)<Ajuda texto="Salário do colaborador (cadastro da Senior) proporcional aos dias corridos já passados no mês atual — sobe sozinho a cada dia. Meses anteriores ficam R$ 0,00 por enquanto. Só aparece para quem tem 'Colaboradores — Ver salário'; os demais veem —." /></span> : "CLT IA"}</TableHead></>}
            {acao && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {devs.map((d) => (
            <TableRow key={d.devId}>
              <TableCell className="font-semibold">{d.devNome}</TableCell>
              <TableCell>{d.entregas.length}</TableCell>
              {CRITERIOS.map((k) => <TableCell key={k} className="tabular-nums">{num(d.medias[k])}</TableCell>)}
              <TableCell className="font-bold text-success tabular-nums">{num(d.nota)}</TableCell>
              {extras && <><TableCell><ValorDetalhado entregas={d.entregas} campo="valorMercado" valor={d.mercado} titulo={`Mercado IA — ${d.devNome}${rotuloMes ? `, ${rotuloMes}` : ""}`} /></TableCell><TableCell className="font-semibold tabular-nums"><ValorDetalhado entregas={d.entregas} campo="valorMercado" media valor={d.entregas.length ? Math.round((d.mercado / d.entregas.length) * 100) / 100 : null} titulo={`Média por entrega — ${d.devNome}${rotuloMes ? `, ${rotuloMes}` : ""}`} /></TableCell><TableCell><ValorDetalhado entregas={d.entregas} campo="valorFreelancer" valor={d.freelancer} titulo={`Freelancer IA — ${d.devNome}${rotuloMes ? `, ${rotuloMes}` : ""}`} /></TableCell><TableCell className={clt ? "font-semibold text-success tabular-nums" : "tabular-nums"}>{clt ? (clt(d) === null ? "—" : moeda(clt(d))) : moeda(d.clt)}</TableCell></>}
              {acao && <TableCell className="text-right">{acao(d)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Individual ───────────────────────────────────────────────────────────
function AbaIndividual({ devs, cfg, mes, hoje }: { devs: ResumoDev[]; cfg: ConfigBonificacao; mes: string; hoje: string }) {
  // "CLT" = salário gasto no mês (Pablo, 05/11/2026): só o mês atual busca o
  // salário; meses anteriores são 0 (cltDoMes). O banco corta quem não pode
  // ver salário (mig 20261105010500).
  const mesAtual = mes === hoje.slice(0, 7);
  const { data: salarios = {} } = useSalariosBonificacao(devs.map((d) => d.devId), mesAtual);
  const clt = (d: ResumoDev) => (mesAtual ? cltDoMes(salarios[d.devId], mes, hoje) : 0);
  return (
    <>
      <Card className="p-5">
        <Titulo ajuda="Apresenta a nota por critério de cada profissional e os valores estimados das tarefas que executou.">Comparativo individual</Titulo>
        <p className="mb-3 text-sm text-muted-foreground">Selecione um desenvolvedor no filtro para ver só ele. As notas individuais não alteram a cota da bonificação.</p>
        <p className="mb-3 text-xs text-muted-foreground">Passe o mouse sobre um valor para ver os chamados que o compõem; clique num chamado para abri-lo.</p>
        <TabelaDevs devs={devs} extras clt={clt} rotuloMes={rotuloCompetencia(mes)} />
      </Card>
      <ChatBonificacaoIa devs={devs} rotuloMes={rotuloCompetencia(mes)} />
      <Card className="p-5">
        <Titulo ajuda="Detalhamento dos cinco componentes da nota individual, antes e depois da aplicação dos pesos.">Pontuação por critério do profissional</Titulo>
        {devs.length ? devs.map((d) => {
          const c = contribuicao(d.medias, cfg.pesos);
          return (
            <div key={d.devId} className="mt-4 first:mt-0">
              <h3 className="text-sm font-semibold">{d.devNome} — Nota {num(d.nota)}/100 <span className="font-normal text-muted-foreground">· {d.entregas.length} entrega(s)</span></h3>
              {CRITERIOS.map((k) => <BarraCriterio key={k} rotulo={ROTULO_CRITERIO[k]} nota={d.medias[k]} peso={cfg.pesos[k]} pontos={c[k]} />)}
            </div>
          );
        }) : <Vazio>Sem dados.</Vazio>}
      </Card>
    </>
  );
}

// ── Detalhes por tarefa ──────────────────────────────────────────────────
function AbaTarefas({ filtradas, excluidas, cfg, totalPeriodo, podeAvaliar, avaliar }: {
  filtradas: EntregaDetalhada[]; excluidas: EntregaDetalhada[]; cfg: ConfigBonificacao; totalPeriodo: number;
  podeAvaliar: boolean; avaliar: (e: EntregaDetalhada) => void;
}) {
  return (
    <Card className="p-5">
      <Titulo ajuda="Expande cada entrega para consultar critérios, prazos e estimativas financeiras.">Detalhamento das tarefas</Titulo>
      <p className="mb-3 text-sm text-muted-foreground">
        Clique numa entrega para ver a nota de cada critério, o peso aplicado, as datas e os três valores estimados.
        {podeAvaliar && " Use “Avaliar” para confirmar a qualidade e ajustar dificuldade e valores."}
      </p>
      {filtradas.length ? filtradas.map((e) => (
        <CartaoTarefa key={e.chamadoId} e={e} cfg={cfg} totalPeriodo={totalPeriodo} podeAvaliar={podeAvaliar} avaliar={avaliar} lista={filtradas.map((x) => x.chamadoId)} />
      )) : <Vazio>Nenhuma entrega concluída no filtro.</Vazio>}
      {excluidas.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">Fora da bonificação ({excluidas.length})</h3>
          {excluidas.map((e) => (
            <div key={e.chamadoId} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
              <span className="font-medium">{e.numero} · {e.assunto}</span>
              <span className="text-muted-foreground">— {e.devNome} · {e.motivoExclusao}</span>
              {podeAvaliar && <Button size="sm" variant="outline" className="ml-auto" onClick={() => avaliar(e)}>Avaliar</Button>}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function CartaoTarefa({ e, cfg, totalPeriodo, podeAvaliar, avaliar, lista = [] }: {
  /** Ordem das tarefas na tela: no chamado, as setas andam por ela (12/11/2026). */
  lista?: string[];
  e: EntregaDetalhada; cfg: ConfigBonificacao; totalPeriodo: number; podeAvaliar: boolean; avaliar: (e: EntregaDetalhada) => void;
}) {
  const notas = notasDaEntrega(e, cfg);
  const nota = notaDaEntrega(e, cfg);
  const c = contribuicao(notas, cfg.pesos);
  const perdidos = pontosPerdidos(notas, cfg.pesos);
  const pend = pendenciasDaEntrega(e);
  const prazo = noPrazo(e);

  return (
    <Collapsible className="mb-2 rounded-lg border bg-card">
      <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 p-4 text-left">
        <span>
          <span className="font-semibold">{e.assunto}</span>
          <small className="mt-0.5 block text-muted-foreground">
            {e.numero} • {e.devNome} • Entregue em {dataBr(e.concluidoDia)} • {e.dificuldade ? ROTULO_DIFICULDADE[e.dificuldade] : "sem dificuldade"}
            {pend.length > 0 && <span className="ml-1 text-warning">• {pend.length} pendência(s)</span>}
          </small>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {num(nota)}/100 <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CRITERIOS.map((k) => (
            <div key={k} className="rounded-md border bg-muted/30 p-3">
              <small className="flex items-center text-muted-foreground">{ROTULO_CRITERIO[k]}<Ajuda texto={AJUDA_CRITERIO[k]} /></small>
              <b className="mt-1 block text-xl tabular-nums">{notas[k] === null ? "—" : `${num(notas[k])}/100`}</b>
              <small className="block text-muted-foreground">Peso: {cfg.pesos[k]}%</small>
              <strong className="text-sm text-primary">{notas[k] === null ? "fora da média" : `${num(c[k])} pts`}</strong>
            </div>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <Card className="p-3 text-sm">
            <h4 className="mb-1 font-semibold">Qualidade e satisfação</h4>
            <p className="text-muted-foreground">
              {e.qualidade ? ROTULO_QUALIDADE[e.qualidade] : "—"} {!e.qualidadeAvaliada && <Badge variant="outline" className="ml-1 text-[10px]">sugestão</Badge>}<br />
              Reaberturas: {e.reaberturas}{e.reaberturas > 0 && <span className="text-muted-foreground"> (não contam como erro)</span>}<br />
              Nota do solicitante: {e.satisfacao === null ? "não avaliou" : `${e.satisfacao}/5`}
            </p>
          </Card>
          <Card className="p-3 text-sm">
            <h4 className="mb-1 font-semibold">Prazo e dificuldade</h4>
            <p className="text-muted-foreground">
              Previsto: {dataBr(e.prazoLimite)}<br />
              Concluído: {dataBr(e.concluidoDia)}<br />
              {prazo === null ? "Sem prazo registrado" : prazo ? "Dentro do prazo" : "Fora do prazo"} • {e.dificuldade ? ROTULO_DIFICULDADE[e.dificuldade] : "—"}
              {!e.dificuldadeAvaliada && e.dificuldade && <Badge variant="outline" className="ml-1 text-[10px]">IA</Badge>}
            </p>
          </Card>
          <Card className="p-3 text-sm">
            <h4 className="mb-1 flex items-center font-semibold">Valor estimado pela IA<Ajuda texto="Comparação informativa de valores estimados pela IA para mercado, freelancer e CLT. Não é preço contratado nem economia realizada." /></h4>
            <p className="text-muted-foreground">
              Mercado: <b className="text-foreground">{e.valorMercado === null ? "—" : moeda(e.valorMercado)}</b>
              {e.valoresAvaliados && <Badge variant="outline" className="ml-1 text-[10px]">gestor</Badge>}<br />
              Freelancer: <b className="text-foreground">{e.valorFreelancer === null ? "—" : moeda(e.valorFreelancer)}</b><br />
              CLT: <b className="text-foreground">{e.valorClt === null ? "—" : moeda(e.valorClt)}</b>
            </p>
          </Card>
        </div>
        {pend.length > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">Pendências: {pend.join(" · ")}.</p>
        )}
        <p className="rounded-md border-l-4 border-primary bg-muted/40 p-3 text-xs text-muted-foreground">
          Nota da entrega: <b className="text-foreground">{num(nota)}/100</b> • Contribuição para a nota da equipe: <b className="text-foreground">{num(contribuicaoParaEquipe(nota, totalPeriodo))} pontos</b>.
          A bonificação é coletiva e igual por participante; não existe pagamento por tarefa.
          {e.observacao && <> Observação do gestor: {e.observacao}</>}
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Critério</TableHead><TableHead>Nota</TableHead><TableHead>Peso</TableHead>
              <TableHead><span className="flex items-center">Pontos perdidos<Ajuda texto={AJUDA.pontosPerdidos} /></span></TableHead></TableRow></TableHeader>
            <TableBody>
              {CRITERIOS.map((k) => (
                <TableRow key={k}>
                  <TableCell>{ROTULO_CRITERIO[k]}</TableCell>
                  <TableCell>{notas[k] === null ? "sem dado" : `${num(notas[k])}/100`}</TableCell>
                  <TableCell>{cfg.pesos[k]}%</TableCell>
                  <TableCell className="text-warning">{notas[k] === null ? "—" : `− ${num(perdidos[k])} pts`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeAvaliar && <Button size="sm" onClick={() => avaliar(e)}><Scale className="mr-1.5 h-4 w-4" /> Avaliar</Button>}
          <Button size="sm" variant="outline" asChild>
            <Link to={hrefNaLista(e.chamadoId, lista)}><ExternalLink className="mr-1.5 h-4 w-4" /> Abrir chamado</Link>
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Distribuição da bonificação ──────────────────────────────────────────
interface FotoFechamento { nota_equipe?: number | null; verba?: number; liberado?: number; saldo?: number; participantes?: { devNome: string; valor: number }[]; gerado_em?: string }

function AbaBonificacao({ mes, cfg, rateio, devs, devsMes, todos, filtradas, totalPeriodo, verba, fechado, foto, podeConfigurar, podeExportar, imprimir, verIndividual, pendentes, pesosSalvos, temLinha }: {
  mes: string; cfg: ConfigBonificacao; rateio: Rateio; devs: ResumoDev[]; devsMes: ResumoDev[]; todos: boolean; filtradas: EntregaDetalhada[]; totalPeriodo: number;
  verba: number; fechado: boolean; foto: unknown; podeConfigurar: boolean; podeExportar: boolean; imprimir: () => void;
  verIndividual: (id: string) => void; pendentes: number; pesosSalvos: PesosSalvos | null; temLinha: boolean;
}) {
  const salvar = useSalvarPeriodo();
  const [verbaTexto, setVerbaTexto] = useState<string | null>(null);
  const valorCampo = verbaTexto ?? String(verba);
  const f = (foto && typeof foto === "object" ? foto : null) as FotoFechamento | null;

  const aplicarVerba = () => {
    const n = Number(valorCampo.replace(",", "."));
    const erro = validarVerba(n);
    if (erro) { toast.error(erro); return; }
    salvar.mutate({ competencia: intervaloDaCompetencia(mes).competencia, verba: Math.round(n * 100) / 100, ...linhaDaConfig(cfg) }, {
      onSuccess: () => { setVerbaTexto(null); toast.success("Verba atualizada. Pagamento igual para todos, calculado pela nota coletiva."); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
    });
  };

  return (
    <>
      <Card className="border-primary/30 bg-gradient-to-r from-primary/10 to-transparent p-5">
        <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Proposta de incentivo coletivo • Presidência</div>
        <Titulo className="mt-1" ajuda={AJUDA.abaBonificacao}>Bonificação coletiva por desempenho — {rotuloCompetencia(mes)}</Titulo>
        <p className="text-sm text-muted-foreground">
          A <b>nota consolidada da equipe</b> define qual percentual da verba será liberado. Esse valor é <b>dividido igualmente</b> entre os desenvolvedores com entrega no período.
          Notas individuais servem só para acompanhamento gerencial, sem alterar a parcela de ninguém.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{textoEscalaDificuldade(cfg.pontosDificuldade)}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span className="flex items-center">Valor total disponível (R$)<Ajuda texto="Orçamento máximo de bonificação do mês; a nota da equipe define quanto dele será liberado." /></span>
            <Input type="number" min={0} step={100} className="w-48" value={valorCampo} disabled={!podeConfigurar || fechado}
              onChange={(e) => setVerbaTexto(e.target.value)} />
          </label>
          {podeConfigurar && !fechado && <Button onClick={aplicarVerba} disabled={salvar.isPending}>Aplicar distribuição</Button>}
          <AcessoGate menu={MENU} acao="exportar">
            <Button variant="outline" onClick={imprimir}><Printer className="mr-1.5 h-4 w-4" /> Imprimir proposta</Button>
          </AcessoGate>
          {fechado && <Badge variant="outline" className="gap-1 border-warning/50 text-warning"><Lock className="h-3 w-3" /> Período fechado</Badge>}
        </div>
        {!podeConfigurar && !podeExportar && <p className="mt-2 text-xs text-muted-foreground">A verba é definida por quem tem “Bonificação Coletiva — Verba, pesos e fechamento”.</p>}
      </Card>

      {pendentes > 0 && !fechado && (
        <p className="flex items-center gap-2 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" /> {pendentes} entrega(s) com pendência — a nota ainda pode mudar até o fechamento.</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Verba máxima" valor={moeda(rateio.verba)} ajuda={AJUDA.verba} />
        <Kpi rotulo="Valor liberado à equipe" valor={moeda(rateio.liberado)} tom="verde" ajuda={AJUDA.liberado} />
        <Kpi rotulo="Saldo não liberado" valor={moeda(rateio.saldo)} tom="ambar" ajuda={AJUDA.saldo} />
        <Kpi rotulo="Nota coletiva" valor={`${num(rateio.notaEquipe)}/100`} tom="violeta" ajuda={AJUDA.notaColetiva} />
        <Kpi rotulo="Valor igual por participante" valor={moeda(rateio.cotaMedia)} ajuda={AJUDA.cota} />
        <Kpi rotulo="Participantes" valor={rateio.participantes.length} tom="verde" ajuda={AJUDA.participantes} />
      </div>

      {fechado && f && (
        <Card className="p-4 text-sm">
          <Titulo ajuda={AJUDA.fechamento}>Resultado gravado no fechamento</Titulo>
          <p className="text-muted-foreground">
            Nota {num(f.nota_equipe ?? null)}/100 · verba {moeda(f.verba)} · liberado {moeda(f.liberado)} · saldo {moeda(f.saldo)}
            {f.gerado_em && <> · gravado em {new Date(f.gerado_em).toLocaleString("pt-BR")}</>}
          </p>
          {Math.round((f.liberado ?? 0) * 100) !== Math.round(rateio.liberado * 100) && (
            <p className="mt-1 text-xs text-warning">O cálculo de hoje difere da foto (algum chamado do mês mudou depois do fechamento). Vale a foto.</p>
          )}
        </Card>
      )}

      <div className="grid gap-4">
        <CartaoPesoNoValor key={mes} base={rateio.liberado} devs={devsMes} visiveis={todos ? devsMes : devs}
          mes={mes} cfg={cfg} verba={verba} fechado={fechado} podeSalvar={podeConfigurar} salvos={pesosSalvos} temLinha={temLinha} />
        <Card className="p-5">
          <Titulo ajuda="Explica a fórmula: verba disponível × nota coletiva ÷ 100; depois divide-se igualmente entre os participantes.">Cálculo da bonificação coletiva</Titulo>
          <ol className="list-decimal space-y-1 rounded-md border-l-4 border-primary bg-muted/40 p-3 pl-8 text-sm text-muted-foreground">
            <li>Defina o orçamento máximo da equipe no mês.</li>
            <li>Calcule a nota consolidada com os cinco critérios de todas as entregas do período.</li>
            <li>Aplique a nota da equipe sobre a verba máxima.</li>
            <li>A diferença fica como saldo não liberado.</li>
            <li>Divida o valor liberado igualmente entre os participantes, independentemente das notas individuais.</li>
          </ol>
          <p className="mt-3 text-sm tabular-nums">
            {rateio.participantes.length
              ? <>Cálculo: {moeda(rateio.verba)} × {num(rateio.notaEquipe)}% = <b>{moeda(rateio.liberado)}</b> liberados à equipe. Divididos por {rateio.participantes.length} participante(s) = aproximadamente <b>{moeda(rateio.cotaMedia)}</b> para cada um (centavos ajustados só para fechar o total).</>
              : "Sem entregas no período."}
          </p>
          {rateio.participantes.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Cotas: {rateio.participantes.map((p) => `${p.devNome} ${moeda(p.valor)}`).join(" · ")}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">O resultado é uma simulação para discussão com Presidência, RH e Financeiro até o fechamento do período.</p>
        </Card>
      </div>

      <Card className="p-5">
        <Titulo>Resultado por desenvolvedor — avaliação</Titulo>
        <TabelaDevs devs={devs} acao={(d) => <Button size="sm" variant="outline" onClick={() => verIndividual(d.devId)}><BarChart3 className="mr-1.5 h-4 w-4" /> Ver individual</Button>} />
        <p className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 p-3 text-xs text-muted-foreground">
          O valor por participante é único e aparece só nos indicadores consolidados. Não há descontos nem pagamentos individualizados por desempenho.
        </p>
      </Card>

      <Card className="p-5">
        <Titulo>Detalhamento das entregas — impacto na nota coletiva</Titulo>
        <p className="mb-2 text-sm text-muted-foreground">A nota de cada tarefa e os pontos que ela acrescenta à média da equipe. Valores de pagamento não são atribuídos a tarefas.</p>
        {filtradas.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Tarefa</TableHead><TableHead>Desenvolvedor</TableHead><TableHead>Nota</TableHead><TableHead>Contribuição para a nota da equipe</TableHead></TableRow></TableHeader>
              <TableBody>
                {filtradas.map((e) => {
                  const n = notaDaEntrega(e, cfg);
                  return (
                    <TableRow key={e.chamadoId}>
                      <TableCell>{e.numero} · {e.assunto}</TableCell>
                      <TableCell>{e.devNome}</TableCell>
                      <TableCell className="tabular-nums">{num(n)}/100</TableCell>
                      <TableCell className="tabular-nums">{num(contribuicaoParaEquipe(n, totalPeriodo))} pontos</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : <Vazio>Sem tarefas.</Vazio>}
      </Card>
    </>
  );
}

/**
 * "Desempenho por desenvolvedor — com peso no valor" (desenho do Pablo, 05/11/2026).
 * Valor previsto = valor LIBERADO à equipe × (peso × nota) ÷ Σ(peso × nota):
 * o liberado é dividido inteiro (correção do Pablo, 05/11 — antes era a verba).
 * Pesos editáveis e salvos pelo botão (ver SALVAR abaixo); "Pesos padrão" volta a
 * Eduardo/Iury/João/Pablo iguais e os demais com metade (pesosPadrao).
 * A régua dos pesos é o MÊS inteiro: filtrar um dev não muda o peso dele.
 * Editar um peso redistribui a diferença entre os outros com peso > 0, na
 * proporção (redistribuirPesos) — a soma fica em 100% (Pablo, 05/11).
 * SALVAR (Pablo, 05/11: "tem que ter um botão de salvar e manter fixo"):
 * grava pesos + modo NO MÊS (BONIFICACAO_DEV_PERIODO, mig 20261105011000);
 * mês sem pesos próprios herda do último mês salvo (pesosSalvosDoMes).
 * Só quem tem 'Verba, pesos e fechamento' alterar salva (a RLS decide); os
 * demais podem simular, sem gravar. Período fechado não salva (gatilho).
 */
function CartaoPesoNoValor({ base, devs, visiveis, mes, cfg, verba, fechado, podeSalvar, salvos, temLinha }: {
  base: number; devs: ResumoDev[]; visiveis: ResumoDev[];
  mes: string; cfg: ConfigBonificacao; verba: number; fechado: boolean; podeSalvar: boolean; salvos: PesosSalvos | null; temLinha: boolean;
}) {
  const salvar = useSalvarPeriodo();
  // Base = salvos (aplicados à equipe do mês) ou padrão; edição por cima até salvar.
  const inicial = useMemo(() => (salvos ? aplicarPesosSalvos(devs, salvos.pesos) : pesosPadrao(devs)), [devs, salvos]);
  const [editado, setEditado] = useState<Record<string, number> | null>(null);
  const [modoEditado, setModoEditado] = useState<ModoDivisao | null>(null);
  const pesos = editado ?? inicial;
  const modo: ModoDivisao = modoEditado ?? salvos?.modo ?? "peso";
  const setPesos = (p: Record<string, number>) => setEditado(p);
  const setModo = (m: ModoDivisao) => setModoEditado(m);
  const d = useMemo(() => distribuirPorPeso(base, devs, pesos, modo), [base, devs, pesos, modo]);
  const pendente = editado !== null || (modoEditado !== null && modoEditado !== (salvos?.modo ?? "peso"));
  const salvarPesos = () => {
    const mapa = Object.fromEntries(d.linhas.map((l) => [l.devId, l.peso]));
    salvar.mutate({
      competencia: intervaloDaCompetencia(mes).competencia,
      pesos_devs: mapa, modo_divisao: modo,
      // Mês ainda sem linha: nasce com a config herdada e a verba da tela.
      ...(temLinha ? {} : { verba, ...linhaDaConfig(cfg) }),
    }, {
      onSuccess: () => { setEditado(null); setModoEditado(null); toast.success(`Pesos salvos para ${rotuloCompetencia(mes)} — valem também para os meses seguintes até alguém mudar.`); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar os pesos."),
    });
  };
  const situacao = pendente ? "alterações não salvas"
    : salvos ? (salvos.herdadoDe ? `pesos salvos em ${rotuloCompetencia(salvos.herdadoDe)} (herdados)` : "pesos salvos neste mês")
    : "pesos padrão (Eduardo, Iury, João e Pablo iguais; demais com metade)";
  // Retrato dos pesos no foco do campo: a proporção entre os outros sai dele,
  // não do valor a cada tecla (digitar "100" no caminho zeraria os outros).
  const retrato = useRef<Record<string, number> | null>(null);
  const pesosAtuais = () => Object.fromEntries(d.linhas.map((l) => [l.devId, l.peso]));
  const ids = new Set(visiveis.map((v) => v.devId));
  const linhas = d.linhas.filter((l) => ids.has(l.devId));
  const totalOk = Math.abs(d.pesoTotal - 100) < 0.05;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Titulo ajuda="O valor liberado à equipe (verba × nota coletiva) é dividido entre os desenvolvedores. Pela porcentagem (padrão): cada um leva liberado × peso — Eduardo, Iury, João e Pablo recebem igual. Pela nota: a parte é proporcional a peso × nota individual. Peso padrão: Eduardo, Iury, João e Pablo iguais; os demais com metade; sem entrega no mês, 0%. Ao mudar o peso de um, a diferença é repartida entre os outros que têm peso, na proporção de cada um — a soma fica em 100%. O botão Salvar grava os pesos e o modo neste mês; os meses seguintes herdam até alguém mudar.">
            Desempenho por desenvolvedor — com peso no valor
          </Titulo>
          <p className="text-sm text-muted-foreground">As barras mostram a nota e o número de entregas. O valor liberado à equipe é dividido {modo === "peso" ? "pela porcentagem de cada um" : "por porcentagem × nota"}.</p>
          <div className="mt-3 inline-flex rounded-md border p-0.5 text-sm" role="radiogroup" aria-label="Como dividir">
            {([["peso", "Dividir pela porcentagem"], ["nota", "Dividir pela nota"]] as const).map(([m, rot]) => (
              <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
                className={`rounded px-3 py-1 transition-colors ${modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {rot}
              </button>
            ))}
          </div>
        </div>
        <div className="grid min-w-[16rem] gap-1 rounded-lg border bg-muted/30 px-4 py-2 text-sm">
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Valor liberado à equipe:</span><b className="tabular-nums">{moeda(d.base)}</b></div>
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Peso total considerado:</span><b className={`tabular-nums ${totalOk ? "" : "text-warning"}`}>{num(d.pesoTotal)}%</b></div>
        </div>
      </div>

      {linhas.length ? linhas.map((l) => (
        <div key={l.devId} className="mt-4 grid items-center gap-3 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="truncate">{l.devNome}</span><b className="tabular-nums">{num(l.nota)}/100</b></div>
            <Progress value={l.nota ?? 0} className="h-2" />
            <small className="text-muted-foreground">{l.entregas ? `${l.entregas} entrega(s)` : "0 entregas — sem entrega no mês"}</small>
          </div>
          <div className="flex gap-3 md:border-l md:pl-4">
            <label className="grid gap-1 text-center text-xs text-muted-foreground">Peso no valor
              <div className="relative">
                <Input type="number" min={0} max={100} step={1} className="w-24 pr-6 text-center font-semibold tabular-nums"
                  value={String(l.peso)}
                  onFocus={() => { retrato.current = pesosAtuais(); }}
                  onBlur={() => { retrato.current = null; }}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(",", "."));
                    setPesos(redistribuirPesos(retrato.current ?? pesosAtuais(), l.devId, Number.isFinite(n) ? n : 0));
                  }} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs">%</span>
              </div>
            </label>
            <div className="grid gap-1 text-center text-xs text-muted-foreground">Valor previsto
              <div className="flex h-10 min-w-[8rem] items-center justify-center rounded-md bg-muted/50 px-3 text-base font-semibold text-foreground tabular-nums">{moeda(l.valor)}</div>
            </div>
          </div>
        </div>
      )) : <Vazio>Nenhum desenvolvedor no filtro.</Vazio>}

      {!totalOk && <p className="mt-3 text-xs text-warning">Os pesos somam {num(d.pesoTotal)}% — ajuste para 100% para distribuir o valor liberado inteiro.</p>}

      <div className="mt-5 grid gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm md:grid-cols-3 md:divide-x">
        <div><b>Distribuído:</b> <span className="tabular-nums">{moeda(d.distribuido)}</span></div>
        <div className="md:pl-4"><b>Sem destino:</b> <span className="tabular-nums">{moeda(d.saldo)}</span>{d.saldo > 0 && <span className="text-xs text-muted-foreground"> ({modo === "peso" ? "pesos abaixo de 100%" : "ninguém com nota"})</span>}</div>
        <div className="flex flex-wrap items-center gap-2 md:pl-4">
          <span><b>Critério atual:</b> {modo === "peso" ? "pela porcentagem" : "pela nota"} · <span className={pendente ? "text-warning" : ""}>{situacao}</span></span>
          {!d.pesosPadrao && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPesos(pesosPadrao(devs))}>Pesos padrão</Button>}
          {pendente && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditado(null); setModoEditado(null); }}>Descartar</Button>}
          {podeSalvar && (
            <Button size="sm" className="h-7 gap-1 px-3" disabled={!pendente || fechado || !totalOk || salvar.isPending} onClick={salvarPesos}
              title={fechado ? "Período fechado: reabra para mudar os pesos." : !totalOk ? "Os pesos precisam somar 100%." : undefined}>
              <Save className="h-3.5 w-3.5" /> {salvar.isPending ? "Salvando…" : "Salvar pesos"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
