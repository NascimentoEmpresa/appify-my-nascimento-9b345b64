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
import { competenciaRotulo, fmtMoeda, rotuloTipo, type ItemRateio, type ParteGuia, type TipoRateio } from "@/lib/rh/rateioDespesas";
import {
  CLASSIFICACAO_SUGERIDA, CLASSIFICACAO_SUGERIDA_PARTE, empresaQueMaisLeva, itensPorParte,
  linhasDoRateioParaMalote, linhasPorParteParaMalote,
} from "@/lib/rh/rateioParaMalote";

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
  aberto, rateio, itens, partes = [], porParte, onFechar, onEnviado,
}: {
  aberto: boolean;
  rateio: RateioParaMalote;
  itens: ItemRateio[];
  /** Guia com mais de uma parte (FGTS + consignado, 10/11/2026): cada parte vai na sua classificação. */
  partes?: { parte: ParteGuia; rotulo: string }[];
  /** Quanto de cada parte caiu em cada contrato (chave = contrato_id; null = sem contrato). */
  porParte?: Map<string | null, Partial<Record<ParteGuia, number>>>;
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
  // Guia com partes: a 1ª parte (FGTS) usa a classificação de cima; as
  // outras (Consignado) escolhem a sua aqui.
  const comPartes = partes.length > 1 && !!porParte;
  const [classOutras, setClassOutras] = useState<Partial<Record<ParteGuia, string>>>({});

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
    if (!comPartes || !classificacoes.length) return;
    setClassOutras((atual) => {
      const novo = { ...atual };
      let mudou = false;
      for (const p of partes.slice(1)) {
        if (novo[p.parte]) continue;
        const achou = classificacoes.find((c) => c.ativo && norm(c.nome) === norm(CLASSIFICACAO_SUGERIDA_PARTE[p.parte]));
        if (achou) { novo[p.parte] = achou.id; mudou = true; }
      }
      return mudou ? novo : atual;
    });
  }, [comPartes, classificacoes, partes]);
  useEffect(() => {
    if (empresaId || !contratosProntos) return;
    const maior = empresaQueMaisLeva(comValor, empresaDoContrato);
    if (maior) setEmpresaId(maior);
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

  // Mesma regra do "Importar rateio" do Malote (src/lib/rh/rateioParaMalote.ts).
  const classDaParte: Partial<Record<ParteGuia, string>> = useMemo(
    () => (comPartes ? { ...classOutras, [partes[0].parte]: classificacaoId } : {}),
    [comPartes, classOutras, partes, classificacaoId],
  );
  const rateioInicial: RateioLinha[] = useMemo(() => {
    const opcoes = { empresaDoContrato, empresaPadrao: empresaId || null, fornecedorId: fornecedorId || null };
    if (comPartes && porParte) {
      return linhasPorParteParaMalote(itensPorParte(comValor, porParte, partes.map((p) => p.parte)), classDaParte, opcoes);
    }
    return linhasDoRateioParaMalote(comValor, opcoes);
  }, [comValor, empresaDoContrato, empresaId, fornecedorId, comPartes, porParte, partes, classDaParte]);
  const classificacoesPorLinha = useMemo(() => {
    if (!comPartes) return undefined;
    const ids = new Set(Object.values(classDaParte).filter(Boolean));
    return classificacoes.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }));
  }, [comPartes, classDaParte, classificacoes]);

  const partesProntas = !comPartes || partes.every((p) => !!classDaParte[p.parte]);
  const pronto = !!classificacao && !!empresaId && contratosProntos && anexoPronto && partesProntas;
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
            Cria uma despesa nova de {fmtMoeda(rateio.valor)} no Malote, com {rateioInicial.length || comValor.length} linha(s) de rateio — uma por
            contrato{comPartes ? ` em cada parte (${partes.map((p) => p.rotulo).join(" e ")})` : ""}, na empresa do contrato. Depois de enviado, o rateio fica travado até a despesa ser excluída ou reprovada no Malote.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Classificação{comPartes ? ` — ${partes[0].rotulo}` : ""} *</Label>
            <SearchableSelect
              value={classificacaoId}
              onChange={setClassificacaoId}
              options={classificacoes.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="Escolha a classificação"
            />
            {comPartes && partes.slice(1).map((p) => (
              <div key={p.parte} className="space-y-1 pt-2">
                <Label className="text-xs">Classificação — {p.rotulo} *</Label>
                <SearchableSelect
                  value={classOutras[p.parte] ?? ""}
                  onChange={(v) => setClassOutras((a) => ({ ...a, [p.parte]: v }))}
                  options={classificacoes.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Escolha a classificação"
                />
              </div>
            ))}
            {comPartes && (
              <p className="text-[11px] text-muted-foreground">Uma despesa só no Malote; cada parte da guia vai nas linhas com a sua classificação.</p>
            )}
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
              : comPartes ? "Escolha as classificações de cada parte e a empresa pagadora." : "Escolha a classificação e a empresa pagadora."}
          </div>
        ) : (
          <PainelDespesaMalote
            key={`${classificacaoId}|${Object.values(classOutras).join(",")}|${empresaId}|${fornecedorId}`}
            classificacoesPorLinha={classificacoesPorLinha}
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
