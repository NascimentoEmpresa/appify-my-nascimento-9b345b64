import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Database, ExternalLink, FileText, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { abrirAnexoConvencao, useReferenciaDoPosto } from "@/hooks/useConvencoes";
import {
  identificacaoCct, montarQuadro, vigenciaTxt,
  type ReferenciaConvencao, type RespostaReferencia,
} from "@/lib/licitacoes/convencoes";
import { IconeBeneficio } from "./IconeBeneficio";

// "Benefícios e adicionais da vaga" (chamado Convenções Coletivas, 27/10/2026).
// Vem da CCT/decreto vinculado ao posto na Planilha de Custo — nunca de
// suposição: sem vínculo ou com campo em branco, mostra a pendência para a
// Licitação corrigir. Custos e descontos da planilha NÃO entram aqui: só os
// benefícios cadastrados na convenção.

const descReferencia = (r: ReferenciaConvencao) =>
  [identificacaoCct(r), r.decreto_numero, [r.sindicato, r.categoria_profissional].filter(Boolean).join(" - ")]
    .filter(Boolean).join(" · ");

function LinhaOrigem({ r, principal }: { r: ReferenciaConvencao; principal: boolean }) {
  const abrir = (path?: string | null) => path && abrirAnexoConvencao(path).then((e) => e && toast.error(e));
  return (
    <div className="text-[11.5px] text-muted-foreground">
      <span className="font-medium text-foreground">{principal ? "" : "Também: "}{descReferencia(r) || "Convenção"}</span>
      {" · vigência "}{vigenciaTxt(r.vigencia_inicio, r.vigencia_fim)}{" · versão "}{r.versao}
      {r.cct_arquivo_path && <> · <button type="button" onClick={() => abrir(r.cct_arquivo_path)} className="font-medium text-blue-700 hover:underline dark:text-blue-300">ver CCT</button></>}
      {r.decreto_arquivo_path && <> · <button type="button" onClick={() => abrir(r.decreto_arquivo_path)} className="font-medium text-blue-700 hover:underline dark:text-blue-300">ver decreto</button></>}
    </div>
  );
}

export function QuadroBeneficios({ resposta, carregando, acao, compacto, titulo = "Benefícios (conforme CCT vinculada ao contrato/posto)", rodape }: {
  resposta: RespostaReferencia | null | undefined;
  carregando?: boolean;
  /** Botão no canto do cabeçalho ("Editar se necessário"). */
  acao?: ReactNode;
  /** Formulário de vaga / prévia: sem o cabeçalho grande. */
  compacto?: boolean;
  titulo?: string;
  /** Aviso extra embaixo (ex.: versão mais nova disponível). */
  rodape?: ReactNode;
}) {
  const q = montarQuadro(resposta);
  const principal = q.usadas[0];

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", compacto && "rounded-lg")}>
      <div className={cn("flex items-start gap-3 border-b bg-blue-50/60 dark:bg-blue-950/20", compacto ? "px-3 py-2.5" : "px-4 py-4")}>
        {!compacto && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><FileText className="h-6 w-6" /></span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className={cn("flex items-center gap-1.5 font-bold text-[#0f3171] dark:text-blue-300", compacto ? "text-sm" : "text-base")}>
            {titulo}
            <span title="A Licitação cadastra a CCT/decreto e vincula ao posto na Planilha de Custo. Ajustes são feitos lá, no cadastro de origem."><Info className="h-3.5 w-3.5 text-blue-500" /></span>
          </h3>
          <p className="text-xs text-muted-foreground">Preenchido automaticamente pela CCT vinculada na Planilha de Custo.</p>
          {!compacto && <p className="text-[11px] text-muted-foreground/80">Os valores vêm do cadastro da convenção do posto; ajustes são feitos lá, pela Licitação.</p>}
        </div>
        {acao}
      </div>

      <div className={cn(compacto ? "p-3" : "p-4")}>
        {carregando ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando a convenção do posto…</p>
        ) : (
          <>
            {q.itens.length > 0 && (
              <div className={cn("grid gap-2.5", compacto ? "sm:grid-cols-2" : "sm:grid-cols-2")}>
                {q.itens.map((i) => (
                  <div key={i.def.chave} className={cn("flex items-center gap-3 rounded-lg border p-3",
                    !i.texto && "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20")}>
                    <IconeBeneficio chave={i.def.chave} tamanho={compacto ? "sm" : "md"} />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{i.def.nome}</p>
                      <p className={cn("font-bold", compacto ? "text-sm" : "text-[15px]",
                        i.texto ? "text-foreground" : "text-amber-700 dark:text-amber-300")}>
                        {i.texto ?? "Pendente"}
                      </p>
                      {i.referencia && principal && i.referencia.id !== principal.id && (
                        <p className="truncate text-[10.5px] text-muted-foreground">de {descReferencia(i.referencia)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {q.pendencias.length > 0 && (
              <div className={cn("rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200", q.itens.length > 0 && "mt-3")}>
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />
                  {q.itens.length ? "Pendências para a Licitação corrigir" : "Benefícios não disponíveis"}
                </p>
                <ul className="list-disc space-y-0.5 pl-5">{q.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}

            {principal && (
              <div className="mt-3 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"><Database className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Origem dos dados</p>
                  <p className="text-xs text-foreground">
                    Benefícios extraídos da CCT vinculada ao contrato {principal.contrato_nome ?? "—"}{resposta?.posto ? ` · posto ${resposta.posto}` : ""}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">Fonte: Planilha de Custo (Licitações)</p>
                  {q.usadas.map((r, i) => <LinhaOrigem key={r.id} r={r} principal={i === 0} />)}
                </div>
                <Link to="/app/licitacoes/planilha-custo" className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300">
                  Ver Planilha de Custo <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
            {rodape}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Abertura de Vagas: contrato + posto escolhidos no formulário → quadro.
 * Banco ainda sem a RPC (null depois de carregar): não desenha nada.
 */
export function QuadroBeneficiosDoPosto({ contratoId, posto }: { contratoId: string | null | undefined; posto: string | null | undefined }) {
  const q = useReferenciaDoPosto(contratoId, posto);
  if (!contratoId || !posto?.trim()) return null;
  if (!q.isLoading && !q.data) return null;
  return <QuadroBeneficios resposta={q.data} carregando={q.isLoading} compacto titulo="Benefícios e adicionais da vaga" />;
}
