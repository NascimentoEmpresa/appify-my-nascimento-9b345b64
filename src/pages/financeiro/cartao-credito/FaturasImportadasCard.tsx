import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, ListTree } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useFaturasImportadas, urlArquivoFaturaAssinada, type FaturaImportadaLinha } from "@/hooks/useCartaoFatura";
import { useItensParaClassificar } from "@/hooks/useCartaoFaturaRateio";

// SIS-2026-0751: faturas importadas (BB, Banrisul...) ficavam "soltas" — o arquivo ia pro
// storage sem botão pra abrir e a classificação por item morava só em outra tela, sem
// nenhum caminho a partir do Cartão. Aqui cada fatura mostra o arquivo, quantos itens
// faltam classificar e leva direto pra tela de classificação já filtrada nela.

const fmtMes = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });

async function abrirArquivo(path: string) {
  try {
    const url = await urlArquivoFaturaAssinada(path)();
    if (url) window.open(url, "_blank", "noopener");
  } catch (e: any) {
    toast.error(e.message ?? "Não foi possível abrir o arquivo da fatura.");
  }
}

function LinhaFatura({ f, itens, pendentes, total, podeClassificar }: { f: FaturaImportadaLinha; itens: number; pendentes: number; total: number; podeClassificar: boolean }) {
  const destino = `/app/financeiro/gestao-financeira/cartao-credito/classificar?cartao=${f.cartao_id}&competencia=${f.competencia.slice(0, 7)}`;
  return (
    <TableRow>
      <TableCell className="text-sm">{f.nome_cartao}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">{fmtMes(f.competencia)}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {f.importado_em ? new Date(f.importado_em).toLocaleDateString("pt-BR") : "—"}
      </TableCell>
      <TableCell className="text-sm text-center">{itens}</TableCell>
      <TableCell className="text-right text-sm font-medium whitespace-nowrap">{formatBRL(total)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {itens === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : pendentes > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="A fatura só vai pro Fluxo de Caixa depois de classificada">
            {pendentes} {pendentes === 1 ? "item pendente" : "itens pendentes"} · fora do Fluxo
          </Badge>
        ) : (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Classificada · no Fluxo</Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {f.arquivo_original_path ? (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => abrirArquivo(f.arquivo_original_path!)}>
            <FileText className="mr-1 h-3.5 w-3.5" /> Abrir fatura
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Sem arquivo</span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {podeClassificar && itens > 0 && (
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Link to={destino}>
              <ListTree className="h-3.5 w-3.5" /> Classificar
            </Link>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function FaturasImportadasCard({ competencia, cartaoId }: { competencia: string; cartaoId: string }) {
  const { data: faturas = [] } = useFaturasImportadas();
  const { data: itens = [] } = useItensParaClassificar();
  const { can } = usePermissoes();
  const podeClassificar = can("visualizar", "financeiro", "financeiro-cartao-credito-classificar");

  const resumo = useMemo(() => {
    const porFatura = new Map<string, { itens: number; pendentes: number; total: number }>();
    for (const i of itens) {
      const chave = `${i.cartao_id}|${i.competencia}`;
      const r = porFatura.get(chave) ?? { itens: 0, pendentes: 0, total: 0 };
      r.itens++;
      r.total += Number(i.valor) || 0;
      if (i.qtd_rateio === 0) r.pendentes++;
      porFatura.set(chave, r);
    }
    return porFatura;
  }, [itens]);

  const visiveis = faturas.filter(
    (f) => (!competencia || f.competencia.slice(0, 7) === competencia) && (!cartaoId || f.cartao_id === cartaoId),
  );

  if (faturas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Faturas importadas</CardTitle>
        <p className="text-xs text-muted-foreground">
          Faturas anexadas pelo botão Importar fatura (cartões que não são consolidados no Fluxo). Abra o arquivo original e
          classifique os itens por Classificação e Contrato: a fatura só entra no Fluxo de Caixa (uma linha, no vencimento) depois de toda classificada. Respeita os filtros de Competência e Cartão acima.
        </p>
      </CardHeader>
      <CardContent>
        {visiveis.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma fatura importada com esse filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cartão</TableHead>
                  <TableHead>Fatura</TableHead>
                  <TableHead>Importada em</TableHead>
                  <TableHead className="text-center">Itens</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((f) => {
                  const r = resumo.get(`${f.cartao_id}|${f.competencia}`) ?? { itens: 0, pendentes: 0, total: 0 };
                  return <LinhaFatura key={f.id} f={f} itens={r.itens} pendentes={r.pendentes} total={r.total} podeClassificar={podeClassificar} />;
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
