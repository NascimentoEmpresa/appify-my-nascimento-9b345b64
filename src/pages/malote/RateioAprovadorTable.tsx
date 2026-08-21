import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Eye, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import { RateioLinha, useEmpresasGrupo, useContratosAtivos, useFornecedoresAtivos, useIntegrantes, useJustificarRateioLinha } from "@/hooks/useMaloteDespesa";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useMeusContratosAnalista } from "@/hooks/useMaloteAnalistas";
import { DimensoesRateio } from "./RateioGrid";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface RateioAprovadorTableProps {
  despesaId: string;
  linhas: RateioLinha[];
  dimensoes: DimensoesRateio;
  classificacaoId: string | null;
  limiteJustificativaPct: number | null;
  resolverOrcado: (classificacaoId: string | null | undefined, contratoId: string | null | undefined) => number | null;
  anoMesDespesa: string;
  // Fallback: aprovador/supervisor/admin da despesa também pode
  // justificar, mesmo quando o contrato ainda não tem Analista vinculado
  // (SIS-2026-0170) — o dono "de direito" da justificativa é o Analista.
  podeJustificarComoAprovador: boolean;
}

// SIS-2026-0192: visão só-leitura do Rateio pro aprovador — a grade
// editável (RateioGrid) some pra ele, já que os dados chegam preenchidos
// pelo solicitante. Acrescenta, por linha: Valor Orçado (Classificação x
// Contrato dessa linha), Valor Utilizado no mês + este lançamento, Status
// (dentro/fora do Orçado) e Status/Justificativa (quando o % da linha
// passa do limite_justificativa_pct da Classificação).
export function RateioAprovadorTable({
  despesaId,
  linhas,
  dimensoes,
  classificacaoId,
  limiteJustificativaPct,
  resolverOrcado,
  anoMesDespesa,
  podeJustificarComoAprovador,
}: RateioAprovadorTableProps) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const { data: integrantes = [] } = useIntegrantes();
  const { data: utilizadoLinhas = [] } = useUtilizadoOrcamento();
  const { data: meusContratosAnalista } = useMeusContratosAnalista();
  const justificar = useJustificarRateioLinha();

  const [dialogLinha, setDialogLinha] = useState<RateioLinha | null>(null);
  const [modoEdicao, setModoEdicao] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const mostrarColunaEmpresa = dimensoes.empresa || linhas.some((l) => l.empresa_id);
  const mostrarColunaContrato = dimensoes.contrato || linhas.some((l) => l.contrato_id);

  // "Utilizado antes desta despesa" = lançamentos já em Aguardando
  // Pagamento/Despesa Paga da mesma Classificação+Contrato no mesmo mês,
  // SEM contar a própria despesa em questão — que já pode estar nesse
  // status (ex.: aprovador olhando de novo uma despesa já aprovada), daí
  // o filtro por despesa_id != despesaId. Sem isso, o valor dela entrava
  // contado 2x: uma vez vindo da view (já aprovada) e outra somado como
  // "+ lançamento" logo abaixo.
  const utilizadoAntesPorContrato = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of utilizadoLinhas) {
      if (u.despesa_id === despesaId) continue;
      if (u.classificacao_id !== classificacaoId) continue;
      if (!u.competencia || u.competencia.slice(0, 7) !== anoMesDespesa) continue;
      const chave = u.contrato_id ?? "__sem_contrato__";
      map.set(chave, (map.get(chave) ?? 0) + (Number(u.valor) || 0));
    }
    return map;
  }, [utilizadoLinhas, despesaId, classificacaoId, anoMesDespesa]);

  function abrirDialog(linha: RateioLinha, edicao: boolean) {
    setDialogLinha(linha);
    setModoEdicao(edicao);
    setTexto(linha.justificativa_texto ?? "");
  }

  async function salvarJustificativa() {
    if (!dialogLinha?.id) return;
    if (!texto.trim()) {
      toast.error("Descreva a justificativa.");
      return;
    }
    setSalvando(true);
    try {
      await justificar.mutateAsync({ linhaId: dialogLinha.id, texto: texto.trim() });
      toast.success("Justificativa salva.");
      setDialogLinha(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar justificativa.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {mostrarColunaEmpresa && <TableHead className="text-center">Empresa</TableHead>}
              {mostrarColunaContrato && <TableHead className="text-center">Contrato</TableHead>}
              {dimensoes.fornecedor && <TableHead className="text-center">Fornecedor</TableHead>}
              {dimensoes.integrante && <TableHead className="text-center">Integrante</TableHead>}
              <TableHead className="text-center">Valor (R$)</TableHead>
              <TableHead className="text-center">Valor orçado (mês)</TableHead>
              <TableHead className="text-center">Valor utilizado + lançamento (R$)</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Status justificativa</TableHead>
              <TableHead className="w-20 text-center">Justificativa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={
                    5 + Number(mostrarColunaEmpresa) + Number(mostrarColunaContrato) + Number(dimensoes.fornecedor) + Number(dimensoes.integrante)
                  }
                  className="text-center text-muted-foreground py-6"
                >
                  Nenhuma linha de rateio.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((linha, idx) => {
              // SIS-2026-0212 (complemento): despesa paga tem Orçado/
              // Utilizado congelados em malote_pagar_despesa — usa o
              // snapshot em vez de recalcular contra despesas lançadas
              // depois (senão uma despesa já paga passa a aparecer "fora
              // do orçado" por causa de lançamento que nem existia então).
              const estaCongelada = linha.congelado_em != null;
              const orcado = estaCongelada ? linha.orcado_snapshot ?? null : resolverOrcado(classificacaoId, linha.contrato_id);
              const chave = linha.contrato_id ?? "__sem_contrato__";
              const utilizadoAntes = utilizadoAntesPorContrato.get(chave) ?? 0;
              const utilizadoComLancamento = estaCongelada
                ? linha.utilizado_com_lancamento_snapshot ?? 0
                : utilizadoAntes + (Number(linha.valor) || 0);
              const dentroDoOrcado = orcado == null ? null : utilizadoComLancamento <= orcado;
              const percentualLinha = orcado ? (utilizadoComLancamento / orcado) * 100 : null;
              const precisaJustificar =
                limiteJustificativaPct != null && percentualLinha != null && percentualLinha > limiteJustificativaPct;
              const temJustificativa = !!linha.justificativa_texto;
              const souAnalistaDesseContrato = !!linha.contrato_id && !!meusContratosAnalista?.has(linha.contrato_id);
              const podeJustificarEstaLinha = souAnalistaDesseContrato || podeJustificarComoAprovador;

              return (
                <TableRow key={linha.id ?? idx}>
                  {mostrarColunaEmpresa && <TableCell className="text-xs text-center">{empresas.find((e) => e.id === linha.empresa_id)?.nome ?? "—"}</TableCell>}
                  {mostrarColunaContrato && <TableCell className="text-xs text-center">{contratos.find((c) => c.id === linha.contrato_id)?.nome ?? "—"}</TableCell>}
                  {dimensoes.fornecedor && (
                    <TableCell className="text-xs text-center">{fornecedores.find((f) => f.id === linha.fornecedor_id)?.nome ?? "—"}</TableCell>
                  )}
                  {dimensoes.integrante && (
                    <TableCell className="text-xs text-center">
                      {integrantes.find((i) => i.id === linha.integrante_empregado_id)?.nome ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-center text-xs">{fmtMoney(linha.valor)}</TableCell>
                  <TableCell className="text-center text-xs">{fmtMoney(orcado)}</TableCell>
                  <TableCell className="text-center text-xs" title={estaCongelada ? "Congelado no momento do pagamento" : undefined}>
                    {estaCongelada && "🔒 "}
                    {fmtMoney(utilizadoComLancamento)}
                    {percentualLinha != null && <span className="text-muted-foreground"> ({percentualLinha.toFixed(2)}%)</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center">
                      {dentroDoOrcado == null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : dentroDoOrcado ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center">
                      {precisaJustificar ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          {temJustificativa ? "Justificada" : "Pendente"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">N/A</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {temJustificativa && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirDialog(linha, false)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {precisaJustificar && podeJustificarEstaLinha && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirDialog(linha, true)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {!temJustificativa && !(precisaJustificar && podeJustificarEstaLinha) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!dialogLinha} onOpenChange={(open) => !open && setDialogLinha(null)}>
        <DialogContent className="sm:max-w-md p-5">
          <DialogHeader>
            <DialogTitle className="text-base">{modoEdicao ? "Justificar linha do rateio" : "Justificativa"}</DialogTitle>
          </DialogHeader>
          {modoEdicao ? (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, 500))}
              placeholder="Descreva o motivo desta linha ultrapassar o limite de justificativa..."
              className="w-full min-h-24 rounded-md border border-input bg-background p-2 text-sm"
              maxLength={500}
              autoFocus
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{dialogLinha?.justificativa_texto}</p>
          )}
          {modoEdicao && (
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDialogLinha(null)} disabled={salvando}>
                Cancelar
              </Button>
              <Button size="sm" onClick={salvarJustificativa} disabled={salvando}>
                {salvando ? "Salvando..." : "Salvar justificativa"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
