import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, CheckCircle2, Eye, Pencil, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  RateioLinha,
  Parcela,
  useEmpresasGrupo,
  useContratosAtivos,
  useFornecedoresAtivos,
  useIntegrantes,
  useJustificarRateioLinha,
} from "@/hooks/useMaloteDespesa";
import { useOrcadoClassificacaoMultiMes } from "@/hooks/useOrcadoClassificacao";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useMeusContratosAnalista } from "@/hooks/useMaloteAnalistas";
import { DimensoesRateio } from "./RateioGrid";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v + "T00:00:00").toLocaleDateString("pt-BR");
}

function fmtCompetencia(anoMes: string): string {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
}

interface RateioParceladoTableProps {
  despesaId: string;
  empresaId: string | null;
  classificacaoId: string | null;
  valorTotalDespesa: number;
  parcelas: Parcela[];
  linhas: RateioLinha[];
  dimensoes: DimensoesRateio;
  limiteJustificativaPct: number | null;
  podeJustificarComoAprovador: boolean;
  souSolicitante: boolean;
}

// SIS-2026-0223 (complemento 3): substitui RateioAprovadorTable +
// RateioImpactoParcelas pra despesa PARCELADA — agora que o Rateio de uma
// despesa parcelada só é editável na fase de lançamento (ver
// `rateioEditavel` em DespesaVisualizar.tsx), as duas visões nunca mais
// coexistem: ou é o RateioGrid editável (sem navegação), ou é ESTE
// componente, sempre read-only e navegável por parcela. Mesma lógica de
// Orçado/Utilizado/Justificativa do RateioAprovadorTable, só que
// recalculada por mês navegado (useOrcadoClassificacao re-chamado pro mês
// da parcela atual) em vez de fixa no mês da despesa.
//
// SIS-2026-0261 (correção — achados reais do Iury): a alçada de aprovação
// (DespesaVisualizar.tsx) agora checa TODAS as parcelas e todos os
// contratos do Rateio, não só a 1ª (ver montarCombosAlcada/
// encontrarComboQueEstouraAlcada em orcamentoUtils.ts). A justificativa por
// linha (SIS-2026-0192) também deixou de ser exclusiva da parcela 1 — mas
// continua sendo checada UMA PARCELA DE CADA VEZ (a que está navegada
// agora, `mesParcela`/`percentualLinha` abaixo), nunca "qualquer parcela
// da linha de uma vez" — senão a parcela 1 (dentro do orçado) aparecia
// "Pendente" só porque a parcela 3 (estourada) é da mesma linha, o que é
// confuso e errado. O texto salvo continua sendo 1 só por linha
// (`justificativa_texto`), não por parcela — só o SNAPSHOT congelado
// (fatorParcela1, em DespesaVisualizar.tsx) continua exclusivo da parcela
// 1, esse sim (é o único mês cujo orçado/utilizado foi decidido e gravado
// no momento da aprovação).
export function RateioParceladoTable({
  despesaId,
  empresaId,
  classificacaoId,
  valorTotalDespesa,
  parcelas,
  linhas,
  dimensoes,
  limiteJustificativaPct,
  podeJustificarComoAprovador,
  souSolicitante,
}: RateioParceladoTableProps) {
  const [parcelaIndex, setParcelaIndex] = useState(0);
  const indiceSeguro = Math.min(parcelaIndex, parcelas.length - 1);
  const parcelaAtual = parcelas[indiceSeguro];
  const ehParcela1 = indiceSeguro === 0;

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const { data: integrantes = [] } = useIntegrantes();
  const { data: meusContratosAnalista } = useMeusContratosAnalista();
  const justificar = useJustificarRateioLinha();

  const [dialogLinha, setDialogLinha] = useState<RateioLinha | null>(null);
  const [modoEdicao, setModoEdicao] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const mesParcela = parcelaAtual.data_vencimento.slice(0, 7);
  const fatorParcela = valorTotalDespesa ? parcelaAtual.valor / valorTotalDespesa : 0;
  // SIS-2026-0261: trocado pelo resolver multi-mês — o mês navegado agora
  // pode ser qualquer parcela, não só a que a instância antiga do hook
  // (fixa num anoMes só) suportava.
  const { resolver: resolverOrcado, isLoading: orcadoCarregando } = useOrcadoClassificacaoMultiMes(empresaId);
  const { data: utilizadoLinhas = [] } = useUtilizadoOrcamento();

  const utilizadoAntesPorContrato = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of utilizadoLinhas) {
      if (u.despesa_id === despesaId) continue;
      if (u.classificacao_id !== classificacaoId) continue;
      if (!u.competencia || u.competencia.slice(0, 7) !== mesParcela) continue;
      const chave = u.contrato_id ?? "__sem_contrato__";
      map.set(chave, (map.get(chave) ?? 0) + (Number(u.valor) || 0));
    }
    return map;
  }, [utilizadoLinhas, despesaId, classificacaoId, mesParcela]);

  const mostrarColunaEmpresa = dimensoes.empresa || linhas.some((l) => l.empresa_id);
  const mostrarColunaContrato = dimensoes.contrato || linhas.some((l) => l.contrato_id);

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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Cada parcela consome o orçamento do mês do seu vencimento — qualquer parcela que estourar o orçado do mês dela escala a
            aprovação pro próximo nível.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={indiceSeguro === 0}
              onClick={() => setParcelaIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground min-w-[90px] text-center">
              Parcela {indiceSeguro + 1} de {parcelas.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={indiceSeguro === parcelas.length - 1}
              onClick={() => setParcelaIndex((i) => Math.min(parcelas.length - 1, i + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {parcelas.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setParcelaIndex(i)}
              title={`Parcela ${p.numero_parcela}`}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                i === indiceSeguro ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Competência</p>
            <p className="font-medium">{fmtCompetencia(mesParcela)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vencimento</p>
            <p className="font-medium">{fmtData(parcelaAtual.data_vencimento)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor da parcela</p>
            <p className="font-medium">{fmtMoney(parcelaAtual.valor)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total da despesa (todas as parcelas)</p>
            <p className="font-medium">{fmtMoney(valorTotalDespesa)}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {mostrarColunaEmpresa && <TableHead className="text-center">Empresa</TableHead>}
                {mostrarColunaContrato && <TableHead className="text-center">Contrato</TableHead>}
                {dimensoes.fornecedor && <TableHead className="text-center">Fornecedor</TableHead>}
                {dimensoes.integrante && <TableHead className="text-center">Integrante</TableHead>}
                <TableHead className="text-center">% Rateio</TableHead>
                <TableHead className="text-center">Valor da parcela</TableHead>
                <TableHead className="text-center">Orçado no mês</TableHead>
                <TableHead className="text-center">Utilizado antes</TableHead>
                <TableHead className="text-center">Acumulado</TableHead>
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
                      8 +
                      Number(mostrarColunaEmpresa) +
                      Number(mostrarColunaContrato) +
                      Number(dimensoes.fornecedor) +
                      Number(dimensoes.integrante)
                    }
                    className="text-center text-muted-foreground py-6"
                  >
                    Nenhuma linha de rateio.
                  </TableCell>
                </TableRow>
              )}
              {linhas.map((linha, idx) => {
                // Só a parcela 1 pode estar congelada — é o único mês cujo
                // orçado/utilizado foi decidido e gravado no momento da
                // aprovação/pagamento (fatorParcela1, DespesaVisualizar.tsx).
                // As demais parcelas são sempre recalculadas ao vivo.
                const estaCongelada = ehParcela1 && linha.congelado_em != null;
                const orcado = estaCongelada ? linha.orcado_snapshot ?? null : resolverOrcado(classificacaoId, linha.contrato_id, mesParcela);
                const valorDaParcela = (Number(linha.valor) || 0) * fatorParcela;
                const percentualRateio = valorTotalDespesa ? ((Number(linha.valor) || 0) / valorTotalDespesa) * 100 : 0;
                const chave = linha.contrato_id ?? "__sem_contrato__";
                const utilizadoAntes = utilizadoAntesPorContrato.get(chave) ?? 0;
                const acumulado = estaCongelada ? linha.utilizado_com_lancamento_snapshot ?? 0 : utilizadoAntes + valorDaParcela;
                const percentualLinha = orcado ? (acumulado / orcado) * 100 : null;
                const dentroDoOrcado = orcado == null ? null : acumulado <= orcado;
                // SIS-2026-0261 (Iury, achado real + correção de um bug que
                // eu mesmo introduzi): a justificativa agora vale pra
                // QUALQUER parcela, não só a 1ª (antes: `ehParcela1 && ...`)
                // — mas o "estourou" é sempre da PARCELA NAVEGADA agora
                // (percentualLinha já é calculado pro mês dela, mesParcela),
                // não de "qualquer parcela da despesa". A 1ª versão desta
                // correção comparava contra TODAS as parcelas de uma vez,
                // o que fazia a parcela 1 (ok, 5%) aparecer "Pendente" só
                // porque a parcela 3 (estourada) também é dessa mesma linha
                // — confuso e errado: cada parcela mostra o status dela.
                const precisaJustificar =
                  limiteJustificativaPct != null && percentualLinha != null && percentualLinha > limiteJustificativaPct;
                const temJustificativa = !!linha.justificativa_texto;
                const souAnalistaDesseContrato = !!linha.contrato_id && !!meusContratosAnalista?.has(linha.contrato_id);
                const podeJustificarEstaLinha = souAnalistaDesseContrato || podeJustificarComoAprovador || (!linha.contrato_id && souSolicitante);

                return (
                  <TableRow key={linha.id ?? idx}>
                    {mostrarColunaEmpresa && (
                      <TableCell className="text-xs text-center">{empresas.find((e) => e.id === linha.empresa_id)?.nome ?? "—"}</TableCell>
                    )}
                    {mostrarColunaContrato && (
                      <TableCell className="text-xs text-center">{contratos.find((c) => c.id === linha.contrato_id)?.nome ?? "—"}</TableCell>
                    )}
                    {dimensoes.fornecedor && (
                      <TableCell className="text-xs text-center">{fornecedores.find((f) => f.id === linha.fornecedor_id)?.nome ?? "—"}</TableCell>
                    )}
                    {dimensoes.integrante && (
                      <TableCell className="text-xs text-center">
                        {integrantes.find((i) => i.id === linha.integrante_empregado_id)?.nome ?? "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-center text-xs">{percentualRateio.toFixed(2)}%</TableCell>
                    <TableCell className="text-center text-xs">{fmtMoney(valorDaParcela)}</TableCell>
                    <TableCell className="text-center text-xs">{orcadoCarregando ? "…" : fmtMoney(orcado)}</TableCell>
                    <TableCell className="text-center text-xs">{estaCongelada ? "—" : fmtMoney(utilizadoAntes)}</TableCell>
                    <TableCell className="text-center text-xs" title={estaCongelada ? "Congelado no momento do pagamento" : undefined}>
                      {estaCongelada && "🔒 "}
                      {fmtMoney(acumulado)}
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
                        {!temJustificativa && !(precisaJustificar && podeJustificarEstaLinha) && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">Navegar entre as parcelas só muda a visualização — não altera nada gravado.</p>
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
