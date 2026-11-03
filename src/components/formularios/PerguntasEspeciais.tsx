import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  PERGUNTA_PRINCIPAL, alternar, alternarComplemento, errosDaPergunta, paraPergunta,
  type ConfigEscolha, type RespostaPergunta, type ValorLocal,
} from "../../../supabase/functions/_shared/pesquisa-permanencia";

// =====================================================================
// FORMULÁRIOS — os dois tipos de pergunta que vieram da Pesquisa de
// Permanência (mig 20261030001000). Mesma marcação e mesmas regras da página
// pública antiga (/pesquisa-permanencia/<token>), que deixou de existir:
//   · "local_trabalho"      → <LocalTrabalho>: Contrato → Posto → Função;
//   · "escolha_complemento" → <EscolhaComplemento>: até N + a mais
//     importante, alternativa exclusiva e complemento embaixo da escolhida.
// As regras ficam no _shared (alternar/errosDaPergunta) e são conferidas de
// novo no banco (trigger cs_form_resposta_tipos).
// =====================================================================

/** Valor da pergunta local_trabalho enquanto a pessoa preenche. */
export type ValorLocalTela = Partial<ValorLocal> & { sem_posto?: boolean };

const SEM_POSTO = "__sem_posto__";

interface PostoOpcao { codigo: string; nome: string; funcoes: string[] }
interface ContratoOpcao { empresa: number; filial: number; nome: string; funcoes: string[]; postos: PostoOpcao[] }

/** Respondeu contrato, posto (ou "não sei") e função? */
export const localRespondido = (v: ValorLocalTela | null | undefined) =>
  !!v && v.empresa != null && v.filial != null && (!!v.posto || !!v.sem_posto) && !!v.funcao;

/** Erros da escolha_complemento, com o número da pergunta como aparece na tela. */
export const errosEscolha = (id: string, titulo: string, numero: number, cfg: ConfigEscolha, v: RespostaPergunta | undefined) =>
  errosDaPergunta(paraPergunta(id, titulo, numero, cfg), v);

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div><p className="mb-1 text-sm font-medium text-slate-700">{rotulo}</p>{children}</div>;
}

export function LocalTrabalho({ formularioId, value, onChange }: {
  formularioId: string; value: ValorLocalTela | null | undefined; onChange: (v: ValorLocalTela | null) => void;
}) {
  const q = useQuery({
    queryKey: ["cs-form-locais-trabalho", formularioId], staleTime: 10 * 60_000, retry: 1,
    queryFn: async (): Promise<ContratoOpcao[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("cs_form_locais_trabalho_publico", { p_formulario: formularioId });
      if (error) throw new Error(error.message);
      return (data ?? []) as ContratoOpcao[];
    },
  });
  const contratos = q.data ?? [];
  const v = value ?? {};
  const contratoK = v.empresa != null && v.filial != null ? `${v.empresa}-${v.filial}` : null;
  const contrato = contratos.find((c) => `${c.empresa}-${c.filial}` === contratoK);
  const postoK = v.sem_posto ? SEM_POSTO : v.posto ?? null;
  const postoSel = contrato?.postos.find((p) => p.codigo === v.posto);
  // Função: as de quem está no posto escolhido; sem posto (ou posto vazio), as do contrato.
  const funcoes = postoSel && postoSel.funcoes.length ? postoSel.funcoes : contrato?.funcoes ?? [];

  const opcoesContrato = useMemo(() => contratos.map((c) => ({ value: `${c.empresa}-${c.filial}`, label: c.nome })), [contratos]);
  const opcoesPosto = useMemo(() => [
    { value: SEM_POSTO, label: "Não sei qual é o meu posto" },
    ...(contrato?.postos ?? []).map((p) => ({ value: p.codigo, label: p.nome, hint: p.codigo })),
  ], [contrato]);

  if (q.error) return <p className="text-sm text-red-600">Não foi possível carregar os contratos. Recarregue a página.</p>;

  return (
    <div className="space-y-3">
      <Campo rotulo="Contrato">
        <SearchableSelect value={contratoK} options={opcoesContrato} placeholder={q.isLoading ? "Carregando…" : "Escolha o contrato"}
          searchPlaceholder="Buscar contrato…" disabled={q.isLoading}
          onChange={(k) => {
            const c = contratos.find((x) => `${x.empresa}-${x.filial}` === k);
            onChange(c ? { empresa: c.empresa, filial: c.filial, contrato: c.nome } : null);
          }} />
      </Campo>
      <Campo rotulo="Posto de trabalho">
        <SearchableSelect value={postoK} options={opcoesPosto} placeholder={contrato ? "Escolha o posto" : "Escolha o contrato primeiro"}
          searchPlaceholder="Buscar posto…" disabled={!contrato}
          onChange={(k) => {
            if (!contrato) return;
            const base = { empresa: contrato.empresa, filial: contrato.filial, contrato: contrato.nome };
            if (k === SEM_POSTO) onChange({ ...base, posto: null, posto_nome: null, sem_posto: true });
            else {
              const p = contrato.postos.find((x) => x.codigo === k);
              onChange(p ? { ...base, posto: p.codigo, posto_nome: p.nome } : base);
            }
          }} />
      </Campo>
      <Campo rotulo="Função">
        <SearchableSelect value={v.funcao ?? null} options={funcoes.map((f) => ({ value: f, label: f }))}
          placeholder={postoK === null ? "Escolha o posto primeiro" : "Escolha a função"} searchPlaceholder="Buscar função…"
          disabled={postoK === null} onChange={(f) => onChange({ ...v, funcao: f || undefined })} />
      </Campo>
    </div>
  );
}

function Marca({ multipla, ativo }: { multipla: boolean; ativo: boolean }) {
  return (
    <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2",
      multipla ? "rounded" : "rounded-full", ativo ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white")}>
      {ativo && <span className={cn("bg-white", multipla ? "h-2 w-2 rounded-sm" : "h-2 w-2 rounded-full")} />}
    </span>
  );
}

/** Corpo da pergunta (o card e o título ficam com quem chama, como nos outros tipos). */
export function EscolhaComplemento({ id, titulo, numero, config, value, onChange, mostrarErro }: {
  id: string; titulo: string; numero: number; config: ConfigEscolha;
  value: RespostaPergunta | undefined; onChange: (r: RespostaPergunta) => void; mostrarErro: boolean;
}) {
  const p = paraPergunta(id, titulo, numero, config);
  const r = value;
  const marcadas = r?.marcadas ?? [];
  const erros = mostrarErro ? errosDaPergunta(p, r) : [];
  const multipla = p.max > 1;
  return (
    <div>
      <p className="text-xs text-slate-500">{multipla ? `Marque até ${p.max} opções.` : "Marque uma opção."}</p>
      <div className="mt-3 space-y-2">
        {p.opcoes.map((o) => {
          const ativo = marcadas.includes(o.cod);
          const cheio = multipla && !ativo && !o.exclusiva && marcadas.filter((c) => !p.opcoes.find((x) => x.cod === c)?.exclusiva).length >= p.max;
          return (
            <div key={o.cod}>
              <button type="button" onClick={() => onChange(alternar(p, r, o.cod))} disabled={cheio}
                className={cn("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                  ativo ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50", cheio && "opacity-50")}>
                <Marca multipla={multipla} ativo={ativo} />
                <span className="text-slate-700">{o.rotulo}</span>
              </button>
              {ativo && o.complemento && (
                <div className="ml-4 mt-2 border-l-2 border-emerald-200 pl-4">
                  {o.complemento.texto && (
                    <div className="mb-3">
                      <p className="mb-1 text-sm font-medium text-slate-700">{o.complemento.texto.rotulo}</p>
                      <Input value={r?.texto?.[o.cod] ?? ""} maxLength={o.complemento.texto.max}
                        onChange={(e) => onChange({ ...r!, texto: { ...(r?.texto ?? {}), [o.cod]: e.target.value } })} />
                    </div>
                  )}
                  <p className="text-sm font-medium text-slate-700">{o.complemento.titulo}</p>
                  <p className="text-xs text-slate-500">{o.complemento.multipla ? "Marque todas as que se aplicam." : "Marque uma opção."}</p>
                  <div className="mt-2 space-y-1.5">
                    {o.complemento.opcoes.map((c) => {
                      const on = (r?.comp?.[o.cod] ?? []).includes(c.cod);
                      return (
                        <button key={c.cod} type="button" onClick={() => onChange(alternarComplemento(p, r!, o.cod, c.cod))}
                          className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm",
                            on ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}>
                          <Marca multipla={o.complemento!.multipla} ativo={on} />
                          <span className="text-slate-700">{c.rotulo}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {multipla && marcadas.length > 1 && (
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">{PERGUNTA_PRINCIPAL}</p>
          <div className="mt-2 space-y-1.5">
            {marcadas.map((cod) => {
              const o = p.opcoes.find((x) => x.cod === cod)!;
              const on = r?.principal === cod;
              return (
                <button key={cod} type="button" onClick={() => onChange({ ...r!, principal: cod })}
                  className={cn("flex w-full items-start gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm",
                    on ? "border-emerald-500" : "border-slate-200")}>
                  <Marca multipla={false} ativo={on} />
                  <span className="text-slate-700">{o.rotulo}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {erros.length > 0 && <p className="mt-3 text-sm text-red-600">{erros[0]}</p>}
    </div>
  );
}

/** Texto de uma resposta destes tipos, para tabela, CSV e PDF. Null = não é destes tipos. */
export function textoValorEspecial(p: { tipo: string; config?: Record<string, unknown> | null }, v: unknown): string | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  if (p.tipo === "local_trabalho") {
    const l = v as ValorLocal;
    return [l.contrato, l.posto ? (l.posto_nome ? `${l.posto} · ${l.posto_nome}` : l.posto) : "posto não informado", l.funcao]
      .filter(Boolean).join(" › ");
  }
  if (p.tipo === "escolha_complemento") {
    const cfg = (p.config ?? {}) as unknown as ConfigEscolha;
    const r = v as RespostaPergunta;
    const itens = cfg.itens ?? [];
    const rot = (c: string) => itens.find((i) => i.cod === c)?.rotulo ?? c;
    return (r.marcadas ?? []).map((c) => {
      const it = itens.find((i) => i.cod === c);
      const comp = (r.comp?.[c] ?? []).map((x) => it?.complemento?.opcoes.find((o) => o.cod === x)?.rotulo ?? x);
      const extra = [r.texto?.[c], ...comp].filter(Boolean).join(", ");
      return `${rot(c)}${(cfg.max ?? 1) > 1 && r.principal === c && (r.marcadas ?? []).length > 1 ? " (mais importante)" : ""}${extra ? ` [${extra}]` : ""}`;
    }).join("; ") || "-";
  }
  return null;
}
