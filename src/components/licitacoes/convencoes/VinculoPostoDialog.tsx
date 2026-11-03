import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useConvencoes, useRemoverVinculoPosto, useSalvarVinculoPosto, useVinculosPosto, vinculoDe, type Convencao,
} from "@/hooks/useConvencoes";
import {
  BENEFICIOS, identificacaoCct, vigenciaTxt,
  type ChaveBeneficio, type ReferenciaConvencao, type RespostaReferencia,
} from "@/lib/licitacoes/convencoes";
import { IconeBeneficio } from "./IconeBeneficio";
import { QuadroBeneficios } from "./QuadroBeneficios";

// Planilha de Custo › vínculo do POSTO com a CCT/decreto (chamado Convenções
// Coletivas, item 3). Contrato → Posto → CCT/decreto → benefícios. Por posto,
// não por contrato nem por cargo: postos do mesmo contrato podem seguir
// convenções diferentes. Com mais de uma referência, a Licitação escolhe de
// qual sai CADA benefício — o sistema não soma nem duplica.

const PRINCIPAL = "__principal";

export const rotuloConvencao = (c: Pick<Convencao, "identificacao" | "vigencia_inicio" | "vigencia_fim" | "decreto_numero" | "sindicato"> & { contrato?: { nome: string } | null }) =>
  [c.contrato?.nome, identificacaoCct(c), c.decreto_numero, c.sindicato].filter(Boolean).join(" · ");

const comoReferencia = (c: Convencao): ReferenciaConvencao => ({
  id: c.id, versao: c.versao, identificacao: c.identificacao, categoria_profissional: c.categoria_profissional,
  sindicato: c.sindicato, municipio: c.municipio, vigencia_inicio: c.vigencia_inicio, vigencia_fim: c.vigencia_fim,
  cct_arquivo_path: c.cct_arquivo_path, decreto_numero: c.decreto_numero, decreto_arquivo_path: c.decreto_arquivo_path,
  beneficios: c.beneficios, contrato_nome: c.contrato?.nome ?? null, situacao: c.situacao,
});

export function VinculoPostoDialog({ alvo, onFechar, podeAlterar }: {
  alvo: { contrato_id: string | null; contrato: string; posto: string } | null;
  onFechar: () => void;
  podeAlterar: boolean;
}) {
  const { data: convencoes = [], isLoading } = useConvencoes();
  const { data: vinculos } = useVinculosPosto();
  const salvar = useSalvarVinculoPosto();
  const remover = useRemoverVinculoPosto();
  const atual = alvo ? vinculoDe(vinculos, alvo.contrato_id, alvo.posto) : null;

  const [principal, setPrincipal] = useState("");
  const [varias, setVarias] = useState(false);
  const [regras, setRegras] = useState<Partial<Record<ChaveBeneficio, string>>>({});

  useEffect(() => {
    if (!alvo) return;
    setPrincipal(atual?.convencao_id ?? "");
    setRegras(atual?.regras ?? {});
    setVarias(!!atual && Object.keys(atual.regras ?? {}).length > 0);
  }, [alvo, atual]);

  // As do mesmo contrato primeiro; as outras continuam escolhíveis (uma CCT
  // de sindicato pode ter sido cadastrada em outro contrato).
  const opcoes = useMemo(() => [...convencoes]
    .sort((a, b) => Number(b.contrato_id === alvo?.contrato_id) - Number(a.contrato_id === alvo?.contrato_id))
    .map((c) => ({
      value: c.id,
      label: rotuloConvencao(c),
      hint: `${vigenciaTxt(c.vigencia_inicio, c.vigencia_fim)}${c.situacao === "pendente" ? " · PENDENTE" : ""}`,
      muted: c.contrato_id !== alvo?.contrato_id,
    })), [convencoes, alvo?.contrato_id]);

  // Prévia com o que está na tela, montada pela mesma regra da vaga.
  const previa: RespostaReferencia | null = principal ? {
    status: "vinculado", posto: alvo?.posto, principal_id: principal,
    regras: varias ? regras : {},
    referencias: convencoes.filter((c) => c.id === principal || (varias && Object.values(regras).includes(c.id))).map(comoReferencia),
  } : null;

  const confirmar = async () => {
    if (!alvo?.contrato_id) return;
    if (!principal) { toast.error("Escolha a CCT/decreto do posto."); return; }
    // Regra igual à principal não é regra.
    const limpas = Object.fromEntries(Object.entries(varias ? regras : {}).filter(([, id]) => id && id !== principal));
    try {
      await salvar.mutateAsync({ id: atual?.id, contrato_id: alvo.contrato_id, posto: alvo.posto, convencao_id: principal, regras: limpas });
      toast.success(`CCT/decreto vinculado ao posto ${alvo.posto}.`);
      onFechar();
    } catch (e) {
      toast.error("Não foi possível salvar o vínculo: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const desvincular = async () => {
    if (!atual || !confirm(`Tirar o vínculo do posto ${alvo?.posto}? As vagas novas desse posto passam a mostrar a pendência.`)) return;
    try { await remover.mutateAsync(atual.id); toast.success("Vínculo removido."); onFechar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>CCT / Decreto do posto</DialogTitle>
          <p className="text-sm text-muted-foreground">{alvo?.contrato} · <b className="text-foreground">{alvo?.posto}</b></p>
        </DialogHeader>

        {!alvo?.contrato_id ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Esta linha da planilha não está ligada a um contrato do ERP — vincule o contrato na linha antes de escolher a CCT.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">CCT / decreto do posto <span className="text-red-600">*</span></label>
              <SearchableSelect value={principal} onChange={setPrincipal} options={opcoes} disabled={!podeAlterar || isLoading}
                placeholder={isLoading ? "Carregando…" : "Selecione a convenção cadastrada"} searchPlaceholder="Buscar por contrato, CCT, sindicato…"
                emptyLabel="Nenhuma convenção cadastrada" />
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Não está na lista? Cadastre em
                <Link to="/app/licitacoes/convencoes" className="inline-flex items-center gap-0.5 font-medium text-blue-700 hover:underline dark:text-blue-300">
                  Convenções Coletivas e Decretos Municipais <ExternalLink className="h-3 w-3" />
                </Link>
              </p>
            </div>

            {principal && (
              <div className="rounded-lg border p-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>Mais de uma referência neste posto
                    <span className="block text-[11px] font-normal text-muted-foreground">Escolha de qual CCT/decreto sai cada benefício. Nada é somado.</span>
                  </span>
                  <Switch checked={varias} onCheckedChange={setVarias} disabled={!podeAlterar} />
                </label>
                {varias && (
                  <div className="mt-3 space-y-1.5">
                    {BENEFICIOS.map((def) => (
                      <div key={def.chave} className="grid grid-cols-[minmax(160px,0.8fr)_1.2fr] items-center gap-2">
                        <span className="flex items-center gap-2 text-xs font-medium"><IconeBeneficio chave={def.chave} tamanho="sm" />{def.nome}</span>
                        <SearchableSelect value={regras[def.chave] || PRINCIPAL} disabled={!podeAlterar}
                          onChange={(v) => setRegras((r) => ({ ...r, [def.chave]: v === PRINCIPAL ? undefined : v }))}
                          options={[{ value: PRINCIPAL, label: "Mesma da principal" }, ...opcoes.filter((o) => o.value !== principal)]}
                          triggerClassName="h-8 text-xs" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {previa && <QuadroBeneficios resposta={previa} compacto titulo="Prévia: como a vaga vai mostrar" />}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <div>
            {atual && podeAlterar && (
              <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={desvincular} disabled={remover.isPending}>
                <Unlink className="mr-1 h-4 w-4" />Remover vínculo
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>{podeAlterar ? "Cancelar" : "Fechar"}</Button>
            {podeAlterar && alvo?.contrato_id && (
              <Button onClick={confirmar} disabled={salvar.isPending} className="bg-[#0f3171] hover:bg-[#0c2860]">
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar vínculo"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
