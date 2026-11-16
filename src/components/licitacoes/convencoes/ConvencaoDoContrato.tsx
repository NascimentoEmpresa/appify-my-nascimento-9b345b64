import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Pencil } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useConvencoes, useReferenciaDoPosto, type Convencao } from "@/hooks/useConvencoes";
import {
  herancaDaConvencao, urlEditarConvencao, vigenciaTxt,
  type HerancaConvencao, type RespostaReferencia,
} from "@/lib/licitacoes/convencoes";
import { IconeBeneficio } from "./IconeBeneficio";
import { QuadroBeneficios } from "./QuadroBeneficios";
import { comoReferencia, rotuloConvencao } from "./VinculoPostoDialog";

// Licitações › Contratos › "Editar Contrato" — Convenção Coletiva do
// CONTRATO (13/11/2026, mig 20261113100500). Pedido do Pablo: vinculada aqui,
// TODOS os benefícios dos postos do contrato vêm dela (Quadro de Postos e
// Solicitação de Vaga). O posto não edita benefício: quem quer mudar um
// valor muda no cadastro da convenção — o aviso abaixo diz isso e leva lá.

/**
 * A referência que a escolha da tela produz, no formato do resolvedor
 * (origem 'contrato'). Quem não enxerga a lista de convenções (RLS de
 * LIC_CONVENCAO_COLETIVA) cai no resolvedor do banco, que é SECURITY DEFINER
 * — mas só para o que já está GRAVADO.
 */
export function useReferenciaDoContrato(
  contratoId: string | null | undefined,
  convencaoId: string,
  decretoId: string,
  gravado: { convencao_id: string; decreto_id: string | null } | null | undefined,
): { resposta: RespostaReferencia | null; heranca: HerancaConvencao | null; convencoes: Convencao[]; carregando: boolean } {
  const { data: convencoes = [], isLoading } = useConvencoes();
  const igualAoGravado = !!gravado && gravado.convencao_id === convencaoId && (gravado.decreto_id ?? "") === decretoId;
  // Posto qualquer: com convenção no contrato o resolvedor ignora o posto.
  const doBanco = useReferenciaDoPosto(igualAoGravado ? contratoId : null, igualAoGravado ? "*" : null);

  return useMemo(() => {
    if (!convencaoId) return { resposta: null, heranca: null, convencoes, carregando: false };
    const principal = convencoes.find((c) => c.id === convencaoId);
    let resposta: RespostaReferencia | null = null;
    if (principal) {
      const decreto = decretoId ? convencoes.find((c) => c.id === decretoId) : undefined;
      resposta = {
        status: "vinculado", origem: "contrato", contrato_id: contratoId ?? null,
        principal_id: convencaoId, regras: decreto ? { vt: decreto.id } : {},
        referencias: [principal, ...(decreto ? [decreto] : [])].map(comoReferencia),
      };
    } else if (doBanco.data?.status === "vinculado" && doBanco.data.origem === "contrato") {
      resposta = { ...doBanco.data, posto: null };
    }
    return { resposta, heranca: herancaDaConvencao(resposta), convencoes, carregando: isLoading || doBanco.isLoading };
  }, [convencaoId, decretoId, convencoes, contratoId, doBanco.data, doBanco.isLoading, isLoading]);
}

export function CampoConvencaoDoContrato({
  convencaoId, decretoId, onChange, convencoes, resposta, carregando, podeAlterar,
}: {
  convencaoId: string;
  decretoId: string;
  onChange: (v: { convencaoId: string; decretoId: string }) => void;
  convencoes: Convencao[];
  resposta: RespostaReferencia | null;
  carregando: boolean;
  podeAlterar: boolean;
}) {
  const opcoes = useMemo(() => convencoes.map((c) => ({
    value: c.id,
    label: rotuloConvencao(c),
    hint: `${c.tipo === "decreto" ? "Decreto municipal" : vigenciaTxt(c.vigencia_inicio, c.vigencia_fim)}${c.situacao === "pendente" ? " · PENDENTE" : ""}`,
    decreto: c.tipo === "decreto",
  })), [convencoes]);
  const opcoesCct = useMemo(() => opcoes.filter((o) => !o.decreto), [opcoes]);
  const opcoesDecreto = useMemo(() => opcoes.filter((o) => o.decreto), [opcoes]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Convenção Coletiva (CCT) do contrato</label>
          <SearchableSelect value={convencaoId} disabled={!podeAlterar || carregando} allowClear
            onChange={(v) => onChange({ convencaoId: v ?? "", decretoId: v ? decretoId : "" })}
            options={opcoesCct}
            placeholder={carregando ? "Carregando…" : "Sem convenção — benefícios preenchidos posto a posto"}
            searchPlaceholder="Buscar por CCT, sindicato…" emptyLabel="Nenhuma convenção cadastrada" />
        </div>
        {convencaoId && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs font-medium"><IconeBeneficio chave="vt" tamanho="sm" />Decreto municipal (Vale-Transporte)</label>
            <SearchableSelect value={decretoId} disabled={!podeAlterar || carregando} allowClear
              onChange={(v) => onChange({ convencaoId, decretoId: v ?? "" })}
              options={opcoesDecreto} placeholder="Selecione o decreto do município"
              searchPlaceholder="Buscar por decreto, município…" emptyLabel="Nenhum decreto cadastrado" />
            <span className="text-[11px] text-muted-foreground">O VT não vem da CCT: sai do decreto municipal.</span>
          </div>
        )}
      </div>

      {convencaoId ? (
        <>
          <AvisoConvencaoDoContrato convencaoId={convencaoId} />
          {resposta && <QuadroBeneficios resposta={resposta} compacto titulo="Benefícios que os postos deste contrato vão receber" />}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Com uma convenção vinculada, todos os benefícios dos postos deste contrato passam a vir dela automaticamente.
          Não está na lista? Cadastre em{" "}
          <Link to="/app/licitacoes/convencoes" className="font-medium text-blue-700 hover:underline dark:text-blue-300">Convenções Coletivas</Link>.
        </p>
      )}
    </div>
  );
}

/** "Os benefícios vêm da convenção — para mudar, atualize o cadastro dela." */
export function AvisoConvencaoDoContrato({ convencaoId, compacto }: { convencaoId: string; compacto?: boolean }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200 ${compacto ? "p-2 text-[11px]" : "p-3 text-xs"}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Os benefícios de <b>todos os postos</b> deste contrato vêm da Convenção Coletiva e não são editados aqui.
        Para mudar algum valor, atualize o cadastro da convenção — os postos e as vagas novas passam a usar o valor novo.
      </span>
      <Link to={urlEditarConvencao(convencaoId)} target="_blank"
        className="flex shrink-0 items-center gap-1 font-semibold text-blue-700 hover:underline dark:text-blue-300">
        <Pencil className="h-3 w-3" />Editar convenção<ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
