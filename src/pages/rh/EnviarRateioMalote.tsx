// =====================================================================
// RH › Rateio de Despesas → "Enviar ao Malote" (SIS-2026-0673, 16/10/2026,
// mig 20261016000020). Desenho aprovado pelo Pablo:
//   · o rateio CONFERIDO vira uma despesa NOVA no Malote (fluxo normal de
//     aprovação), uma linha de rateio por contrato — empresa do contrato;
//   · a classificação é escolhida aqui (sugerida pelo tipo da despesa);
//   · o RH preenche data/forma/dados de pagamento e a empresa pagadora;
//     a linha "Sem contrato" vai para a empresa pagadora, sem contrato.
// O formulário é o MESMO PainelDespesaMalote da criação normal (como na
// Diária): prazo 1.1, exceção por senha, Pix, parcelas, fornecedor
// obrigatório — nada de regra duplicada aqui. O anexo do rateio (PDF ou
// planilha) já entra anexado.
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosAtivos, useEmpresasGrupo, useFornecedoresAtivos, type RateioLinha } from "@/hooks/useMaloteDespesa";
import { baixarAnexoRateio, useEnviarRateioMalote } from "@/hooks/useRateioDespesas";
import { FORM_ID_PAINEL_DESPESA_DIARIA, PainelDespesaMalote, type PayloadPainelDespesaMalote } from "@/pages/malote/PainelDespesaMalote";
import { competenciaRotulo, fmtMoeda, rotuloTipo, type ItemRateio, type TipoRateio } from "@/lib/rh/rateioDespesas";

/** Classificação sugerida por tipo (nome no catálogo do Malote; o RH pode trocar). */
const CLASSIFICACAO_SUGERIDA: Partial<Record<TipoRateio, string>> = {
  jusbrasil: "SISTEMAS",
  senior: "SISTEMAS",
  fgts: "FGTS MENSAL",
  seguro: "SEGURO DE VIDA - OPERACIONAL",
  gratificacao_pcd: "GRATIFICAÇÃO PCD",
  mensalidade_seeac: "SINDICATO",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export interface RateioParaMalote {
  id: string;
  tipo: TipoRateio;
  competencia: string;
  valor: number;
  anexo_path: string | null;
  anexo_nome: string | null;
}

export function EnviarRateioMalote({
  aberto, rateio, itens, onFechar, onEnviado,
}: {
  aberto: boolean;
  rateio: RateioParaMalote;
  itens: ItemRateio[];
  onFechar: () => void;
  onEnviado: (numero: string | null) => void;
}) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [], isFetched: contratosProntos } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const enviar = useEnviarRateioMalote();

  const [classificacaoId, setClassificacaoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [anexo, setAnexo] = useState<File | null>(null);
  const [anexoPronto, setAnexoPronto] = useState(!rateio.anexo_path);

  const empresaDoContrato = useMemo(() => new Map(contratos.map((c) => [c.id, c.empresa_id])), [contratos]);
  const comValor = useMemo(() => itens.filter((i) => i.valor > 0), [itens]);

  // Sugestões: classificação pelo tipo; empresa pagadora = a que leva mais
  // valor no rateio. Só preenchem campo vazio.
  useEffect(() => {
    if (classificacaoId || !classificacoes.length) return;
    const alvo = CLASSIFICACAO_SUGERIDA[rateio.tipo];
    const achou = alvo && classificacoes.find((c) => c.ativo && norm(c.nome) === norm(alvo));
    if (achou) setClassificacaoId(achou.id);
  }, [classificacoes, rateio.tipo, classificacaoId]);
  useEffect(() => {
    if (empresaId || !contratosProntos) return;
    const soma = new Map<string, number>();
    comValor.forEach((i) => {
      const e = i.contrato_id ? empresaDoContrato.get(i.contrato_id) : null;
      if (e) soma.set(e, (soma.get(e) ?? 0) + i.valor);
    });
    const maior = [...soma.entries()].sort((a, b) => b[1] - a[1])[0];
    if (maior) setEmpresaId(maior[0]);
  }, [contratosProntos, comValor, empresaDoContrato, empresaId]);

  // O anexo do rateio segue para a despesa (é a papelada que o aprovador vê).
  useEffect(() => {
    if (!aberto || !rateio.anexo_path || anexoPronto) return;
    let vivo = true;
    baixarAnexoRateio(rateio.anexo_path, rateio.anexo_nome ?? "anexo-rateio")
      .then((f) => vivo && setAnexo(f))
      .catch(() => vivo && toast.warning("Não foi possível trazer o anexo do rateio — anexe à mão no Malote."))
      .finally(() => vivo && setAnexoPronto(true));
    return () => { vivo = false; };
  }, [aberto, rateio.anexo_path, rateio.anexo_nome, anexoPronto]);

  const classificacao = classificacoes.find((c) => c.id === classificacaoId) ?? null;

  const rateioInicial: RateioLinha[] = useMemo(
    () =>
      comValor.map((i, k) => ({
        empresa_id: (i.contrato_id && empresaDoContrato.get(i.contrato_id)) || empresaId || null,
        contrato_id: i.contrato_id && empresaDoContrato.has(i.contrato_id) ? i.contrato_id : null,
        fornecedor_id: fornecedorId || null,
        integrante_empregado_id: null,
        percentual: Math.round(i.percentual * 100 * 10000) / 10000,
        valor: i.valor,
        ordem: k,
      })),
    [comValor, empresaDoContrato, empresaId, fornecedorId],
  );

  const pronto = !!classificacao && !!empresaId && contratosProntos && anexoPronto;
  const mesAno = competenciaRotulo(rateio.competencia);

  const aoSalvar = async (payload: PayloadPainelDespesaMalote) => {
    const { arquivosNovos, ...despesa } = payload;
    const r = await enviar.mutateAsync({ rateioId: rateio.id, despesa, arquivos: arquivosNovos });
    toast.success(`Despesa ${r.numero ?? ""} criada no Malote — entrou na fila de aprovação.`);
    onEnviado(r.numero);
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !enviar.isPending && onFechar()}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar ao Malote — {rotuloTipo(rateio.tipo)} {mesAno}</DialogTitle>
          <DialogDescription>
            Cria uma despesa nova de {fmtMoeda(rateio.valor)} no Malote, com {comValor.length} linha(s) de rateio — uma por
            contrato, na empresa do contrato. Depois de enviado, o rateio fica travado até a despesa ser excluída ou reprovada no Malote.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Classificação *</Label>
            <SearchableSelect
              value={classificacaoId}
              onChange={setClassificacaoId}
              options={classificacoes.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Escolha a classificação"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Empresa pagadora *</Label>
            <SearchableSelect
              value={empresaId}
              onChange={setEmpresaId}
              options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
              placeholder="Escolha a empresa"
            />
            <p className="text-[11px] text-muted-foreground">Também é a empresa da linha "Sem contrato".</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fornecedor (todas as linhas)</Label>
            <SearchableSelect
              value={fornecedorId}
              onChange={setFornecedorId}
              options={fornecedores.map((f) => ({ value: f.id, label: f.nome, hint: f.cnpj_cpf ?? undefined }))}
              placeholder="Escolha o fornecedor"
              allowClear
              clearValue=""
            />
            <p className="text-[11px] text-muted-foreground">Trocar aqui recomeça o formulário abaixo.</p>
          </div>
        </div>

        {!pronto ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {!anexoPronto || !contratosProntos
              ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Preparando…</span>
              : "Escolha a classificação e a empresa pagadora."}
          </div>
        ) : (
          <PainelDespesaMalote
            key={`${classificacaoId}|${empresaId}|${fornecedorId}`}
            classificacaoId={classificacaoId}
            classificacaoTipo={classificacao?.tipo ?? "contrato"}
            empresaId={empresaId}
            ativo
            nomeInicial={`RATEIO ${rotuloTipo(rateio.tipo).toUpperCase()} ${mesAno}`}
            valorInicial={rateio.valor}
            inicial={{ competencia: rateio.competencia.slice(0, 7) }}
            rateioInicial={rateioInicial}
            arquivosIniciais={anexo ? [anexo] : []}
            aoSalvar={aoSalvar}
            rotuloEnviar="Enviar ao Malote"
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviar.isPending}>Cancelar</Button>
          <Button type="submit" form={FORM_ID_PAINEL_DESPESA_DIARIA} disabled={!pronto || enviar.isPending} className="gap-1.5">
            {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar ao Malote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
