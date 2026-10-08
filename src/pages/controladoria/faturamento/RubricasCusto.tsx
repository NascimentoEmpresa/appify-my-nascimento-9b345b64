import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { LigacoesRubrica, LinhaFluxoCusto, ROTULO_NAO_CUSTO, RUBRICAS, RubricaLigacao, rubricaDeCusto } from "./regras";
import { useSalvarLigacaoRubrica } from "./useLigacoesRubrica";

// Painel de ligação Classificação (Malote) × Rubrica de custo da Lucratividade.
// O automático (nome casa → rubrica certa; o resto → Outras) vale para toda
// classificação sem escolha manual; aqui a Controladoria liga a outra coluna
// ou marca "Não é custo". Só mexe nas colunas da Lucratividade, não no Malote.

const AUTO = "_auto";
type Filtro = "todas" | "outras" | "manuais" | "nao_custo";

const rotuloDe = (r: RubricaLigacao) => (r === "nao_custo" ? ROTULO_NAO_CUSTO : RUBRICAS.find((x) => x.id === r)!.label);

interface Props {
  linhasMes: LinhaFluxoCusto[];
  ligacoes: LigacoesRubrica;
  podeEditar: boolean;
  rotuloMes: string;
}

export function RubricasCusto({ linhasMes, ligacoes, podeEditar, rotuloMes }: Props) {
  const { data: classificacoes = [], isLoading } = useClassificacoesOrcamento();
  const salvar = useSalvarLigacaoRubrica();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const gastoPorClassificacao = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linhasMes) {
      if (l.tipo !== "saida" || !l.contrato_id || !l.classificacao_id) continue;
      m.set(l.classificacao_id, (m.get(l.classificacao_id) ?? 0) + (l.valor || 0));
    }
    return m;
  }, [linhasMes]);

  const itens = useMemo(
    () =>
      classificacoes.map((c) => {
        const manual = ligacoes.get(c.id) ?? null;
        const auto: RubricaLigacao = rubricaDeCusto(c.nome) ?? "nao_custo";
        return { id: c.id, nome: c.nome, manual, auto, efetiva: manual ?? auto, gasto: gastoPorClassificacao.get(c.id) ?? 0 };
      }),
    [classificacoes, ligacoes, gastoPorClassificacao]
  );

  const blocos = useMemo(() => {
    const ordem: RubricaLigacao[] = [...RUBRICAS.map((r) => r.id), "nao_custo"];
    return ordem.map((r) => {
      const dele = itens.filter((i) => i.efetiva === r);
      return { id: r, label: rotuloDe(r), itens: dele, gasto: dele.reduce((s, i) => s + i.gasto, 0) };
    });
  }, [itens]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens
      .filter((i) => (!termo || i.nome.toLowerCase().includes(termo)) && (
        filtro === "todas" || (filtro === "outras" && i.efetiva === "outras") || (filtro === "manuais" && i.manual) || (filtro === "nao_custo" && i.efetiva === "nao_custo")
      ))
      .sort((a, b) => b.gasto - a.gasto || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [itens, busca, filtro]);

  async function mudar(classificacaoId: string, valor: string) {
    try {
      await salvar.mutateAsync({ classificacaoId, rubrica: valor === AUTO ? null : (valor as RubricaLigacao) });
      toast.success(valor === AUTO ? "Voltou ao automático." : "Ligação salva.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar a ligação.");
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Cada classificação do Malote entra numa coluna de custo da Lucratividade. As que casam pelo nome (Salário, Férias, FGTS, VA, VT…) já estão ligadas; o resto cai em
        <strong> Outras Despesas</strong>. Escolha outra coluna para ligar, ou “{ROTULO_NAO_CUSTO}” para tirar do cálculo. Valores: saídas com contrato pagas em {rotuloMes}.
        {!podeEditar && " Você pode ver as ligações, mas não alterá-las."}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {blocos.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setFiltro(b.id === "nao_custo" ? "nao_custo" : b.id === "outras" ? "outras" : "todas")}
            className="card-elevated p-3 text-left space-y-1 hover:ring-1 hover:ring-primary/40 transition"
          >
            <p className="text-xs font-semibold">{b.label}</p>
            <p className="text-[11px] text-muted-foreground">{b.itens.length} classificaç{b.itens.length === 1 ? "ão" : "ões"} · {fmtMoney(b.gasto)}</p>
            <p className="text-[11px] text-muted-foreground line-clamp-2">
              {b.itens.length ? b.itens.slice(0, 4).map((i) => i.nome).join(", ") + (b.itens.length > 4 ? ` +${b.itens.length - 4}` : "") : "—"}
            </p>
          </button>
        ))}
      </div>

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
        <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
          <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as classificações</SelectItem>
            <SelectItem value="outras">Só em Outras Despesas</SelectItem>
            <SelectItem value="manuais">Só ligadas manualmente</SelectItem>
            <SelectItem value="nao_custo">Só “{ROTULO_NAO_CUSTO}”</SelectItem>
          </SelectContent>
        </Select>
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar classificação..." className="h-8 w-[240px] text-xs" />
        <span className="ml-auto text-muted-foreground">{visiveis.length} de {itens.length}</span>
      </div>

      <div className="card-elevated overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Classificação</TableHead>
              <TableHead className="w-[260px]">Rubrica</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Gasto em {rotuloMes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.nome}</TableCell>
                <TableCell>
                  <Select value={i.manual ?? AUTO} onValueChange={(v) => mudar(i.id, v)} disabled={!podeEditar || salvar.isPending}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO}>Automático ({rotuloDe(i.auto)})</SelectItem>
                      {RUBRICAS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                      <SelectItem value="nao_custo">{ROTULO_NAO_CUSTO}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={i.manual ? "default" : "outline"}>{i.manual ? "Manual" : "Automático"}</Badge>
                </TableCell>
                <TableCell className="text-right">{i.gasto ? fmtMoney(i.gasto) : "—"}</TableCell>
              </TableRow>
            ))}
            {visiveis.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma classificação neste filtro.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
