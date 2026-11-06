// Aba "Pesos e regras dos critérios": pesos, pontos de dificuldade,
// referência de valor e o fechamento do mês. Gravar exige 'alterar' em
// sistemas_bonificacao_regras; fechar/reabrir, 'aprovar' (RLS + gatilho).
import { useEffect, useState } from "react";
import { Lock, LockOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSalvarPeriodo } from "@/hooks/useBonificacaoColetiva";
import {
  CRITERIOS,
  DIFICULDADES,
  ROTULO_CRITERIO,
  ROTULO_DIFICULDADE,
  intervaloDaCompetencia,
  linhaDaConfig,
  rotuloCompetencia,
  validarPesos,
  validarPontosDificuldade,
  validarReferencia,
  type ConfigBonificacao,
  type Criterio,
  type Dificuldade,
  type PeriodoResolvido,
  type ReferenciaValor,
  PERCENTIL_REFERENCIA,
  MIN_ENTREGAS_REFERENCIA,
  PISO_VALOR,
} from "@/lib/sistemas/bonificacaoColetiva";
import { AJUDA, Ajuda, Titulo, dataBr, moeda } from "./comum";

const AJUDA_CRITERIO: Record<Criterio, string> = {
  qualidade: AJUDA.qualidade, satisfacao: AJUDA.satisfacao, prazo: AJUDA.prazo, dificuldade: AJUDA.dificuldade, valor: AJUDA.valor,
};

export function AbaRegras({ periodo, referencia: refMes, podeAlterar, podeAprovar, fotoDoResultado }: {
  periodo: PeriodoResolvido;
  /** Régua do Valor efetiva no mês (relativa às entregas, ou a fixa). */
  referencia: ReferenciaValor;
  podeAlterar: boolean;
  podeAprovar: boolean;
  /** Resultado atual, gravado em `resultado` no fechamento. */
  fotoDoResultado: () => Record<string, unknown>;
}) {
  const salvar = useSalvarPeriodo();
  const [pesos, setPesos] = useState<Record<Criterio, string>>({} as Record<Criterio, string>);
  const [pontos, setPontos] = useState<Record<Dificuldade, string>>({} as Record<Dificuldade, string>);
  const [referencia, setReferencia] = useState("");
  const [confirmar, setConfirmar] = useState<null | "fechar" | "reabrir">(null);

  const cfg = periodo.config;
  useEffect(() => {
    setPesos(Object.fromEntries(CRITERIOS.map((k) => [k, String(cfg.pesos[k])])) as Record<Criterio, string>);
    setPontos(Object.fromEntries(DIFICULDADES.map((k) => [k, String(cfg.pontosDificuldade[k])])) as Record<Dificuldade, string>);
    setReferencia(String(cfg.referenciaValor));
  }, [cfg, periodo.mes]);

  const travado = periodo.fechado || !podeAlterar;
  const somaPesos = CRITERIOS.reduce((a, k) => a + (Number(pesos[k]) || 0), 0);
  const { competencia } = intervaloDaCompetencia(periodo.mes);

  const gravar = (novo: ConfigBonificacao, msg: string) => {
    salvar.mutate({ competencia, verba: periodo.verba, ...linhaDaConfig(novo) }, {
      onSuccess: () => toast.success(msg),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
    });
  };

  const aplicarPesos = () => {
    const p = Object.fromEntries(CRITERIOS.map((k) => [k, Number(pesos[k])])) as Record<Criterio, number>;
    const erro = validarPesos(p);
    if (erro) { toast.error(erro); return; }
    gravar({ ...cfg, pesos: p }, "Pesos aplicados. As notas foram recalculadas.");
  };
  const aplicarDificuldade = () => {
    const p = Object.fromEntries(DIFICULDADES.map((k) => [k, Number(pontos[k])])) as Record<Dificuldade, number>;
    const erro = validarPontosDificuldade(p);
    if (erro) { toast.error(erro); return; }
    gravar({ ...cfg, pontosDificuldade: p }, "Pontos de dificuldade aplicados.");
  };
  const aplicarReferencia = () => {
    const n = Number(referencia.replace(",", "."));
    const erro = validarReferencia(n);
    if (erro) { toast.error(erro); return; }
    gravar({ ...cfg, referenciaValor: Math.round(n * 100) / 100 }, "Referência de valor aplicada.");
  };

  const fecharOuReabrir = () => {
    const acao = confirmar;
    setConfirmar(null);
    const linha = acao === "fechar"
      ? { competencia, verba: periodo.verba, ...linhaDaConfig(cfg), fechado_em: new Date().toISOString(), resultado: fotoDoResultado() }
      : { competencia, fechado_em: null };
    salvar.mutate(linha, {
      onSuccess: () => toast.success(acao === "fechar" ? "Período fechado." : "Período reaberto."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível concluir."),
    });
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Titulo ajuda={AJUDA.abaRegras}>Quanto vale cada critério na nota final? — {rotuloCompetencia(periodo.mes)}</Titulo>
        <p className="mb-3 text-sm text-muted-foreground">
          Defina o peso de cada um dos cinco critérios. A soma deve ser de 100%. Ao salvar, os resultados da equipe, os individuais e as tarefas do mês são recalculados.
          {periodo.herdadoDe && (
            <> Este mês ainda não tem configuração própria: {periodo.herdadoDe === "padrao" ? "valem os padrões" : `herdada de ${rotuloCompetencia(periodo.herdadoDe)}`} — aplicar grava para o mês.</>
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {CRITERIOS.map((k) => (
            <div key={k} className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center font-medium">{ROTULO_CRITERIO[k]}<Ajuda texto={AJUDA_CRITERIO[k]} /></div>
              <p className="text-xs text-muted-foreground">Peso na nota final</p>
              <div className="mt-2 flex items-center gap-1">
                <Input type="number" min={0} max={100} step={1} value={pesos[k] ?? ""} disabled={travado}
                  onChange={(e) => setPesos((p) => ({ ...p, [k]: e.target.value }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm">
          Soma dos pesos: <b className={somaPesos === 100 ? "text-success" : "text-destructive"}>{somaPesos}%</b> — necessário 100%.
        </p>
        {!travado && <Button className="mt-2" onClick={aplicarPesos} disabled={salvar.isPending}>Aplicar pesos</Button>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <Titulo ajuda={AJUDA.dificuldade}>Grau de dificuldade: pontos base</Titulo>
          <p className="mb-3 text-sm text-muted-foreground">Pontos (0 a 100) que cada nível vale no critério Dificuldade. Regra da empresa: a IA só classifica o nível.</p>
          <div className="grid grid-cols-2 gap-3">
            {DIFICULDADES.map((d) => (
              <label key={d} className="text-xs text-muted-foreground">{ROTULO_DIFICULDADE[d]} (0 a 100)
                <Input type="number" min={0} max={100} value={pontos[d] ?? ""} disabled={travado}
                  onChange={(e) => setPontos((p) => ({ ...p, [d]: e.target.value }))} />
              </label>
            ))}
          </div>
          {!travado && <Button className="mt-3" onClick={aplicarDificuldade} disabled={salvar.isPending}>Aplicar dificuldade</Button>}
        </Card>

        <Card className="p-5">
          <Titulo ajuda={AJUDA.referencia}>Critério de valor da tarefa</Titulo>
          <p className="mb-3 text-sm text-muted-foreground">
            Toda entrega vale no mínimo {PISO_VALOR} — um bug rápido que destrava muita gente é tão entrega quanto um sistema novo. O valor de mercado (IA) só diferencia de {PISO_VALOR} a 100, comparado com a régua do mês: o percentil {Math.round(PERCENTIL_REFERENCIA * 100)} das entregas do período.
          </p>
          <p className="mb-3 rounded-md bg-muted/40 p-3 text-sm">
            Régua de {rotuloCompetencia(periodo.mes)}: <b>{moeda(refMes.valor)}</b> = nota 100{" "}
            <span className="text-muted-foreground">
              {refMes.automatica
                ? `(calculada sobre ${refMes.base} entrega(s) com valor da IA)`
                : `(referência fixa abaixo: o mês tem ${refMes.base} entrega(s) com valor da IA, menos de ${MIN_ENTREGAS_REFERENCIA})`}
            </span>
          </p>
          <label className="text-xs text-muted-foreground">Referência fixa, só para mês com menos de {MIN_ENTREGAS_REFERENCIA} entregas com valor (R$)
            <Input type="number" min={1} step={500} value={referencia} disabled={travado} onChange={(e) => setReferencia(e.target.value)} />
          </label>
          {!travado && <Button className="mt-3" onClick={aplicarReferencia} disabled={salvar.isPending}>Aplicar referência</Button>}
          <p className="mt-3 rounded-md border-l-4 border-primary bg-muted/40 p-3 text-xs text-muted-foreground">
            Os valores de <b>mercado, freelancer e CLT</b> ficam visíveis nos detalhes e consolidados. Não devem ser somados como receita nem usados como prova automática de economia. Valide as estimativas da IA por escopo, horas e premissas.
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <Titulo ajuda={AJUDA.fechamento}>Fechamento do período</Titulo>
        {periodo.fechado ? (
          <p className="text-sm">
            <Lock className="mr-1 inline h-4 w-4 text-warning" />
            {rotuloCompetencia(periodo.mes)} está <b>fechado</b> desde {dataBr(periodo.linha?.fechado_em ?? null)}. Verba, configuração e avaliações das entregas do mês estão travadas.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {rotuloCompetencia(periodo.mes)} está aberto (simulação). Verba atual: {moeda(periodo.verba)}. Fechar grava a foto do resultado e trava o mês.
          </p>
        )}
        {podeAprovar && (
          <Button className="mt-3" variant={periodo.fechado ? "outline" : "default"} disabled={salvar.isPending}
            onClick={() => setConfirmar(periodo.fechado ? "reabrir" : "fechar")}>
            {salvar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : periodo.fechado ? <LockOpen className="mr-1.5 h-4 w-4" /> : <Lock className="mr-1.5 h-4 w-4" />}
            {periodo.fechado ? "Reabrir período" : "Fechar período"}
          </Button>
        )}
        {!podeAlterar && !podeAprovar && (
          <p className="mt-2 text-xs text-muted-foreground">Você só visualiza as regras. Configurar e fechar o período dependem de liberação em “Bonificação Coletiva — Verba, pesos e fechamento”.</p>
        )}
      </Card>

      <Card className="p-5">
        <Titulo>Como cada nota é formada</Titulo>
        <Table>
          <TableHeader><TableRow><TableHead>Critério</TableHead><TableHead>Regra de conversão para nota (0–100)</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow><TableCell>Qualidade</TableCell><TableCell>Atendeu sem ajuste = 100; ajuste pequeno = 50; retrabalho = 0 (sugestão: nenhuma reabertura / 1 / 2 ou mais)</TableCell></TableRow>
            <TableRow><TableCell>Satisfação</TableCell><TableCell>Nota do solicitante na avaliação do chamado (1 a 5) ÷ 5 × 100</TableCell></TableRow>
            <TableRow><TableCell>Prazo</TableCell><TableCell>Dentro do prazo = 100; fora do prazo = 0 (situação gravada na conclusão do chamado)</TableCell></TableRow>
            <TableRow><TableCell>Dificuldade</TableCell><TableCell>Fácil, médio, difícil ou muito difícil = pontos configuráveis (IA: complexidade 1 = fácil, 2–3 = médio, 4 = difícil, 5 = muito difícil)</TableCell></TableRow>
            <TableRow><TableCell>Valor</TableCell><TableCell>{PISO_VALOR} + {100 - PISO_VALOR} × (valor de mercado da IA ÷ régua do mês), limitado a 100. Régua = percentil {Math.round(PERCENTIL_REFERENCIA * 100)} do valor de mercado das entregas do mês</TableCell></TableRow>
          </TableBody>
        </Table>
        <p className="mt-3 text-sm text-muted-foreground">
          Nota final = soma de cada (nota do critério × peso ÷ 100). Critério sem dado numa entrega (ex.: solicitante não avaliou) fica fora da média e os pesos dos demais são redistribuídos.
          A nota consolidada da equipe define o total liberado, dividido igualmente entre todos os participantes. A política deve ser validada antes da adoção.
        </p>
      </Card>

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === "fechar" ? "Fechar" : "Reabrir"} {rotuloCompetencia(periodo.mes)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "fechar"
                ? "O resultado atual (nota, liberado, participantes e cota) fica gravado e o mês trava para edição."
                : "A foto do resultado é descartada e o mês volta a ser recalculado com os dados atuais."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={fecharOuReabrir}>{confirmar === "fechar" ? "Fechar período" : "Reabrir período"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
