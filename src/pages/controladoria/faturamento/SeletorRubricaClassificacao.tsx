import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { ROTULO_NAO_CUSTO, RUBRICAS, rubricaDeCusto, type RubricaLigacao } from "./regras";
import { useLigacoesRubrica, useSalvarLigacaoRubrica } from "./useLigacoesRubrica";

const AUTO = "_auto";
const rotuloDe = (r: RubricaLigacao) => (r === "nao_custo" ? ROTULO_NAO_CUSTO : RUBRICAS.find((x) => x.id === r)!.label);

// Em qual coluna (rubrica) uma classificação entra nos relatórios da Controladoria. Usa a mesma ligação manual do painel "Rubricas de custo"
// da Lucratividade (lucratividade_rubrica_classificacao): vale para todos os meses e telas. "Automático" volta à regra pelo nome da classificação.
// Quem não tem a ação Alterar em "Lucratividade — Rubricas de custo" só vê a rubrica atual.
export function SeletorRubricaClassificacao({ classificacaoId, nome }: { classificacaoId: string | null; nome: string }) {
  const { data: ligacoes } = useLigacoesRubrica();
  const { data: podeAlterar } = useScreenAccess("lucratividade-rubricas", "alterar");
  const salvar = useSalvarLigacaoRubrica();
  const manual = classificacaoId ? ligacoes?.get(classificacaoId) ?? null : null;
  const automatica: RubricaLigacao = rubricaDeCusto(nome) ?? "nao_custo";
  const efetiva = manual ?? automatica;

  if (!classificacaoId || !podeAlterar) {
    return <span className="whitespace-nowrap text-xs text-muted-foreground">{rotuloDe(efetiva)}{manual ? " (manual)" : ""}</span>;
  }

  async function escolher(v: string) {
    try {
      await salvar.mutateAsync({ classificacaoId: classificacaoId!, rubrica: v === AUTO ? null : (v as RubricaLigacao) });
      toast.success(v === AUTO ? "Classificação voltou ao automático." : `Classificação agora conta em ${rotuloDe(v as RubricaLigacao)}.`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar a rubrica.");
    }
  }

  return (
    <Select value={manual ?? AUTO} onValueChange={(v) => void escolher(v)} disabled={salvar.isPending}>
      <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>Automático ({rotuloDe(automatica)})</SelectItem>
        {RUBRICAS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
        <SelectItem value="nao_custo">{ROTULO_NAO_CUSTO}</SelectItem>
      </SelectContent>
    </Select>
  );
}
