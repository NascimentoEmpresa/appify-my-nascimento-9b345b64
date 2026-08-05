import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ClassificacaoOrcamento,
  useEditarPlanejamento,
  useSalvarPlanejamento,
} from "@/hooks/usePlanejamentoOrcamentario";
import { OrcamentoComStatus } from "./utils";

interface OrcamentoFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string | null;
  classificacoes: ClassificacaoOrcamento[];
  orcamentos: OrcamentoComStatus[];
  editando: OrcamentoComStatus | null;
}

export function OrcamentoFormModal({
  open,
  onOpenChange,
  empresaId,
  classificacoes,
  orcamentos,
  editando,
}: OrcamentoFormModalProps) {
  const mode = editando ? "editar" : "novo";

  const [classificacaoId, setClassificacaoId] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [valor, setValor] = useState("");

  const salvar = useSalvarPlanejamento();
  const editar = useEditarPlanejamento();
  const salvando = salvar.isPending || editar.isPending;

  useEffect(() => {
    if (!open) return;
    if (editando) {
      setClassificacaoId(editando.classificacao_id);
      setDetalhe(editando.detalhe);
      setInicio(editando.inicio_vigencia);
      setFim(editando.fim_vigencia);
      setValor(String(editando.valor ?? ""));
    } else {
      setClassificacaoId("");
      setDetalhe("");
      setInicio("");
      setFim("");
      setValor("");
    }
  }, [open, editando]);

  // Regra 1 do mockup: ao selecionar uma Classificação que já tem UM único
  // orçamento "Na Vigência", pré-preenche os demais campos com os dados
  // dele — facilita cadastrar a próxima versão. Se a classificação tiver
  // mais de um Detalhe ativo, não adivinha: o usuário digita o Detalhe.
  function handleClassificacaoChange(id: string) {
    setClassificacaoId(id);
    if (mode !== "novo") return;
    const ativos = orcamentos.filter((o) => o.classificacao_id === id && o.status === "na_vigencia");
    if (ativos.length === 1) {
      const atual = ativos[0];
      setDetalhe(atual.detalhe);
      setInicio(atual.inicio_vigencia);
      setFim(atual.fim_vigencia);
      setValor(String(atual.valor));
    } else {
      setDetalhe("");
      setInicio("");
      setFim("");
      setValor("");
    }
  }

  const detalhesSugeridos = useMemo(() => {
    if (!classificacaoId) return [];
    const set = new Set<string>();
    orcamentos.filter((o) => o.classificacao_id === classificacaoId).forEach((o) => set.add(o.detalhe));
    return Array.from(set);
  }, [orcamentos, classificacaoId]);

  function validar(): string | null {
    if (mode === "novo" && !classificacaoId) return "Selecione a Classificação.";
    if (!detalhe.trim()) return "Informe o Detalhe do orçamento.";
    if (!inicio) return "Informe o Início da Vigência.";
    if (!fim) return "Informe o Fim da Vigência.";
    if (fim <= inicio) return "O fim da vigência deve ser posterior ao início.";
    if (!valor || Number(valor) <= 0) return "Informe o Valor do Orçamento.";
    return null;
  }

  async function handleSalvar() {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    try {
      if (mode === "novo") {
        if (!empresaId) throw new Error("Empresa não identificada.");
        await salvar.mutateAsync({
          empresa_id: empresaId,
          classificacao_id: classificacaoId,
          detalhe: detalhe.trim(),
          inicio_vigencia: inicio,
          fim_vigencia: fim,
          valor: Number(valor),
        });
        toast.success("Orçamento cadastrado.");
      } else if (editando) {
        await editar.mutateAsync({
          id: editando.id,
          detalhe: detalhe.trim(),
          inicio_vigencia: inicio,
          fim_vigencia: fim,
          valor: Number(valor),
        });
        toast.success("Orçamento atualizado.");
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar orçamento.");
    }
  }

  const classificacaoLabel =
    editando?.classificacao?.nome ??
    classificacoes.find((c) => c.id === classificacaoId)?.nome ??
    "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "novo" ? "Novo Orçamento" : "Editar Orçamento"}</DialogTitle>
          {mode === "editar" && (
            <DialogDescription>
              Corrige os dados deste orçamento sem criar uma nova versão. Para mudar de Classificação, cadastre um
              novo orçamento.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>
              Classificação <span className="text-destructive">*</span>
            </Label>
            {mode === "novo" ? (
              <Select value={classificacaoId} onValueChange={handleClassificacaoChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a classificação" />
                </SelectTrigger>
                <SelectContent>
                  {classificacoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={classificacaoLabel} disabled />
            )}
          </div>

          <div>
            <Label>
              Detalhe <span className="text-destructive">*</span>
            </Label>
            <Input
              list="detalhes-orcamento-sugeridos"
              value={detalhe}
              onChange={(e) => setDetalhe(e.target.value)}
              placeholder="Informe o detalhe do orçamento"
            />
            <datalist id="detalhes-orcamento-sugeridos">
              {detalhesSugeridos.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>
                Início da Vigência <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label>
                Fim da Vigência <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>
              Valor do Orçamento <span className="text-destructive">*</span>
            </Label>
            <CurrencyInput value={valor} onChange={setValor} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
