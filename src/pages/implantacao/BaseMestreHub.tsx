// BASE MESTRE DE INÍCIO DE CONTRATO — o hub (SIS-2026-0599), mockup
// "Base mestre controle licitação.png". Mostra quais bases já compõem a
// implantação e quais estão sem registro, que é a pergunta que o José faz
// antes de qualquer outra coisa.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Database, Users, Layers, MapPin, Building2, Coins, RefreshCw, Banknote, ShoppingCart, FileText, CalendarCheck2, CheckCircle2,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SemAcesso } from "@/components/layout/SemAcesso";
import { PageHeader } from "@/components/layout/PageHeader";
import { CartaoIndicador, PainelGrafico, EstadoVazio, CabecalhoTabela } from "@/components/suprimentos/dashboard/PainelBase";
import { useContratosDaBase, useResumoBase, useAtualizarDaBase, brl, num } from "@/hooks/useImplantacaoBase";

const CORES = ["#2f8fea", "#f0883e", "#4ec9a5", "#9b8cf5", "#f5b73d"];

export default function BaseMestreHub() {
  return (
    <AcessoGate menu="implantacao.base" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [params, setParams] = useSearchParams();
  const contratoId = params.get("contrato") ?? "";
  const { data: contratos = [] } = useContratosDaBase();
  const { data: resumo, isLoading } = useResumoBase(contratoId || null);
  const atualizar = useAtualizarDaBase();

  const composicao = useMemo(
    () =>
      resumo
        ? [
            { nome: "Postos", valor: resumo.qt_postos },
            { nome: "Locais", valor: resumo.qt_locais },
            { nome: "Tipos de serviço", valor: resumo.qt_tipos_servico },
            { nome: "Uniformes e EPI", valor: resumo.qt_itens_uniforme },
            { nome: "Materiais", valor: resumo.qt_itens_material },
          ].filter((c) => c.valor > 0)
        : [],
    [resumo],
  );

  const totalRegistros = composicao.reduce((s, c) => s + c.valor, 0);

  const bases = resumo
    ? [
        { icone: <Banknote className="h-4 w-4" />, nome: "Financeiro", qtd: resumo.qt_tipos_servico, area: "Financeiro", conteudo: "Postos, valores e quantidades" },
        { icone: <Users className="h-4 w-4" />, nome: "RH", qtd: resumo.qt_tipos_servico, area: "RH", conteudo: "Tipos de serviço, salários, escalas" },
        { icone: <Building2 className="h-4 w-4" />, nome: "Operacional", qtd: resumo.qt_locais, area: "Operacional", conteudo: "Locais, cidades e endereços" },
        { icone: <ShoppingCart className="h-4 w-4" />, nome: "Compras", qtd: resumo.qt_itens_uniforme + resumo.qt_itens_material, area: "Compras", conteudo: "Itens e quantidades por cargo" },
        { icone: <CalendarCheck2 className="h-4 w-4" />, nome: "Controle de Prazos", qtd: resumo.qt_prazos, area: "Financeiro", conteudo: "Datas limite e responsáveis" },
        { icone: <FileText className="h-4 w-4" />, nome: "Documentação", qtd: resumo.qt_documentos, area: "Financeiro", conteudo: "Entregas e status documental" },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <PageHeader
        title="Base Mestre de Início de Contrato"
        subtitle="Centralize os dados-base que alimentam Financeiro, RH, Operacional e Compras na implantação do contrato."
        breadcrumb={["Implantação", "Base Mestre"]}
        module="Licitações"
        actions={
          <Button size="sm" variant="outline" disabled={!contratoId || atualizar.isPending} onClick={() => atualizar.mutate(contratoId)}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${atualizar.isPending ? "animate-spin" : ""}`} /> Atualizar da base
          </Button>
        }
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[280px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Contrato</label>
            <Select value={contratoId} onValueChange={(v) => setParams({ contrato: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o contrato" /></SelectTrigger>
              <SelectContent>
                {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {resumo?.sincronizado_em && (
            <p className="pb-2 text-xs text-slate-500">
              Atualizado em {new Date(resumo.sincronizado_em).toLocaleString("pt-BR")}
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !resumo ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm font-semibold text-slate-700">
              {contratoId ? "Este contrato ainda não tem base mestre." : "Escolha um contrato."}
            </p>
            {contratoId && (
              <p className="mx-auto mt-2 max-w-md text-xs text-slate-500">
                Use "Atualizar da base" para puxar postos, locais e enxoval do que já existe no ERP, ou importe as
                planilhas pela tela de cadastro.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <CartaoIndicador titulo="Contrato" valor={resumo.contrato_nome ?? "—"} icone={<Database className="h-5 w-5" />} tom="blue" />
            <CartaoIndicador titulo="Postos" valor={num(resumo.qt_postos)} icone={<Layers className="h-5 w-5" />} tom="green" />
            <CartaoIndicador titulo="Colaboradores" valor={num(resumo.qt_colaboradores)} icone={<Users className="h-5 w-5" />} tom="amber" />
            <CartaoIndicador titulo="Locais" valor={num(resumo.qt_locais)} icone={<MapPin className="h-5 w-5" />} tom="violet" />
            <CartaoIndicador titulo="Cidades" valor={num(resumo.qt_cidades)} icone={<Building2 className="h-5 w-5" />} tom="slate" />
            <CartaoIndicador titulo="Valor Mensal" valor={brl(resumo.valor_mensal)} icone={<Coins className="h-5 w-5" />} tom="blue" />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <PainelGrafico titulo="Bases que compõem a implantação">
              <div className="space-y-2">
                {bases.map((b) => (
                  <div key={b.nome} className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50/60 px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className={b.qtd ? "text-emerald-600" : "text-slate-400"}>{b.icone}</span>
                      <span className="text-sm font-semibold text-slate-800">{b.nome}</span>
                    </div>
                    <Badge variant="outline" className={b.qtd ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}>
                      {b.qtd ? "Base disponível" : "Sem registros"}
                    </Badge>
                  </div>
                ))}
              </div>
            </PainelGrafico>

            <PainelGrafico titulo="Composição da base">
              {composicao.length ? (
                <div className="relative h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={composicao} dataKey="valor" nameKey="nome" innerRadius={64} outerRadius={96} paddingAngle={2}>
                        {composicao.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-slate-900">{num(totalRegistros)}</span>
                    <span className="text-xs text-slate-500">Registros totais</span>
                  </div>
                </div>
              ) : (
                <EstadoVazio texto="Base ainda sem registros." />
              )}
            </PainelGrafico>

            <PainelGrafico titulo="Dados contratuais principais">
              <div className="space-y-2.5 text-sm">
                <Linha rotulo="Cliente / Órgão" valor={resumo.cliente ?? "—"} />
                <Linha rotulo="CNPJ contratante" valor={resumo.cnpj_contratante ?? "Não informado"} />
                <Linha rotulo="Objeto" valor={resumo.objeto ?? "Não informado"} />
                <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Situação</p>
                    <p className="text-xs text-emerald-700">
                      {resumo.qt_postos && resumo.qt_locais ? "Pronto para parametrização inicial." : "Base incompleta — faltam postos ou locais."}
                    </p>
                  </div>
                </div>
              </div>
            </PainelGrafico>
          </div>

          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-semibold text-slate-800">Cadastros Mestres</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <CabecalhoTabela>Base</CabecalhoTabela>
                      <CabecalhoTabela>Conteúdo Principal</CabecalhoTabela>
                      <CabecalhoTabela alinhar="right">Qtde de Registros</CabecalhoTabela>
                      <CabecalhoTabela alinhar="center">Status</CabecalhoTabela>
                      <CabecalhoTabela>Área Usuária</CabecalhoTabela>
                    </tr>
                  </thead>
                  <tbody>
                    {bases.map((b) => (
                      <tr key={b.nome} className="border-b last:border-0 hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-800">{b.nome}</td>
                        <td className="px-3 py-2 text-slate-600">{b.conteudo}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(b.qtd)}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="outline" className={b.qtd ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}>
                            {b.qtd ? "Disponível" : "Sem registros"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{b.area}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold">
                      <td className="px-3 py-2">Total Geral</td>
                      <td className="px-3 py-2">{bases.filter((b) => b.qtd).length} base(s) com registro</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(bases.reduce((s, b) => s + b.qtd, 0))}</td>
                      <td className="px-3 py-2" colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-slate-50/60 px-3 py-2">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-sm font-medium text-slate-800">{valor}</p>
    </div>
  );
}
