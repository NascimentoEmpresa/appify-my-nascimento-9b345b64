// PÁGINA DO SETOR NA IMPLANTAÇÃO — /app/licitacoes/implantacao/painel/:setor
//
// O setor é o slug do "Resp. ação" das perguntas (ver painelSetores.ts). A
// página reúne as respostas desse setor (+ as comuns a todos) e é onde o
// setor confirma o recebimento. A confirmação guarda a assinatura das
// respostas: se alguém muda uma resposta depois, ela aparece desatualizada
// e o setor confirma de novo.
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardCheck, ListChecks, Pencil, RotateCcw, ShieldAlert, Timer } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";
import {
  useConfirmarSetor, useDesfazerConfirmacaoSetor, usePainelImplantacao,
} from "@/hooks/useImplantacaoPainel";
import { setorPorSlug } from "@/lib/implantacao/painelSetores";
import { cn } from "@/lib/utils";
import {
  BarraContrato, BarraProgresso, CartaoKpi, SeloStatus, Vazio,
} from "./PainelComponentes";
import { rotaFormulario, rotaPainel, rotaSetor } from "./rotasPainel";

const MENU_CONFIRMAR = "licitacoes-implantacao-confirmar-setor";

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PainelSetor() {
  const { setor: slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { contratos, contrato, itens, painel, carregando, erro } = usePainelImplantacao(params.get("contrato"));
  const contratoId = contrato?.id ?? null;
  const setor = setorPorSlug(itens, slug);
  const resumo = painel.setores.find((s) => s.setor === setor) ?? null;
  const confirmar = useConfirmarSetor();
  const desfazer = useDesfazerConfirmacaoSetor();
  const { data: usuarios = [] } = useUsuariosEmpresa();
  const nomeUsuario = useMemo(() => {
    const m = new Map(usuarios.map((u) => [u.id, u.display_name ?? u.email ?? u.id]));
    return (id: string | null) => (id ? m.get(id) ?? "usuário" : "—");
  }, [usuarios]);

  const pizza = resumo
    ? [
        { nome: "Respondidos", valor: resumo.respondidos, cor: "#10b981" },
        { nome: "Pendentes", valor: resumo.pendentes, cor: "#f59e0b" },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={setor ? `Implantação — ${setor}` : "Implantação — setor"}
        breadcrumb={["Implantação", "Painel por setor", setor ?? slug]}
        subtitle="Respostas do checklist de Implantação destinadas a este setor (Resp. ação), atualizadas a partir do formulário."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={rotaPainel(contratoId)}><ArrowLeft className="mr-1.5 h-4 w-4" /> Resumo geral</Link>
            </Button>
            {setor && (
              <Button asChild size="sm">
                <Link to={rotaFormulario(contratoId, setor)}><Pencil className="mr-1.5 h-4 w-4" /> Preencher / Atualizar</Link>
              </Button>
            )}
          </>
        }
      />

      {carregando ? (
        <Vazio titulo="Carregando…" />
      ) : erro ? (
        <Vazio titulo="Erro" mensagem={erro.message} tom="error" />
      ) : !setor || !resumo ? (
        <Vazio titulo="Setor não encontrado" mensagem="Nenhuma pergunta do checklist tem este setor como responsável." />
      ) : !contrato ? (
        <Vazio titulo="Nenhum contrato" />
      ) : (
        <>
          <BarraContrato
            contratos={contratos}
            contrato={contrato}
            onTrocar={(id) => setParams({ contrato: id }, { replace: true })}
          />

          {/* Atalhos para os outros setores do mesmo contrato */}
          <div className="flex flex-wrap gap-2">
            {painel.setores.map((s) => (
              <Link
                key={s.setor}
                to={rotaSetor(s.slug, contratoId)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  s.setor === setor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {s.setor}
              </Link>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CartaoKpi icone={ListChecks} rotulo="Respondidos" valor={`${resumo.respondidos} / ${resumo.total}`} tom="azul" />
            <CartaoKpi icone={Timer} rotulo="Pendências" valor={String(resumo.pendentes)} detalhe="campos sem resposta" tom="ambar" />
            <CartaoKpi icone={CheckCircle2} rotulo="Preenchimento" valor={`${resumo.pct}%`} tom="verde" />
            <div className="card-elevated flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status do setor</p>
                <SeloStatus status={resumo.status} className="mt-2" />
              </div>
              <div className="h-16 w-16">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pizza} dataKey="valor" nameKey="nome" innerRadius={18} outerRadius={30} strokeWidth={0}>
                      {pizza.map((p) => <Cell key={p.nome} fill={p.cor} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <BarraProgresso
            titulo={`Preenchimento — ${setor}`}
            detalhe={`${resumo.respondidos} de ${resumo.total} campos respondidos`}
            pct={resumo.pct}
          />

          {/* Confirmação de recebimento */}
          <div className={cn(
            "card-elevated flex flex-wrap items-center gap-3 p-4",
            resumo.status === "concluido" && "border-emerald-300 dark:border-emerald-500/40",
            resumo.confirmacaoDesatualizada && "border-amber-300 dark:border-amber-500/40",
          )}>
            <ClipboardCheck className="h-6 w-6 shrink-0 text-muted-foreground" />
            <div className="min-w-[200px] flex-1 text-sm">
              <p className="font-semibold">Confirmação de recebimento</p>
              {resumo.status === "concluido" && resumo.confirmacao ? (
                <p className="text-xs text-muted-foreground">
                  Confirmado por <b className="text-foreground">{nomeUsuario(resumo.confirmacao.confirmado_por)}</b> em {dataHora(resumo.confirmacao.confirmado_em)}.
                </p>
              ) : resumo.confirmacaoDesatualizada && resumo.confirmacao ? (
                <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Confirmado em {dataHora(resumo.confirmacao.confirmado_em)}, mas alguma resposta mudou depois. Confira e confirme de novo.
                </p>
              ) : resumo.prontoParaConfirmar ? (
                <p className="text-xs text-muted-foreground">Todas as informações do setor foram preenchidas. Confira e confirme o recebimento.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Preencha os {resumo.pendentes} campo{resumo.pendentes === 1 ? "" : "s"} pendente{resumo.pendentes === 1 ? "" : "s"} para habilitar a confirmação do setor.</p>
              )}
            </div>
            <AcessoGate menu={MENU_CONFIRMAR} acao="visualizar">
              <div className="flex gap-2">
                {resumo.confirmacao && (
                  <Button
                    size="sm" variant="outline" disabled={desfazer.isPending}
                    onClick={() => desfazer.mutate({ contratoId: contrato.id, setor })}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Desfazer
                  </Button>
                )}
                <Button
                  size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!resumo.prontoParaConfirmar || confirmar.isPending}
                  onClick={() => confirmar.mutate({ contratoId: contrato.id, setor, assinatura: resumo.assinatura })}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirmar recebimento
                </Button>
              </div>
            </AcessoGate>
          </div>

          {/* Todas as informações do setor */}
          <div className="card-elevated overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-display text-base font-bold">Informações do setor</h2>
              <p className="text-xs text-muted-foreground">Cada linha é uma pergunta do checklist; "comum" = pergunta cujo responsável é Todos.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Pergunta</th>
                    <th className="px-4 py-2 font-medium">Resposta</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Plano de ação</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Onde</th>
                    <th className="w-8 px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {resumo.linhas.map((l) => (
                    <tr key={l.row_index} className={cn("align-top", !l.respondido && "bg-amber-50/40 dark:bg-amber-500/5")}>
                      <td className="px-4 py-2 font-medium">
                        {l.pergunta}
                        {l.comum && <span className="ml-1 rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">comum</span>}
                      </td>
                      <td className={cn("max-w-[320px] px-4 py-2", !l.respondido && "font-medium text-amber-600")}>
                        {l.respondido ? l.valor : "Não preenchido"}
                      </td>
                      <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">{l.plano_acao ?? "—"}</td>
                      <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">{l.onde ?? "—"}</td>
                      <td className="px-4 py-2">
                        {l.respondido
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          : <Timer className="h-4 w-4 text-amber-500" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
