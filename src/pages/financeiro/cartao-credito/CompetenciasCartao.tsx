import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileText, ListTree, Upload } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useFaturasImportadas, urlArquivoFaturaAssinada } from "@/hooks/useCartaoFatura";
import { useItensParaClassificar } from "@/hooks/useCartaoFaturaRateio";

// SIS-2026-0751: ao clicar em "Fatura" de um cartão, em vez de abrir direto o formulário de
// importação, lista as 12 competências do ano (jan–dez, navegando de ano em ano): as já
// importadas mostram arquivo/classificação; as que faltam levam pro import daquele mês.

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function CompetenciasCartao({ cartaoId, onImportar }: { cartaoId: string; onImportar: (competenciaYYYYMM: string) => void }) {
  const { data: faturas = [] } = useFaturasImportadas();
  const { data: itens = [] } = useItensParaClassificar();
  const { can } = usePermissoes();
  const podeClassificar = can("visualizar", "financeiro", "financeiro-cartao-credito-classificar");
  const [ano, setAno] = useState(new Date().getFullYear());

  const faturaPorMes = useMemo(() => new Map(faturas.filter((f) => f.cartao_id === cartaoId).map((f) => [f.competencia.slice(0, 7), f])), [faturas, cartaoId]);
  const resumoPorMes = useMemo(() => {
    const m = new Map<string, { itens: number; pendentes: number; total: number }>();
    for (const i of itens) {
      if (i.cartao_id !== cartaoId) continue;
      const k = i.competencia.slice(0, 7);
      const r = m.get(k) ?? { itens: 0, pendentes: 0, total: 0 };
      r.itens++;
      r.total += Number(i.valor) || 0;
      if (i.qtd_rateio === 0) r.pendentes++;
      m.set(k, r);
    }
    return m;
  }, [itens, cartaoId]);

  async function abrirArquivo(path: string) {
    try {
      const url = await urlArquivoFaturaAssinada(path)();
      if (url) window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível abrir o arquivo da fatura.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAno((a) => a - 1)} title="Ano anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="w-16 text-center text-sm font-semibold">{ano}</span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAno((a) => a + 1)} title="Próximo ano">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="divide-y rounded-md border">
        {MESES.map((nome, idx) => {
          const chave = `${ano}-${String(idx + 1).padStart(2, "0")}`;
          const f = faturaPorMes.get(chave);
          const r = resumoPorMes.get(chave) ?? { itens: 0, pendentes: 0, total: 0 };
          return (
            <div key={chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="w-28 text-sm font-medium">{String(idx + 1).padStart(2, "0")}/{ano}</span>
              <span className="w-24 text-xs text-muted-foreground">{nome}</span>
              {f ? (
                <>
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Importada</Badge>
                  <span className="text-xs text-muted-foreground">
                    {r.itens} {r.itens === 1 ? "item" : "itens"} · {formatBRL(r.total)}
                  </span>
                  {r.itens > 0 &&
                    (r.pendentes > 0 ? (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{r.pendentes} sem classificação · fora do Fluxo</Badge>
                    ) : (
                      <Badge variant="secondary">Classificada · no Fluxo</Badge>
                    ))}
                  <div className="ml-auto flex items-center gap-1">
                    {f.arquivo_original_path && (
                      <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => abrirArquivo(f.arquivo_original_path!)}>
                        <FileText className="h-3.5 w-3.5" /> Abrir
                      </Button>
                    )}
                    {podeClassificar && r.itens > 0 && (
                      <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                        <Link to={`/app/financeiro/gestao-financeira/cartao-credito/classificar?cartao=${cartaoId}&competencia=${chave}`}>
                          <ListTree className="h-3.5 w-3.5" /> Classificar
                        </Link>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => onImportar(chave)}>
                      <Upload className="h-3.5 w-3.5" /> Reimportar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="text-muted-foreground">Não importada</Badge>
                  <Button variant="outline" size="sm" className="ml-auto h-8 gap-1 text-xs" onClick={() => onImportar(chave)}>
                    <Upload className="h-3.5 w-3.5" /> Importar
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
