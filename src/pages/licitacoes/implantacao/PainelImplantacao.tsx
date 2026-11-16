// RESUMO GERAL DA IMPLANTAÇÃO DO CONTRATO — /app/licitacoes/implantacao/painel
//
// Lê as respostas já gravadas no checklist da Implantação e as agrupa pelo
// "Resp. ação" de cada pergunta (um cartão e uma página por setor). Não tem
// formulário próprio: preencher/alterar continua na tela de Implantação, e
// o painel se recalcula a partir do mesmo cache. A rota fica sob
// /app/licitacoes/implantacao, então o acesso é o mesmo menu
// 'licitacoes.implantacao' (matchMenuCode pega o prefixo).
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardList, FileText, Gauge, Layers } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { usePainelImplantacao } from "@/hooks/useImplantacaoPainel";
import type { StatusSetor } from "@/lib/implantacao/painelSetores";
import {
  BarraContrato, BarraProgresso, CartaoKpi, CartaoSetor, FluxoImplantacao, Vazio,
} from "./PainelComponentes";
import { rotaFormulario } from "./rotasPainel";

const COR_STATUS: Record<StatusSetor, string> = {
  concluido: "#10b981",
  em_andamento: "#3b82f6",
  pendente: "#f59e0b",
};

export default function PainelImplantacao() {
  const [params, setParams] = useSearchParams();
  const { contratos, contrato, painel, carregando, erro } = usePainelImplantacao(params.get("contrato"));
  const contratoId = contrato?.id ?? null;

  const dadosGrafico = painel.setores.map((s) => ({ setor: s.setor, pct: s.pct, status: s.status, rotulo: `${s.respondidos}/${s.total}` }));
  const pendentesItens = painel.setores.reduce((n, s) => n + s.pendentes, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Implantação do Contrato"
        breadcrumb={["Implantação", "Painel por setor"]}
        subtitle="As respostas do checklist de Implantação, separadas pelo setor responsável (Resp. ação) de cada pergunta."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={rotaFormulario(contratoId)}><ClipboardList className="mr-1.5 h-4 w-4" /> Abrir checklist</Link>
          </Button>
        }
      />

      {carregando ? (
        <Vazio titulo="Carregando…" />
      ) : erro ? (
        <Vazio titulo="Erro" mensagem={erro.message} tom="error" />
      ) : !contrato ? (
        <Vazio titulo="Nenhum contrato" mensagem="Promova licitações ganhas no módulo Capa de Edital para criar contratos aqui." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CartaoKpi icone={FileText} rotulo="Contrato" valor={contrato.nome} tom="azul" />
            <CartaoKpi icone={Layers} rotulo="Setores acionados" valor={`${painel.acionados} / ${painel.totalSetores}`} detalhe="com resposta nas próprias perguntas" tom="roxo" />
            <CartaoKpi icone={AlertTriangle} rotulo="Pendências" valor={String(painel.pendencias)} detalhe={`setores sem confirmação · ${pendentesItens} campo${pendentesItens === 1 ? "" : "s"} em aberto`} tom="ambar" />
            <CartaoKpi icone={Gauge} rotulo="Progresso" valor={`${painel.progressoPct}%`} detalhe={`${painel.itensRespondidos}/${painel.itensTotal} perguntas respondidas`} tom="verde" />
          </div>

          <BarraContrato
            contratos={contratos}
            contrato={contrato}
            onTrocar={(id) => setParams({ contrato: id }, { replace: true })}
          />

          <FluxoImplantacao painel={painel} contratoId={contratoId} />

          <BarraProgresso
            titulo="Progresso geral da implantação"
            detalhe={`${painel.confirmados} de ${painel.totalSetores} setores confirmados`}
            pct={painel.progressoPct}
          />

          <div className="card-elevated p-4">
            <h2 className="font-display text-base font-bold">Preenchimento por setor</h2>
            <p className="mb-3 text-xs text-muted-foreground">Percentual de perguntas respondidas de cada setor (inclui as comuns a todos).</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dadosGrafico} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="setor" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, _n, p) => [`${v}% (${(p.payload as { rotulo: string }).rotulo})`, "Respondido"]} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {dadosGrafico.map((d) => <Cell key={d.setor} fill={COR_STATUS[d.status]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h2 className="font-display text-base font-bold">Detalhes por Setor</h2>
            <p className="mb-3 text-xs text-muted-foreground">Lance, confira e confirme as informações de cada setor para a implantação do contrato.</p>
            {painel.setores.length === 0 ? (
              <Vazio titulo="Checklist vazio" mensagem="Nenhuma pergunta com responsável cadastrado." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {painel.setores.map((s) => <CartaoSetor key={s.setor} resumo={s} contratoId={contratoId} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
