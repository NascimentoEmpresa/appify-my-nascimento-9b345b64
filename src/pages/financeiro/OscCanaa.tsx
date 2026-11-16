import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { Download, GraduationCap, Loader2 } from "lucide-react";
import { calcularOsc, type EntradaOsc } from "@/lib/oscFinanceiro";
import {
  MENU_OSC_CANAA, useOscDados, useOscPagamentosMalote, useOscParcerias,
} from "@/hooks/useOscCanaa";
import { CtxOsc, erroMsg } from "./osc-canaa/comum";
import { PainelOsc } from "./osc-canaa/PainelOsc";
import { CompetenciasOsc } from "./osc-canaa/CompetenciasOsc";
import { RubricasOsc } from "./osc-canaa/RubricasOsc";
import { PagamentosOsc } from "./osc-canaa/PagamentosOsc";
import { CenariosOsc } from "./osc-canaa/CenariosOsc";
import { ReservasOsc } from "./osc-canaa/ReservasOsc";
import { InvestimentosOsc } from "./osc-canaa/InvestimentosOsc";
import { ConfiguracaoOsc } from "./osc-canaa/ConfiguracaoOsc";
import { HistoricoOsc } from "./osc-canaa/HistoricoOsc";
import { exportarOscExcel } from "./osc-canaa/exportarOsc";

// SIS-2026-0922 — OSC Canaã: Gestão Financeira da Escola (Financeiro).
// Substitui a planilha manual "Canaa_Previsao_Investimentos.xlsx": repasse,
// despesas por rubrica, aplicações/reservas de férias e 13º, saldo do mês,
// acumulado, projeção até dezembro e planejamento de investimentos.
// O realizado vem dos pagamentos confirmados no Malote (RPC
// osc_pagamentos_malote — mesma fonte do Fluxo de Caixa); o cálculo é
// src/lib/oscFinanceiro.ts. Acesso: menu 'financeiro-osc-canaa' (migration
// 20261117092200), ações incluir/alterar/excluir/aprovar/exportar.

const ANO_ATUAL = new Date().getFullYear();

export default function OscCanaa() {
  const { data: podeIncluir = false } = useScreenAccess(MENU_OSC_CANAA, "incluir");
  const { data: podeAlterar = false } = useScreenAccess(MENU_OSC_CANAA, "alterar");
  const { data: podeExcluir = false } = useScreenAccess(MENU_OSC_CANAA, "excluir");
  const { data: podeAprovar = false } = useScreenAccess(MENU_OSC_CANAA, "aprovar");
  const { data: podeExportar = false } = useScreenAccess(MENU_OSC_CANAA, "exportar");

  const parcerias = useOscParcerias();
  const [parceriaId, setParceriaId] = useState<string | null>(null);
  const [ano, setAno] = useState<number>(ANO_ATUAL);
  const [aba, setAba] = useState("painel");
  useEffect(() => {
    if (!parceriaId && parcerias.data?.length) setParceriaId(parcerias.data.find((p) => p.ativo)?.id ?? parcerias.data[0].id);
  }, [parcerias.data, parceriaId]);

  const parceria = parcerias.data?.find((p) => p.id === parceriaId) ?? null;
  const dados = useOscDados(parceriaId, ano);
  const pagamentos = useOscPagamentosMalote(parceriaId, ano);

  const ctx: CtxOsc | null = useMemo(() => {
    if (!parceria || !dados.data || !pagamentos.data) return null;
    const d = dados.data;
    const entrada: EntradaOsc = {
      ano,
      hoje: new Date(),
      repasseMensal: parceria.repasse_mensal,
      saldoInicial: d.ano?.saldo_inicial ?? 0,
      reservaExtra: d.ano?.reserva_extra ?? 0,
      rubricas: d.rubricas.map((r) => ({ id: r.id, nome: r.nome, grupo: r.grupo, tipo: r.tipo, ordem: r.ordem, recorrente: r.recorrente })),
      previsoes: d.previsoes,
      previsoesMes: d.previsoesMes,
      competencias: d.competencias,
      lancamentos: d.lancamentos,
      pagamentos: pagamentos.data,
      projetos: d.projetos,
    };
    return {
      parceria, ano, dados: d, pagamentos: pagamentos.data, entrada, resultado: calcularOsc(entrada),
      perms: { incluir: !!podeIncluir, alterar: !!podeAlterar, excluir: !!podeExcluir, aprovar: !!podeAprovar, exportar: !!podeExportar },
    };
  }, [parceria, dados.data, pagamentos.data, ano, podeIncluir, podeAlterar, podeExcluir, podeAprovar, podeExportar]);

  const anos = [ANO_ATUAL + 1, ANO_ATUAL, ANO_ATUAL - 1, ANO_ATUAL - 2];
  const carregando = parcerias.isLoading || dados.isLoading || pagamentos.isLoading;
  const erro = parcerias.error || dados.error || pagamentos.error;

  return (
    <div className="space-y-4">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Gestão Financeira", "OSC Canaã"]}
        title={parceria ? `${parceria.nome} | Gestão Financeira da Escola` : "OSC Canaã | Gestão Financeira da Escola"}
        subtitle="Repasses, despesas pagas no Malote, reservas, saldos, projeção até dezembro e planejamento de investimentos."
        actions={
          <>
            {(parcerias.data?.length ?? 0) > 1 && (
              <Select value={parceriaId ?? ""} onValueChange={setParceriaId}>
                <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Parceria" /></SelectTrigger>
                <SelectContent>{parcerias.data!.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
            </Select>
            <AcessoGate menu={MENU_OSC_CANAA} acao="exportar">
              <Button
                variant="outline" size="sm" className="h-9 gap-1" disabled={!ctx}
                onClick={() => { try { exportarOscExcel(ctx!); } catch (e) { toast.error(erroMsg(e)); } }}
              >
                <Download className="h-4 w-4" />Exportar Excel
              </Button>
            </AcessoGate>
          </>
        }
      />

      {erro ? (
        <Card><CardContent className="p-6 text-sm text-red-600">Não foi possível carregar: {erroMsg(erro)}</CardContent></Card>
      ) : carregando ? (
        <div className="flex items-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div>
      ) : !parceria ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <GraduationCap className="h-5 w-5" />Nenhuma parceria OSC cadastrada.
          </CardContent>
        </Card>
      ) : ctx ? (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="painel">Painel</TabsTrigger>
            <TabsTrigger value="competencias">Competências</TabsTrigger>
            <TabsTrigger value="rubricas">Despesas por rubrica</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos do Malote</TabsTrigger>
            <TabsTrigger value="cenarios">Projeção e cenários</TabsTrigger>
            <TabsTrigger value="reservas">Reservas e lançamentos</TabsTrigger>
            <TabsTrigger value="investimentos">Investimentos</TabsTrigger>
            <TabsTrigger value="configuracao">Plano de trabalho</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="painel"><PainelOsc ctx={ctx} irPara={setAba} /></TabsContent>
          <TabsContent value="competencias"><CompetenciasOsc ctx={ctx} /></TabsContent>
          <TabsContent value="rubricas"><RubricasOsc ctx={ctx} /></TabsContent>
          <TabsContent value="pagamentos"><PagamentosOsc ctx={ctx} /></TabsContent>
          <TabsContent value="cenarios"><CenariosOsc ctx={ctx} /></TabsContent>
          <TabsContent value="reservas"><ReservasOsc ctx={ctx} /></TabsContent>
          <TabsContent value="investimentos"><InvestimentosOsc ctx={ctx} /></TabsContent>
          <TabsContent value="configuracao"><ConfiguracaoOsc ctx={ctx} /></TabsContent>
          <TabsContent value="historico"><HistoricoOsc ctx={ctx} /></TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
