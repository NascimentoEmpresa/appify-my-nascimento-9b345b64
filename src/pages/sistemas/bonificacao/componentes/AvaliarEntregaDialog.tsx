// Avaliação do gestor sobre uma entrega (BONIFICACAO_DEV_ENTREGA):
// qualidade, dificuldade e valores. Vem preenchido com o que vale hoje
// (sugestão "sem ajuste" — reabertura não é erro, 06/11/2026 — / parecer da IA) — salvar grava como avaliado.
import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useGerarParecerIa, useLimparAvaliacao, useSalvarAvaliacao } from "@/hooks/useBonificacaoColetiva";
import {
  DIFICULDADES,
  QUALIDADES,
  ROTULO_DIFICULDADE,
  ROTULO_QUALIDADE,
  dificuldadeDaComplexidade,
  qualidadeSugerida,
  type Dificuldade,
  type EntregaDetalhada,
  type Qualidade,
} from "@/lib/sistemas/bonificacaoColetiva";
import { moeda } from "./comum";

const paraNumero = (s: string): number | null => {
  // "6.400,50" (BR) ou "6400.50": com vírgula, ponto é milhar.
  const bruto = s.trim().replace(/[R$\s]/g, "");
  const t = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const paraTexto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

export function AvaliarEntregaDialog({ entrega, aberto, aoFechar, fechado }: {
  entrega: EntregaDetalhada | null; aberto: boolean; aoFechar: () => void; fechado: boolean;
}) {
  const salvar = useSalvarAvaliacao();
  const limpar = useLimparAvaliacao();
  const ia = useGerarParecerIa();
  const [qualidade, setQualidade] = useState<Qualidade>("sem_ajuste");
  const [dificuldade, setDificuldade] = useState<Dificuldade | "">("");
  const [mercado, setMercado] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [clt, setClt] = useState("");
  const [fora, setFora] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");

  useEffect(() => {
    if (!entrega) return;
    setQualidade(entrega.qualidade ?? "sem_ajuste");
    setDificuldade(entrega.dificuldade ?? "");
    setMercado(paraTexto(entrega.valorMercado));
    setFreelancer(paraTexto(entrega.valorFreelancer));
    setClt(paraTexto(entrega.valorClt));
    setFora(entrega.foraDaBonificacao);
    setMotivo(entrega.motivoExclusao ?? "");
    setObs(entrega.observacao ?? "");
  }, [entrega]);

  if (!entrega) return null;
  const iaSugerida = dificuldadeDaComplexidade(entrega.iaComplexidade);
  const temAvaliacao = entrega.qualidadeAvaliada || entrega.dificuldadeAvaliada || entrega.valoresAvaliados || entrega.foraDaBonificacao;

  const gravar = () => {
    const vm = paraNumero(mercado), vf = paraNumero(freelancer), vc = paraNumero(clt);
    if ([vm, vf, vc].some((n) => Number.isNaN(n))) { toast.error("Valores devem ser números maiores ou iguais a zero."); return; }
    if (fora && motivo.trim().length < 5) { toast.error("Conte por que a entrega fica fora da bonificação (mínimo 5 letras)."); return; }
    salvar.mutate({
      chamado_id: entrega.chamadoId,
      qualidade,
      dificuldade: dificuldade || null,
      valor_mercado: vm,
      valor_freelancer: vf,
      valor_clt: vc,
      fora_da_bonificacao: fora,
      motivo_exclusao: fora ? motivo.trim() : null,
      observacao: obs.trim() || null,
    }, {
      onSuccess: () => { toast.success("Avaliação da entrega salva."); aoFechar(); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
    });
  };

  const voltarSugestoes = () => limpar.mutate(entrega.chamadoId, {
    onSuccess: () => { toast.success("Entrega voltou para as sugestões automáticas."); aoFechar(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível limpar."),
  });

  const pedirIa = () => ia.mutate(entrega.chamadoId, {
    onSuccess: () => toast.success("Parecer da IA gerado. Os valores sugeridos foram atualizados."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "A IA não respondeu."),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Avaliar entrega {entrega.numero ? `· ${entrega.numero}` : ""}</DialogTitle>
          <DialogDescription>{entrega.assunto} — {entrega.devNome}</DialogDescription>
        </DialogHeader>

        {fechado && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Período fechado: reabra o período em “Pesos e regras” para mudar esta avaliação.</p>
        )}

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Qualidade</Label>
            <Select value={qualidade} onValueChange={(v) => setQualidade(v as Qualidade)} disabled={fechado}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{QUALIDADES.map((q) => <SelectItem key={q} value={q}>{ROTULO_QUALIDADE[q]}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Sugestão: {ROTULO_QUALIDADE[qualidadeSugerida(entrega.reaberturas)]}. Reaberturas ({entrega.reaberturas}) não contam como erro — marque ajuste ou retrabalho só se houve correção de fato.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Dificuldade</Label>
            <Select value={dificuldade} onValueChange={(v) => setDificuldade(v as Dificuldade)} disabled={fechado}>
              <SelectTrigger><SelectValue placeholder="Sem dificuldade definida" /></SelectTrigger>
              <SelectContent>{DIFICULDADES.map((d) => <SelectItem key={d} value={d}>{ROTULO_DIFICULDADE[d]}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {entrega.iaComplexidade !== null
                ? <>IA: complexidade {entrega.iaComplexidade}/5 → {iaSugerida ? ROTULO_DIFICULDADE[iaSugerida] : "—"}.</>
                : <>Sem parecer da IA {entrega.iaStatus === "erro" ? "(a última tentativa deu erro)" : entrega.iaStatus === "pendente" ? "(em geração)" : ""}.</>}
            </p>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Valores estimados (R$)</Label>
              {entrega.iaStatus !== "pronto" && !fechado && (
                <Button type="button" size="sm" variant="outline" onClick={pedirIa} disabled={ia.isPending}>
                  {ia.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Estimar com IA
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">Mercado<Input inputMode="decimal" value={mercado} onChange={(e) => setMercado(e.target.value)} disabled={fechado} /></label>
              <label className="text-xs text-muted-foreground">Freelancer<Input inputMode="decimal" value={freelancer} onChange={(e) => setFreelancer(e.target.value)} disabled={fechado} /></label>
              <label className="text-xs text-muted-foreground">CLT<Input inputMode="decimal" value={clt} onChange={(e) => setClt(e.target.value)} disabled={fechado} /></label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mercado = software house do parecer da IA; CLT = equipe interna. Só o valor de mercado entra na nota.
              {entrega.horasGastas !== null && <> Horas informadas pelo dev: {String(entrega.horasGastas).replace(".", ",")} h.</>}
              {entrega.iaStatus !== "pronto" && <> A IA só estima chamado concluído com as horas gastas informadas.</>}
            </p>
            {entrega.valorMercado !== null && !entrega.valoresAvaliados && (
              <p className="text-[11px] text-muted-foreground">Hoje vale o da IA: {moeda(entrega.valorMercado)}.</p>
            )}
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              Fora da bonificação
              <Switch checked={fora} onCheckedChange={setFora} disabled={fechado} />
            </label>
            {fora && (
              <Textarea placeholder="Por que esta entrega não conta? (ex.: chamado de dúvida, entrega duplicada)" value={motivo}
                onChange={(e) => setMotivo(e.target.value)} disabled={fechado} rows={2} />
            )}
            <p className="text-[11px] text-muted-foreground">A entrega sai da nota coletiva e, se for a única do dev no mês, ele sai do rateio.</p>
          </div>

          <div className="grid gap-1.5">
            <Label>Observação (opcional)</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} disabled={fechado} rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {temAvaliacao && !fechado
            ? <Button variant="ghost" onClick={voltarSugestoes} disabled={limpar.isPending}>Voltar às sugestões</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={aoFechar}>Cancelar</Button>
            <Button onClick={gravar} disabled={fechado || salvar.isPending}>
              {salvar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salvar avaliação
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
