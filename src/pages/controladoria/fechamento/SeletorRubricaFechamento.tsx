import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROTULO_NAO_CUSTO, RUBRICAS, rubricaDeCusto, type LigacoesRubrica, type RubricaLigacao } from "../faturamento/regras";
import { useSalvarAjusteAdmClassificacao } from "./useAjustesAdm";

const GLOBAL = "_global";
const rotuloDe = (r: RubricaLigacao) => (r === "nao_custo" ? ROTULO_NAO_CUSTO : RUBRICAS.find((x) => x.id === r)!.label);

// Em qual coluna uma classificação entra na despesa administrativa DO FECHAMENTO. Diferente do seletor do Faturamento, a escolha aqui vale só
// no Fechamento (fechamento_adm_classificacao): a ligação global da Lucratividade é a base e continua valendo nas outras telas.
// "Fora do Total Desp. Adm" tira a classificação da despesa; "Seguir a Lucratividade" apaga o ajuste do Fechamento.
export function SeletorRubricaFechamento({
  classificacaoId, nome, globais, doFechamento, podeAlterar, rotuloNaoCusto = "Fora do Total Desp. Adm",
}: {
  classificacaoId: string | null;
  nome: string;
  globais: LigacoesRubrica | undefined;
  doFechamento: LigacoesRubrica | undefined;
  podeAlterar: boolean;
  rotuloNaoCusto?: string;
}) {
  const salvar = useSalvarAjusteAdmClassificacao();
  const ajuste = classificacaoId ? doFechamento?.get(classificacaoId) ?? null : null;
  const base: RubricaLigacao = (classificacaoId ? globais?.get(classificacaoId) : undefined) ?? rubricaDeCusto(nome) ?? "nao_custo";
  const efetiva = ajuste ?? base;
  const rotulo = (r: RubricaLigacao) => (r === "nao_custo" ? rotuloNaoCusto : rotuloDe(r));

  if (!classificacaoId || !podeAlterar) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">{rotulo(efetiva)}{ajuste ? " (ajustado no Fechamento)" : ""}</span>;
  }

  async function escolher(v: string) {
    try {
      await salvar.mutateAsync({ classificacaoId: classificacaoId!, rubrica: v === GLOBAL ? null : (v as RubricaLigacao) });
      toast.success(v === GLOBAL ? "Classificação voltou a seguir a Lucratividade." : `No Fechamento, a classificação agora conta em ${rotulo(v as RubricaLigacao)}.`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o ajuste.");
    }
  }

  return (
    <Select value={ajuste ?? GLOBAL} onValueChange={(v) => void escolher(v)} disabled={salvar.isPending}>
      <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL}>Seguir a Lucratividade ({rotulo(base)})</SelectItem>
        {RUBRICAS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
        <SelectItem value="nao_custo">{rotuloNaoCusto}</SelectItem>
      </SelectContent>
    </Select>
  );
}
