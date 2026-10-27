// =====================================================================
// Licitação › Contratos › Implantação (27/10/2026)
//
// Previsto (Planilha de Custo) × implantado (o que de fato roda) por posto.
// A Licitação registra a cada renovação — ou quando o tomador muda algo no
// meio do ano — e justifica toda diferença. É o implantado que os
// supervisores veem no Ativos/Contratos e na Efetividade.
// Regras em src/lib/licitacoes/implantacao.ts; banco na mig 20261027000010.
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  useContratoImplantacao, useContratoImplantacaoHistorico, useContratoImplantacaoSalvar,
} from "@/hooks/useContratoImplantacao";
import {
  errosImplantacao, paraPayload, proximaRenovacao, rotuloImplantado,
  type ContratoImplantacao, type LinhaForm,
} from "@/lib/licitacoes/implantacao";

const MENU = "licitacoes_contratos_implantacao";

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtData = (s: string | null) => (s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");

export function ImplantacaoTab() {
  const { data: contratos = [], isLoading, error } = useContratoImplantacao(true);
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [aberto, setAberto] = useState<ContratoImplantacao | null>(null);
  const hoje = hojeIso();

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return contratos
      .filter((c) => !soPendentes || c.pendente)
      .filter((c) => !q || c.nome.toLowerCase().includes(q) || (c.cliente ?? "").toLowerCase().includes(q));
  }, [contratos, busca, soPendentes]);

  const tot = useMemo(() => ({
    pendentes: contratos.filter((c) => c.pendente).length,
    previsto: contratos.reduce((s, c) => s + Number(c.previsto || 0), 0),
    implantado: contratos.reduce((s, c) => s + Number(c.implantado || 0), 0),
    comDiferenca: contratos.filter((c) => Number(c.implantado) !== Number(c.previsto)).length,
  }), [contratos]);

  // O contrato aberto acompanha o refetch depois de salvar.
  const abertoAtual = aberto ? contratos.find((c) => c.id === aberto.id) ?? aberto : null;

  if (error) {
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <ShieldAlert className="h-5 w-5 text-warning" /> {(error as Error).message}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumo rotulo="Previsto (Planilha de Custo)" valor={tot.previsto} />
        <Resumo rotulo="Implantado" valor={tot.implantado} />
        <Resumo rotulo="Contratos com diferença" valor={tot.comDiferenca} />
        <Resumo rotulo="Justificativa pendente" valor={tot.pendentes} alerta={tot.pendentes > 0} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por contrato ou cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} className="h-8 w-72 text-sm" />
        <button
          type="button"
          onClick={() => setSoPendentes((v) => !v)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            soPendentes ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50",
          )}
        >
          Só pendentes
        </button>
      </div>

      {isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Contrato</th>
                <th className="px-4 py-3 text-right font-medium">Previsto</th>
                <th className="px-4 py-3 text-right font-medium">Implantado</th>
                <th className="px-4 py-3 font-medium">Próxima renovação</th>
                <th className="px-4 py-3 font-medium">Último registro</th>
                <th className="px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visiveis.map((c) => {
                const diferente = Number(c.implantado) !== Number(c.previsto);
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setAberto(c)}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{c.nome}</p>
                      {c.cliente && <p className="text-[11px] text-muted-foreground">{c.cliente}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.previsto)}</td>
                    <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", diferente && "text-warning")}>{Number(c.implantado)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {c.base_ciclo ? fmtData(proximaRenovacao(c.base_ciclo, hoje)) : <span title="Contrato sem Vigência Inicial nem Data Início">sem data</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtData(c.ultimo_registro)}</td>
                    <td className="px-4 py-2.5">
                      {c.pendente ? (
                        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] font-semibold text-warning">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Justificar ciclo
                        </Badge>
                      ) : c.ultimo_registro ? (
                        <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] font-semibold text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Confirmado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Sem registro</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Nenhum contrato neste filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Previsto = QT. PESSOAS dos postos EXECUTADO vigentes da Planilha de Custo. Sem registro, o implantado é igual ao previsto.
        O ciclo renova no aniversário da Vigência Inicial (sem ela, da Data Início); registro feito até 60 dias antes já vale para o ciclo novo.
        Os supervisores veem o implantado em RH › Ativos/Contratos e em Operacional › Efetividade.
      </p>

      <DialogImplantacao contrato={abertoAtual} podeAlterar={podeAlterar} onClose={() => setAberto(null)} />
    </div>
  );
}

function Resumo({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <Card className={cn("p-4", alerta && "border-warning/40 bg-warning/5")}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", alerta && "text-warning")}>{valor.toLocaleString("pt-BR")}</p>
    </Card>
  );
}

function DialogImplantacao({ contrato, podeAlterar, onClose }: {
  contrato: ContratoImplantacao | null; podeAlterar: boolean; onClose: () => void;
}) {
  const salvar = useContratoImplantacaoSalvar();
  const { data: historico = [] } = useContratoImplantacaoHistorico(contrato?.id ?? null);
  const [linhas, setLinhas] = useState<LinhaForm[]>([]);
  const [valeDe, setValeDe] = useState(hojeIso());
  const [tentou, setTentou] = useState(false);

  // Recarrega o formulário só quando troca de contrato — não a cada refetch,
  // para não apagar o que está sendo digitado.
  const id = contrato?.id ?? null;
  useEffect(() => {
    if (!contrato) return;
    setLinhas(contrato.postos.map((p) => ({
      posto: p.posto, previsto: Number(p.previsto),
      implantado: String(Number(p.implantado)), justificativa: p.justificativa ?? "",
    })));
    setValeDe(hojeIso());
    setTentou(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const erros = errosImplantacao(linhas);
  const temErro = Object.keys(erros).length > 0;
  const muda = (posto: string, campo: "implantado" | "justificativa", v: string) =>
    setLinhas((ls) => ls.map((l) => (l.posto === posto ? { ...l, [campo]: v } : l)));

  async function confirmar() {
    if (!contrato) return;
    setTentou(true);
    if (temErro || !valeDe) return;
    await salvar.mutateAsync({ contratoId: contrato.id, valeAPartirDe: valeDe, postos: paraPayload(linhas) });
  }

  const previsto = linhas.reduce((s, l) => s + l.previsto, 0);
  const implantado = linhas.reduce((s, l) => s + (Number(l.implantado) || 0), 0);

  return (
    <Dialog open={!!contrato} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Implantação · {contrato?.nome}</DialogTitle>
        </DialogHeader>

        {contrato?.pendente && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              O ciclo começou em {fmtData(contrato.ciclo_inicio)} e ainda não foi confirmado. Revise posto a posto e registre — mesmo que
              tudo continue igual ao previsto.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label className="text-xs">Vale a partir de</Label>
            <Input type="date" value={valeDe} onChange={(e) => setValeDe(e.target.value)} disabled={!podeAlterar} className="h-8 w-44 text-sm" />
          </div>
          <p className="pb-1.5 text-sm text-muted-foreground">
            Total: <span className="font-semibold text-foreground">{rotuloImplantado(implantado, previsto)}</span>
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Posto</th>
                <th className="w-20 px-3 py-2 text-right">Previsto</th>
                <th className="w-28 px-3 py-2">Implantado</th>
                <th className="px-3 py-2">Justificativa da diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {linhas.map((l) => {
                const erro = tentou ? erros[l.posto] : undefined;
                const diferente = Number(l.implantado) !== l.previsto;
                return (
                  <tr key={l.posto} className="align-top">
                    <td className="px-3 py-2 font-medium">{l.posto}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.previsto}</td>
                    <td className="px-3 py-2">
                      <Input type="number" min={0} step={1} value={l.implantado} disabled={!podeAlterar}
                        onChange={(e) => muda(l.posto, "implantado", e.target.value)}
                        className={cn("h-8 w-20 text-sm tabular-nums", diferente && "border-warning")} />
                    </td>
                    <td className="px-3 py-2">
                      <Textarea rows={1} value={l.justificativa} disabled={!podeAlterar}
                        placeholder={diferente ? "Ex.: tomador pediu a suspensão do posto na renovação de 2026" : "Opcional quando igual ao previsto"}
                        onChange={(e) => muda(l.posto, "justificativa", e.target.value)}
                        className="min-h-8 text-sm" />
                      {erro && <p className="mt-1 text-[11px] font-medium text-destructive">{erro}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {historico.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><History className="h-3.5 w-3.5" /> Histórico</p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border">
                  {historico.map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{fmtData(h.registrado_em)}</td>
                      <td className="px-3 py-1.5">{h.posto}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{rotuloImplantado(h.implantado, Number(h.previsto))}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">desde {fmtData(h.vale_a_partir_de)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{h.justificativa ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{h.registrado_por_nome ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {podeAlterar && (
            <Button onClick={confirmar} disabled={salvar.isPending || (tentou && temErro)}>
              {salvar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Registrar implantação
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
