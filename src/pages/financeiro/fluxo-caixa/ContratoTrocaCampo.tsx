import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Info } from "lucide-react";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useOrcadoClassificacaoMultiMes } from "@/hooks/useOrcadoClassificacao";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { calcularImpactoTroca } from "./impactoTrocaContrato";
import { SEM_CONTRATO } from "./motivosRevisar";

// SIS-2026-0552 — campo "Contrato" dentro do diálogo de edição (lápis) do
// Fluxo de Caixa. Diferente dos outros campos (que só ajustam a cópia do Fluxo),
// a troca de contrato grava na ORIGEM (RPC fluxo_caixa_trocar_contrato) e, no
// Malote, repassa o valor entre contratos no Orçamento — por isso o campo traz
// o aviso e o impacto aqui mesmo. Só é montado com o diálogo aberto, então as
// consultas de Orçamento (planilha, utilizado) só rodam nesse momento.
//
// Quem salva (a tela) decide a ordem: troca o contrato primeiro, depois o
// ajuste dos demais campos. `onExigeCiencia` avisa a tela quando a troca
// estoura o orçado do contrato novo e precisa do "estou ciente".
type LinhaFluxo = FluxoCaixaMaloteLinha & { rateioDetalhe?: unknown[] };

export function ContratoTrocaCampo({
  linha, novoId, onNovoId, ciente, onCiente, onExigeCiencia,
}: {
  linha: LinhaFluxo;
  novoId: string;
  onNovoId: (id: string) => void;
  ciente: boolean;
  onCiente: (v: boolean) => void;
  onExigeCiencia: (v: boolean) => void;
}) {
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const { data: utilizado = [] } = useUtilizadoOrcamento();
  const orcado = useOrcadoClassificacaoMultiMes(linha.empresa_id);

  const origemSuportada = linha.origem === "malote" || linha.origem === "debito_automatico" || linha.origem === "importacao_historica";
  const rateado = !!linha.rateioDetalhe && linha.rateioDetalhe.length > 1;
  const mesmaEmpresa = linha.origem === "malote" || linha.origem === "debito_automatico";
  const mes = (linha.competencia ?? "").slice(0, 7);

  const opcoes = useMemo(
    () =>
      contratos
        .filter((c) => c.id !== linha.contrato_id && (!mesmaEmpresa || c.empresa_id === linha.empresa_id))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [contratos, linha.contrato_id, linha.empresa_id, mesmaEmpresa]
  );
  const novo = contratos.find((c) => c.id === novoId) ?? null;

  const impacto = useMemo(() => {
    if (linha.origem !== "malote" || !novoId || !mes || orcado.isLoading) return null;
    return calcularImpactoTroca(utilizado, linha.despesa_id, novoId, mes, (cls, contratoId, anoMes) => orcado.resolver(cls, contratoId, anoMes));
  }, [linha.origem, linha.despesa_id, novoId, mes, utilizado, orcado]);

  const exigeCiencia = !!impacto && impacto.excesso > 0;
  useEffect(() => { onExigeCiencia(exigeCiencia); }, [exigeCiencia]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!origemSuportada) {
    return (
      <div className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          {linha.origem === "cartao_fatura"
            ? "O contrato dos itens de cartão é definido em “Classificar Lançamentos de Cartão”."
            : "Este tipo de lançamento não tem contrato."}
        </span>
      </div>
    );
  }

  if (rateado) {
    return (
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Contrato: esta despesa é rateada entre vários contratos. Ajuste a grade de rateio direto na despesa, no Malote.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div>
        <Label className="text-xs">
          Contrato <span className="text-muted-foreground">— atual: {linha.contrato_nome ?? "sem contrato"}</span>
        </Label>
        <Select value={novoId || "_"} onValueChange={(v) => { onNovoId(v === "_" ? "" : v); onCiente(false); }}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Manter o contrato atual" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Manter o contrato atual</SelectItem>
            {linha.origem === "importacao_historica" && !linha.contrato_id && (
              <SelectItem value={SEM_CONTRATO}>Sem contrato (administrativo)</SelectItem>
            )}
            {opcoes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome}{c.status !== "ativo" ? ` (${c.status})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {linha.origem === "malote" && (
        <p className="text-[11px] text-muted-foreground">
          {mesmaEmpresa ? "Só contratos da mesma empresa. " : ""}
          Diferente dos outros campos, a troca de contrato <strong>muda a despesa de origem</strong>: o valor sai do contrato atual e passa para o novo no Orçamento, e fica registrada no histórico da despesa.
          {linha.numero_parcela != null && " Despesa parcelada: vale para todas as parcelas."}
        </p>
      )}
      {linha.origem === "debito_automatico" && (
        <p className="text-[11px] text-muted-foreground">Só contratos da mesma empresa. A troca muda o contrato do débito (não entra no Orçamento) e fica registrada no histórico.</p>
      )}
      {linha.origem === "importacao_historica" && (
        <p className="text-[11px] text-muted-foreground">Lançamento importado: a troca muda o contrato dele (não entra no Orçamento) e, se estava com selo “revisar” de contrato, o selo some.</p>
      )}

      {linha.origem === "malote" && novoId && orcado.isLoading && (
        <p className="text-[11px] text-muted-foreground">Calculando o impacto no orçamento…</p>
      )}

      {impacto && (
        <div className={impacto.excesso > 0 ? "rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900" : "rounded-md border bg-muted/30 p-2.5 text-[11px]"}>
          <p className="font-medium mb-0.5">
            Orçamento de {novo?.nome} · {linha.classificacao_nome ?? "classificação"} · {mes.slice(5, 7)}/{mes.slice(0, 4)}
          </p>
          {impacto.orcado == null ? (
            <p>Não foi possível verificar o orçamento deste contrato para essa classificação.</p>
          ) : (
            <p>
              Orçado {formatBRL(impacto.orcado)} · já utilizado {formatBRL(impacto.utilizadoNovoContrato)} · com esta troca{" "}
              <strong>{formatBRL(impacto.aposTroca)}</strong>
              {impacto.excesso > 0 && <> — <strong>ultrapassa em {formatBRL(impacto.excesso)}</strong></>}.
            </p>
          )}
        </div>
      )}

      {exigeCiencia && (
        <label className="flex items-start gap-2 text-[11px] cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={ciente} onChange={(e) => onCiente(e.target.checked)} />
          Estou ciente de que o contrato novo ficará acima do orçamento e quero trocar mesmo assim.
        </label>
      )}
    </div>
  );
}
