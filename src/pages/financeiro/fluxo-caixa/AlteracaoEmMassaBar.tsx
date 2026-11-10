import { useMemo, useState } from "react";
import { AlertTriangle, Info, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useAlteracaoEmMassaFluxo, useIntegrantesFluxo, type ResultadoAlteracaoEmMassa } from "@/hooks/useFluxoCaixaMalote";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useContasBanco } from "@/hooks/useContasBanco";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { rotuloConta } from "@/lib/contaBanco";
import {
  chaveDaLinhaMassa, contarMotivos, planejarAtribuicaoDeConta, planejarTrocaDeCentroDeCusto, planejarTrocaDeClassificacao, planejarTrocaDeIntegrante, type LinhaMassa, type PlanoMassa, type TipoMassa,
} from "./alteracaoEmMassa";

// SIS-2026-0780: barra "Alteração em massa" do Fluxo de Caixa. Quem usa (Controladoria e Financeiro) liga o modo, marca as linhas na tabela,
// escolhe o que trocar (Centro de Custo ou Classificação) e o novo valor. Antes de gravar, a confirmação mostra quantas linhas entram e quais
// ficam de fora (rateadas, cartão, outra empresa...) com o motivo. Cada linha é gravada como no lápis do Fluxo; o que der erro volta marcado.
const ROTULO_TIPO: Record<TipoMassa, string> = {
  centro_custo: "Trocar Centro de Custo em massa",
  classificacao: "Trocar Classificação em massa",
  conta_banco: "Definir Conta do banco em massa",
  integrante: "Trocar Integrante em massa",
};

export function AlteracaoEmMassaBar({
  ativo, onAtivo, selecionadas, onSelecionadas,
}: {
  ativo: boolean;
  onAtivo: (v: boolean) => void;
  /** Linhas marcadas na tabela (já resolvidas a partir das chaves). */
  selecionadas: LinhaMassa[];
  /** Mantém marcadas só as chaves informadas (depois de aplicar, ficam as que deram erro). */
  onSelecionadas: (chaves: Set<string>) => void;
}) {
  const [tipo, setTipo] = useState<TipoMassa | "">("");
  const [destinoId, setDestinoId] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoAlteracaoEmMassa | null>(null);
  const massa = useAlteracaoEmMassaFluxo();
  const { data: integrantes = [] } = useIntegrantesFluxo(ativo && tipo === "integrante");
  const opcoesIntegrante = useMemo(() => integrantes.map((i) => ({ value: String(i.id), label: i.nome })), [integrantes]);

  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const { data: contasBanco = [] } = useContasBanco();
  const { data: empresas = [] } = useEmpresasGrupo();
  const opcoesConta = useMemo(
    () => contasBanco.filter((c) => c.ativo).map((c) => ({ ...c, rotulo: `${empresas.find((e) => e.id === c.empresa_id)?.nome ?? "Empresa"} · ${rotuloConta(c)}` })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    [contasBanco, empresas],
  );
  const opcoesCentro = useMemo(() => [...contratos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [contratos]);
  const opcoesClassificacao = useMemo(() => classificacoes.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [classificacoes]);

  const plano: PlanoMassa | null = useMemo(() => {
    if (!tipo || !destinoId) return null;
    if (tipo === "classificacao") return planejarTrocaDeClassificacao(selecionadas, destinoId);
    if (tipo === "integrante") return planejarTrocaDeIntegrante(selecionadas, Number(destinoId));
    if (tipo === "conta_banco") {
      const conta = contasBanco.find((c) => c.id === destinoId);
      return conta ? planejarAtribuicaoDeConta(selecionadas, conta) : null;
    }
    const novo = contratos.find((c) => c.id === destinoId);
    return novo ? planejarTrocaDeCentroDeCusto(selecionadas, { id: novo.id, empresa_id: novo.empresa_id }) : null;
  }, [tipo, destinoId, selecionadas, contratos, contasBanco]);

  const nomeDestino = tipo === "classificacao" ? opcoesClassificacao.find((c) => c.id === destinoId)?.nome
    : tipo === "conta_banco" ? opcoesConta.find((c) => c.id === destinoId)?.rotulo
    : tipo === "integrante" ? opcoesIntegrante.find((c) => c.value === destinoId)?.label
    : contratos.find((c) => c.id === destinoId)?.nome;
  const mexeNoOrcamento = tipo === "centro_custo" && !!plano?.aplicar.some((l) => l.origem === "malote");
  const podeAplicar = ativo && !!plano && selecionadas.length > 0 && !massa.isPending;

  function trocarTipo(v: string) {
    setTipo(v as TipoMassa);
    setDestinoId("");
  }

  async function aplicar() {
    if (!tipo || !plano || plano.aplicar.length === 0) return;
    setProgresso({ feitas: 0, total: plano.aplicar.length });
    try {
      const r = await massa.mutateAsync({
        tipo, destinoId, linhas: plano.aplicar,
        aoAndar: (feitas, total) => setProgresso({ feitas, total }),
      });
      setResultado(r);
      // Ficam marcadas só as que deram erro (para tentar de novo) e as que o plano deixou de fora continuam à vista no resumo.
      onSelecionadas(new Set(r.erros.map((e) => chaveDaLinhaMassa(e.linha))));
      if (r.erros.length === 0) toast.success(`${r.feitas.length} lançamento(s) atualizado(s).`);
      else toast.warning(`${r.feitas.length} atualizado(s) e ${r.erros.length} com erro — veja o resumo.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao aplicar em massa.");
    } finally {
      setProgresso(null);
      setConfirmando(false);
      setCiente(false);
    }
  }

  const ignoradasPorMotivo = plano ? contarMotivos(plano.ignoradas) : [];
  const errosPorMotivo = resultado ? contarMotivos(resultado.erros) : [];

  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <Checkbox checked={ativo} onCheckedChange={(v) => { onAtivo(v === true); if (v !== true) { setTipo(""); setDestinoId(""); onSelecionadas(new Set()); } }} />
          Alteração em massa
          <span title="Marque as linhas na tabela, escolha o que trocar e o novo valor. Fica só para a Controladoria e o Financeiro.">
            <Info className="h-3.5 w-3.5 text-sky-600" />
          </span>
        </label>

        <Select value={tipo || undefined} onValueChange={trocarTipo} disabled={!ativo}>
          <SelectTrigger className="h-9 w-[250px] bg-background text-sm"><SelectValue placeholder="Selecione o tipo de alteração" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="centro_custo">{ROTULO_TIPO.centro_custo}</SelectItem>
            <SelectItem value="classificacao">{ROTULO_TIPO.classificacao}</SelectItem>
            {opcoesConta.length > 0 && <SelectItem value="conta_banco">{ROTULO_TIPO.conta_banco}</SelectItem>}
            <SelectItem value="integrante">{ROTULO_TIPO.integrante}</SelectItem>
          </SelectContent>
        </Select>

        {tipo === "integrante" ? (
          <SearchableSelect
            value={destinoId || null}
            onChange={setDestinoId}
            options={opcoesIntegrante}
            placeholder="Selecione o novo Integrante"
            searchPlaceholder="Buscar colaborador..."
            disabled={!ativo}
            className="w-[300px]"
            triggerClassName="h-9 bg-background text-sm"
          />
        ) : (
        <Select value={destinoId || undefined} onValueChange={setDestinoId} disabled={!ativo || !tipo}>
          <SelectTrigger className="h-9 w-[300px] bg-background text-sm"><SelectValue placeholder="Selecione o novo valor (Centro de Custo, Classificação ou Conta)" /></SelectTrigger>
          <SelectContent>
            {tipo === "classificacao"
              ? opcoesClassificacao.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)
              : tipo === "conta_banco"
              ? opcoesConta.map((c) => <SelectItem key={c.id} value={c.id}>{c.rotulo}</SelectItem>)
              : opcoesCentro.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}{c.status !== "ativo" ? ` (${c.status})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        )}

        <span className="text-xs text-muted-foreground">{ativo ? `${selecionadas.length} linha(s) marcada(s)` : ""}</span>
        <Button className="ml-auto gap-1.5" disabled={!podeAplicar} onClick={() => { setResultado(null); setConfirmando(true); }}>
          <Layers className="h-4 w-4" /> Aplicar em massa
        </Button>
      </div>

      {resultado && (
        <div className="mt-3 rounded-md border bg-background p-2.5 text-xs">
          <p className="font-semibold">Resultado da última alteração em massa: {resultado.feitas.length} atualizado(s), {resultado.erros.length} com erro.</p>
          {errosPorMotivo.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-700 dark:text-red-400">
              {errosPorMotivo.map((m) => <li key={m.motivo}>{m.quantidade}× {m.motivo}</li>)}
            </ul>
          )}
          {errosPorMotivo.length > 0 && <p className="mt-1 text-muted-foreground">As linhas com erro continuam marcadas para você corrigir e tentar de novo.</p>}
        </div>
      )}

      <Dialog open={confirmando} onOpenChange={(o) => { if (!massa.isPending) setConfirmando(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar alteração em massa</DialogTitle>
            <DialogDescription>
              {tipo === "classificacao" ? "Trocar a Classificação" : tipo === "conta_banco" ? "Definir a Conta do banco" : tipo === "integrante" ? "Trocar o Integrante" : "Trocar o Centro de Custo"} para <strong>{nomeDestino ?? "—"}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p><strong>{plano?.aplicar.length ?? 0}</strong> lançamento(s) serão alterados e <strong>{plano?.ignoradas.length ?? 0}</strong> ficam de fora.</p>
            {ignoradasPorMotivo.length > 0 && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
                <p className="mb-1 font-semibold">Ficam de fora:</p>
                <ul className="list-disc pl-5">
                  {ignoradasPorMotivo.map((m) => <li key={m.motivo}>{m.quantidade}× {m.motivo}</li>)}
                </ul>
              </div>
            )}
            {tipo === "integrante" ? (
              <p className="text-xs text-muted-foreground">O integrante muda <strong>na linha de rateio da despesa do Malote</strong> (origem), sem mexer em valor, centro de custo, classificação nem fornecedor. Cada despesa fica no histórico dela.</p>
            ) : tipo === "conta_banco" ? (
              <p className="text-xs text-muted-foreground">Só liga o lançamento à conta do banco, para conciliar cada conta separada. Valor, data, classificação e centro de custo não mudam, e dá para trocar a conta depois.</p>
            ) : tipo === "classificacao" ? (
              <p className="text-xs text-muted-foreground">A classificação muda só neste Fluxo de Caixa (como o lápis); o lançamento original não é alterado. Cada linha fica no histórico.</p>
            ) : (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  O centro de custo muda <strong>no lançamento de origem</strong>
                  {mexeNoOrcamento ? " e, nas despesas do Malote, o valor é repassado ao novo centro de custo no Orçamento. A conferência de estouro do orçado não é feita em massa" : ""}.
                </span>
              </div>
            )}
            {mexeNoOrcamento && (
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <Checkbox checked={ciente} onCheckedChange={(v) => setCiente(v === true)} className="mt-0.5" />
                Estou ciente de que o valor das despesas do Malote será repassado no Orçamento.
              </label>
            )}
            {progresso && <p className="text-xs text-muted-foreground">Aplicando… {progresso.feitas} de {progresso.total}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={massa.isPending}>Cancelar</Button>
            <Button onClick={aplicar} disabled={massa.isPending || !plano || plano.aplicar.length === 0 || (mexeNoOrcamento && !ciente)}>
              {massa.isPending ? "Aplicando…" : `Alterar ${plano?.aplicar.length ?? 0} lançamento(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
