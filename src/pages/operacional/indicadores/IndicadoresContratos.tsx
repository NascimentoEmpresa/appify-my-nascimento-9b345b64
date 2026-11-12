import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CabecalhoIndicador, GradeCarregando, SemDados, ultimasCompetencias } from "@/components/indicadores/IndicadoresUi";
import { supabase } from "@/integrations/supabase/client";
import { useIndicadoresFaturamento } from "@/hooks/useIndicadoresFaturamento";
import { montarLucratividade } from "@/lib/operacional/indicadoresLucratividade";
import {
  filtrar, INDICADORES, montarLinhas, ordenar, resumir,
  type ChaveInd, type DadosContratosRpc, type Filtro, type Financeiro, type Ordem, type ResultadoInd, type StatusInd,
} from "@/lib/operacional/indicadoresContratos";
import { fmtBRL, rotuloCompetencia } from "@/lib/operacional/painelExecutivo";
import { totalCustos } from "@/pages/controladoria/faturamento/regras";
import { cn } from "@/lib/utils";

// =====================================================================
// Operacional › Indicadores › INDICADORES POR CONTRATO (11/11/2026)
// Os 7 indicadores da Gerência Operacional, uma linha por contrato, com o
// que está fora do esperado em destaque e ordem/filtro pelo pior.
// Mig 20261111100000 (ope_contratos_indicadores). Regras e limites:
// src/lib/operacional/indicadoresContratos.ts. Lucratividade e custo
// realizado: a conta de Controladoria › Faturamento da Empresa, com a
// empresa/base/código de nota escolhidos lá (useIndicadoresFaturamento).
// =====================================================================

const MENU = "ope_indicadores_contratos";

const COR: Record<StatusInd, string> = {
  critico: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  atencao: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  sem_dado: "bg-muted/40 text-muted-foreground ring-border",
  sem_fonte: "bg-muted/40 text-muted-foreground ring-border italic",
};

function Celula({ r }: { r: ResultadoInd }) {
  return (
    <div className="min-w-[8.5rem]" title={r.detalhe}>
      <span className={cn("inline-flex rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ring-1 ring-inset", COR[r.status])}>{r.texto}</span>
      <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{r.detalhe}</p>
    </div>
  );
}

export default function IndicadoresContratos() {
  const competencias = useMemo(() => ultimasCompetencias(), []);
  const [escolhida, setEscolhida] = useState<string | undefined>(undefined);
  // Abre no mês passado: o mês corrente ainda não tem as despesas lançadas.
  const competencia = escolhida ?? competencias[1];
  const [filtro, setFiltro] = useState<Filtro>({ busca: "", fora: null });
  const [ordem, setOrdem] = useState<Ordem>("pior");

  const q = useQuery({
    queryKey: ["ope-contratos-indicadores", competencia],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("ope_contratos_indicadores", { _competencia: competencia });
      if (error) throw error;
      return data as DadosContratosRpc;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const base = useIndicadoresFaturamento(Number(competencia.slice(0, 4)), true);
  const financeiro = useMemo(() => {
    if (base.erro) return { doMes: null, custoPorMes: null, carregando: false };
    if (base.carregando || !base.custos || !base.admPorMes) return { doMes: null, custoPorMes: null, carregando: true };
    const nomes = new Map([...base.contratos.entries()].map(([id, c]) => [id, c.nome]));
    const l = montarLucratividade({ nfs: base.nfs, contratos: nomes, custos: base.custos, admPorMes: base.admPorMes }, competencia);
    const doMes = new Map<string, Financeiro>(l.contratos.map((c) => [c.id, { receita: c.receita, custo: c.custo }]));
    const custoPorMes = new Map<string, number>();
    for (const [chave, c] of base.custos) custoPorMes.set(chave, totalCustos(c));
    return { doMes, custoPorMes, carregando: false };
  }, [base.erro, base.carregando, base.custos, base.admPorMes, base.contratos, base.nfs, competencia]);

  const linhas = useMemo(() => (q.data && !financeiro.carregando ? montarLinhas(q.data, financeiro) : null), [q.data, financeiro]);
  const resumo = useMemo(() => (linhas ? resumir(linhas) : null), [linhas]);
  const visiveis = useMemo(() => (linhas ? ordenar(filtrar(linhas, filtro), ordem) : []), [linhas, filtro, ordem]);
  const comAlerta = linhas?.filter((l) => l.gravidade > 0).length ?? 0;
  const sc = q.data?.sem_contrato;

  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={<SemDados texto="Você não tem acesso a esta tela." />}>
      <div className="space-y-5">
        <CabecalhoIndicador numero={6} titulo="Indicadores por Contrato" icone={Building2}
          descricao="Os 7 indicadores da Gerência Operacional, contrato a contrato: qual não está sendo entregue e qual está consumindo dinheiro."
          competencia={competencia} competencias={competencias} onCompetencia={setEscolhida} />

        {q.isError ? <SemDados texto="Não foi possível carregar os indicadores. Tente novamente." altura={120} /> : !linhas || !resumo ? <GradeCarregando n={7} /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {INDICADORES.map((i) => {
                const r = resumo.find((x) => x.chave === i.chave)!;
                const ativo = filtro.fora === i.chave;
                const fora = r.criticos + r.atencoes;
                return (
                  <button key={i.chave} type="button" onClick={() => setFiltro((f) => ({ ...f, fora: ativo ? null : i.chave }))}
                    className={cn("rounded-xl border bg-card p-3 text-left transition hover:border-primary/50", ativo && "border-primary ring-2 ring-primary/30")}>
                    <p className="text-xs font-medium text-muted-foreground">{i.curto}{i.medida === "parcial" && <span className="ml-1 rounded bg-muted px-1 text-[10px]">parcial</span>}</p>
                    <p className={cn("mt-1 text-2xl font-bold tabular-nums", r.criticos ? "text-red-600" : fora ? "text-amber-600" : "text-emerald-600")}>{fora}</p>
                    <p className="text-[11px] leading-tight text-muted-foreground">
                      {fora ? `${r.criticos} crítico(s) · ${r.atencoes} atenção` : "nenhum fora do esperado"}
                      {r.semFonte ? ` · ${r.semFonte} sem fonte` : ""}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar contrato ou cliente" value={filtro.busca}
                  onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))} />
              </div>
              <div className="sm:w-64">
                <label className="mb-1 block text-xs text-muted-foreground">Mostrar</label>
                <Select value={filtro.fora ?? "todos"} onValueChange={(v) => setFiltro((f) => ({ ...f, fora: v === "todos" ? null : (v as Filtro["fora"]) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os contratos</SelectItem>
                    <SelectItem value="algum">Com algum indicador fora ({comAlerta})</SelectItem>
                    {INDICADORES.map((i) => <SelectItem key={i.chave} value={i.chave}>Fora em {i.curto}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:w-56">
                <label className="mb-1 block text-xs text-muted-foreground">Ordenar por</label>
                <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pior">Pior primeiro (geral)</SelectItem>
                    {INDICADORES.map((i) => <SelectItem key={i.chave} value={i.chave}>Pior em {i.curto}</SelectItem>)}
                    <SelectItem value="nome">Nome do contrato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="overflow-x-auto p-2">
              {!visiveis.length ? <SemDados texto="Nenhum contrato com esse filtro" altura={120} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[14rem] bg-card">Contrato</TableHead>
                      {INDICADORES.map((i) => (
                        <TableHead key={i.chave} title={`${i.titulo} — ${i.pergunta}`}>
                          <button type="button" className={cn("text-left hover:text-foreground", ordem === i.chave && "font-semibold text-foreground")}
                            onClick={() => setOrdem(ordem === i.chave ? "pior" : (i.chave as ChaveInd))}>
                            {i.curto}{ordem === i.chave ? " ↓" : ""}
                          </button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiveis.map((l) => (
                      <TableRow key={l.id} className={cn(l.criticos > 0 && "bg-red-50/40 dark:bg-red-950/10")}>
                        <TableCell className="sticky left-0 z-10 max-w-[18rem] bg-card align-top">
                          <p className="truncate font-medium" title={l.nome}>{l.nome}</p>
                          {l.cliente && <p className="truncate text-xs text-muted-foreground" title={l.cliente}>{l.cliente}</p>}
                          {l.gravidade > 0 && <p className="mt-1 text-[11px] font-medium text-red-600">{l.criticos} crítico(s) · {l.atencoes} atenção</p>}
                        </TableCell>
                        {INDICADORES.map((i) => <TableCell key={i.chave} className="align-top"><Celula r={l.ind[i.chave]} /></TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            {sc && (sc.glosas_qtd > 0 || sc.reclamacoes_qtd > 0) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Notificações do Jurídico cujo contrato não liga a um contrato do ERP (não entram nas linhas):
                {sc.glosas_qtd > 0 && ` ${sc.glosas_qtd} glosa(s), ${fmtBRL(sc.glosas_valor)}`}
                {sc.glosas_qtd > 0 && sc.reclamacoes_qtd > 0 && " ·"}
                {sc.reclamacoes_qtd > 0 && ` ${sc.reclamacoes_qtd} notificação(ões) do cliente`}.
              </p>
            )}
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {rotuloCompetencia(competencia)}. <b>Postos</b>: implantado de Ativos/Contratos × quem está Trabalhando, posição de hoje.{" "}
                <b>Lucratividade</b>: líquido das notas − despesas do Fluxo de Caixa (Faturamento da Empresa), contra o lucro previsto na Planilha de Custo.{" "}
                <b>Custo × orçado</b>: despesas do Fluxo de Caixa × custo direto da Planilha de Custo, acumulado no ano, só nos meses com despesa lançada.{" "}
                <b>Glosas</b> e <b>reclamações</b>: Jurídico › Controle de Notificações, 90 dias.{" "}
                <b>Faltas</b>: dias de atestado (SST › Afastamentos) ÷ dias de trabalho do efetivo.{" "}
                <b>Turnover</b>: demissões no mês ÷ efetivo no fim do mês, a conta de Relatórios › Turn-over.
              </p>
              <p>
                Sem fonte no ERP: <b>satisfação do cliente</b> (não há pesquisa) e <b>falta injustificada</b> (o ponto não guarda a falta apurada) — por isso
                Faltas e Reclamações estão marcados como parciais. "sem fonte" e "—" nunca contam como zero.
                {base.empresaFiltrada && " A empresa escolhida no Faturamento da Empresa vale aqui: contrato de outra empresa fica sem lucratividade."}
              </p>
            </div>
          </>
        )}
      </div>
    </AcessoGate>
  );
}
