import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUsuariosAtivos } from "@/hooks/useNfEmissao";
import { useSolicitarJustificativa } from "@/hooks/useJustificativasValor";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import type { BaseDespesa, LinhaFluxoCusto, LigacoesRubrica } from "../faturamento/regras";
import { rotuloMes } from "../faturamento/useBaseFaturamento";
import { colunaPorCodigo, COLUNAS_JUSTIFICAVEIS, lancamentosDaColuna, valorDaColuna, type ValoresLinha } from "./regras";

// SIS-2026-0807: a Controladoria cobra de um responsável a explicação de um valor da Lucratividade (contrato + mês + coluna). O gerente não precisa de
// acesso ao Fluxo de Caixa: os lançamentos marcados aqui viram uma foto dentro da cobrança.

export interface AlvoJustificativa {
  contratoId: string;
  contratoNome: string;
  valores: ValoresLinha;
  /** Coluna já escolhida (a Controladoria clicou numa célula); sem ela, escolhe-se no diálogo. */
  colunaInicial?: string;
}

interface Props {
  alvo: AlvoJustificativa | null;
  onClose: () => void;
  mes: string; // YYYY-MM
  base: BaseDespesa;
  fluxo: LinhaFluxoCusto[];
  ligacoes?: LigacoesRubrica;
}

const num = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dia = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export function SolicitarJustificativaDialog({ alvo, onClose, mes, base, fluxo, ligacoes }: Props) {
  const { data: usuarios = [] } = useUsuariosAtivos();
  const solicitar = useSolicitarJustificativa();
  const [coluna, setColuna] = useState(COLUNAS_JUSTIFICAVEIS[0].codigo);
  const [responsavelId, setResponsavelId] = useState("");
  const [prazo, setPrazo] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!alvo) return;
    setColuna(alvo.colunaInicial ?? COLUNAS_JUSTIFICAVEIS[0].codigo);
    setResponsavelId("");
    setPrazo("");
    setPergunta("");
    setMarcados(new Set());
  }, [alvo]);

  const def = colunaPorCodigo(coluna);
  const valorNaTela = alvo ? valorDaColuna(alvo.valores, coluna) : null;
  const lancamentos = useMemo(() => (alvo && def?.comLancamentos ? lancamentosDaColuna(fluxo, alvo.contratoId, mes, coluna, ligacoes) : []), [alvo, def, fluxo, mes, coluna, ligacoes]);
  useEffect(() => { setMarcados(new Set()); }, [coluna]);

  function alternar(i: number, v: boolean) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (v) novo.add(i); else novo.delete(i);
      return novo;
    });
  }

  async function confirmar() {
    if (!alvo || !def) return;
    if (!responsavelId) { toast.error("Escolha quem vai responder."); return; }
    if (pergunta.trim().length < 5) { toast.error("Escreva o que precisa ser justificado."); return; }
    try {
      await solicitar.mutateAsync({
        contratoId: alvo.contratoId,
        mes: `${mes}-01`,
        coluna,
        colunaRotulo: def.rotulo,
        valorReferencia: valorNaTela,
        base,
        pergunta: pergunta.trim(),
        responsavelId,
        prazo: prazo || null,
        lancamentos: [...marcados].sort((a, b) => a - b).map((i) => ({
          id_lancamento: lancamentos[i].id_malote ?? null,
          descricao: lancamentos[i].descricao ?? null,
          classificacao: lancamentos[i].classificacao_nome ?? null,
          data_pagamento: lancamentos[i].data_pagamento ?? null,
          valor: lancamentos[i].valor || 0,
        })),
      });
      toast.success("Justificativa cobrada. O responsável foi avisado no sino.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cobrar a justificativa.");
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cobrar justificativa de valor</DialogTitle>
        </DialogHeader>
        {alvo && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{alvo.contratoNome}</span> · {rotuloMes(mes)} · {base === "pagamento" ? "data de pagamento" : "competência"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Valor a justificar (coluna) *</Label>
                <Select value={coluna} onValueChange={setColuna}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{COLUNAS_JUSTIFICAVEIS.map((c) => <SelectItem key={c.codigo} value={c.codigo}>{c.rotulo}</SelectItem>)}</SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">Valor na tela: <span className="font-medium text-foreground">{coluna === "margem" ? `${num(valorNaTela)}%` : valorNaTela === null ? "—" : fmtMoney(valorNaTela)}</span></p>
              </div>
              <div>
                <Label className="text-xs">Quem vai responder *</Label>
                <Select value={responsavelId} onValueChange={setResponsavelId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Escolha o gerente…" /></SelectTrigger>
                  <SelectContent>{usuarios.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Prazo para responder</Label>
                <Input type="date" className="h-9" value={prazo} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setPrazo(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">O que precisa ser justificado *</Label>
              <Textarea value={pergunta} onChange={(e) => setPergunta(e.target.value.slice(0, 1000))} placeholder="Ex.: por que o custo de Outras Despesas subiu 40% em relação ao mês anterior?" />
            </div>

            {def?.comLancamentos && (
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Lançamentos em dúvida (opcional): {marcados.size} de {lancamentos.length}</Label>
                  {lancamentos.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setMarcados(marcados.size === lancamentos.length ? new Set() : new Set(lancamentos.map((_, i) => i)))}>
                      {marcados.size === lancamentos.length ? "Desmarcar todos" : "Marcar todos"}
                    </Button>
                  )}
                </div>
                {lancamentos.length === 0 ? (
                  <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">Nenhum lançamento nesta coluna no mês.</p>
                ) : (
                  <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-xs">
                    {lancamentos.map((l, i) => (
                      <li key={i} className="flex items-start gap-2 px-2 py-1.5">
                        <Checkbox className="mt-0.5" checked={marcados.has(i)} onCheckedChange={(v) => alternar(i, v === true)} aria-label="Marcar lançamento" />
                        <span className="min-w-0 flex-1">
                          <span className="font-mono">{l.id_malote ?? "sem ID"}</span> · {l.descricao || "sem descrição"}
                          <span className="block text-[11px] text-muted-foreground">{l.classificacao_nome ?? "sem classificação"} · {dia(l.data_pagamento)}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{fmtMoney(l.valor || 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={solicitar.isPending}>{solicitar.isPending ? "Cobrando…" : "Cobrar justificativa"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
