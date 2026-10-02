import { Bug, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LinhaModulo, LinhaTela } from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, StatusPill, haQuanto } from "./ui";

// As telas (submódulos) de um módulo com o status de cada etapa. Clique na
// linha (ou no lápis) edita — para quem tem "alterar"; o inseto registra um
// bug já com a tela escolhida.

export function TabelaTelas({ modulo, telas, nomeUsuario, podeAlterar, podeIncluir, onEditar, onBug }: {
  modulo: LinhaModulo;
  telas: LinhaTela[];
  nomeUsuario: Map<string, string>;
  podeAlterar: boolean;
  podeIncluir: boolean;
  onEditar: (t: LinhaTela) => void;
  onBug: (t: LinhaTela) => void;
}) {
  if (!telas.length) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma tela neste filtro.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-muted/50 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Tela (submódulo)</th>
            <th className="px-2 py-2">Desenvolvimento</th>
            <th className="px-2 py-2">Implantação</th>
            <th className="px-2 py-2">Treinamento</th>
            <th className="px-2 py-2">Validação</th>
            <th className="px-2 py-2">Responsável</th>
            <th className="px-2 py-2 text-right" title="Pessoas que usaram em 30 dias / pessoas com acesso">Uso 30d</th>
            <th className="px-2 py-2 text-center">Bugs</th>
            <th className="px-2 py-2">Efetividade</th>
            <th className="px-2 py-2">Atualizado</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {telas.map((t) => {
            const resp = t.item?.responsavel_id ?? null;
            const respModulo = !resp ? modulo.item?.responsavel_id ?? null : null;
            return (
              <tr key={t.tela.id}
                onClick={() => podeAlterar && onEditar(t)}
                className={cn("border-t border-border transition", podeAlterar && "cursor-pointer hover:bg-muted/40", !t.tela.ativo && "opacity-60")}>
                <td className="max-w-[260px] px-4 py-2.5">
                  <p className="truncate font-semibold text-foreground" title={t.tela.nome}>
                    {t.tela.nome}
                    {!t.tela.ativo && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">inativa</span>}
                  </p>
                  <p className="truncate font-mono text-[10.5px] text-muted-foreground" title={t.tela.rota}>{t.tela.rota}</p>
                </td>
                <td className="px-2 py-2.5"><StatusPill etapa="dev" valor={t.item?.status_dev} compacto /></td>
                <td className="px-2 py-2.5"><StatusPill etapa="implantacao" valor={t.item?.status_implantacao} compacto /></td>
                <td className="px-2 py-2.5">
                  <StatusPill etapa="treinamento" valor={t.item?.status_treinamento} compacto />
                  {!!t.item?.treinamento_responsaveis?.length && (
                    <p className="mt-0.5 max-w-[160px] truncate text-[10.5px] text-muted-foreground" title={`Responsável(is) pelo treinamento: ${t.item.treinamento_responsaveis.map((id) => nomeUsuario.get(id) ?? "—").join(", ")}`}>
                      por {t.item.treinamento_responsaveis.map((id) => nomeUsuario.get(id) ?? "—").join(", ")}
                    </p>
                  )}
                  {t.treinados > 0 && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{t.treinados} pessoa(s)</p>}
                </td>
                <td className="px-2 py-2.5"><StatusPill etapa="validacao" valor={t.item?.status_validacao} compacto /></td>
                <td className="max-w-[150px] px-2 py-2.5 text-xs">
                  {resp ? <span className="line-clamp-1 font-medium text-foreground">{nomeUsuario.get(resp) ?? "—"}</span>
                    : respModulo ? <span className="line-clamp-1 italic text-muted-foreground" title="Responsável do módulo">{nomeUsuario.get(respModulo) ?? "—"}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-2.5 text-right text-xs tabular-nums">
                  {t.tela.com_acesso > 0 || t.tela.ativos_30d > 0 ? (
                    <span className={cn("font-semibold", t.tela.com_acesso > 0 && t.tela.ativos_30d === 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground")}
                      title={`${t.tela.acessos_30d} acesso(s) em 30 dias · último: ${haQuanto(t.tela.ultimo_uso)}`}>
                      {t.tela.ativos_30d}/{t.tela.com_acesso}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-2.5 text-center">
                  {t.bugsAbertos > 0 ? <span className="inline-flex min-w-6 justify-center rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">{t.bugsAbertos}</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-2.5"><BarraEfetividade valor={t.efetividade} vazio={!t.preenchido} largura="w-16" /></td>
                <td className="px-2 py-2.5 text-[11px] text-muted-foreground">
                  {t.item ? <>{haQuanto(t.item.atualizado_em)}<br /><span className="line-clamp-1">{t.item.atualizado_por}</span></> : "pendente"}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {podeAlterar && (
                      <button type="button" title="Preencher / editar" onClick={() => onEditar(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {podeIncluir && (
                      <button type="button" title="Registrar bug nesta tela" onClick={() => onBug(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40">
                        <Bug className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
