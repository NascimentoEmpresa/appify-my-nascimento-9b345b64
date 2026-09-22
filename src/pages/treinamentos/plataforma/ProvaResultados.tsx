import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import {
  useTrnLiberarTentativa, useTrnProvasAluno, useTrnResultadosProva,
} from "@/hooks/useTreinamentosPlataforma";
import { MENU, type PerguntaQuiz } from "./tipos";
import { TrnCarregando, fmtDataHora } from "./ui";

// =====================================================================
// TREINAMENTOS — resultados das provas (22/09/2026).
//   • ResultadosProva: na tela da aula — quantos fizeram/aprovaram, média,
//     % de acerto por pergunta (onde a turma erra) e a lista de alunos.
//   • ProvasDoAluno: na ficha do aluno — cada tentativa e o botão de liberar
//     mais uma para quem esgotou sem aprovar.
// =====================================================================

export function ResultadosProva({ aulaId, perguntas }: { aulaId: string; perguntas: PerguntaQuiz[] }) {
  const { data, isLoading } = useTrnResultadosProva(aulaId);
  if (isLoading) return <TrnCarregando />;
  if (!data || !data.resumo.alunos) return <p className="text-sm text-muted-foreground">Ninguém fez esta prova ainda.</p>;
  const r = data.resumo;
  const porPergunta = new Map(data.perguntas.map((p) => [p.id, p]));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Fizeram", r.alunos], ["Aprovados", `${r.aprovados} (${Math.round((100 * r.aprovados) / r.alunos)}%)`], ["Tentativas", r.tentativas], ["Nota média", r.media == null ? "—" : `${r.media}%`]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border px-3 py-2"><div className="text-[11px] uppercase text-slate-500">{k}</div><div className="text-lg font-bold">{v}</div></div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase text-slate-500">Acerto por pergunta</div>
        <div className="space-y-1">
          {perguntas.map((p, i) => {
            const x = porPergunta.get(p.id);
            const pct = x && x.respostas ? Math.round((100 * x.acertos) / x.respostas) : null;
            return (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className="w-6 shrink-0 font-bold text-slate-400">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate" title={p.enunciado}>{p.enunciado}</span>
                <div className="h-2 w-28 overflow-hidden rounded bg-slate-200"><div className={`h-full ${pct != null && pct < 50 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${pct ?? 0}%` }} /></div>
                <span className="w-24 text-right text-slate-500">{pct == null ? "sem respostas" : `${pct}% · ${x!.respostas} resp.`}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border">
        <table className="trn-tab">
          <thead><tr><th>Aluno</th><th>Contrato</th><th>Tentativas</th><th>Melhor</th><th>Última</th><th>Situação</th><th>Em</th></tr></thead>
          <tbody>
            {data.alunos.map((a) => (
              <tr key={a.aluno_id}>
                <td className="font-semibold">{a.nome}</td><td className="text-xs">{a.contrato ?? "—"}</td><td>{a.tentativas}</td>
                <td>{a.melhor == null ? "—" : `${a.melhor}%`}</td><td>{a.ultima == null ? "—" : `${a.ultima}%`}</td>
                <td>{a.aprovado ? <span className="trn-badge ok">Aprovado</span> : <span className="trn-badge warn">Não aprovado</span>}</td>
                <td className="whitespace-nowrap text-xs">{a.em ? fmtDataHora(a.em) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProvasDoAluno({ alunoId }: { alunoId: string }) {
  const { data: provas = [], isLoading } = useTrnProvasAluno(alunoId);
  const liberar = useTrnLiberarTentativa();
  if (isLoading) return <TrnCarregando />;
  if (!provas.length) return <div className="trn-card"><p className="trn-vazio">Este aluno ainda não fez nenhuma prova.</p></div>;
  return (
    <div className="space-y-3">
      {provas.map((p) => {
        const feitas = p.tentativas.filter((t) => t.enviada_em).length;
        const max = p.tentativas_max == null ? null : p.tentativas_max + p.extras;
        const aprovado = p.nota != null && p.nota >= p.nota_minima;
        const esgotou = max != null && feitas >= max && !aprovado;
        return (
          <div key={p.aula_id} className="trn-card">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase text-slate-500">{p.curso}</div>
                <div className="font-bold">{p.aula}</div>
              </div>
              {aprovado ? <span className="trn-badge ok">Aprovado · {p.nota}%</span>
                : esgotou ? <span className="trn-badge warn">Tentativas esgotadas{p.nota != null ? ` · ${p.nota}%` : ""}</span>
                : <span className="trn-badge off">{p.nota != null ? `${p.nota}% (mín. ${p.nota_minima}%)` : "Sem nota"}</span>}
              <span className="text-xs text-slate-500">{feitas} de {max ?? "∞"} tentativa(s){p.extras ? ` (+${p.extras} extra)` : ""}</span>
              {max != null && !aprovado && (
                <AcessoGate menu={MENU.alunos} acao="alterar">
                  <Button size="sm" variant={esgotou ? "default" : "outline"} disabled={liberar.isPending}
                          onClick={async () => {
                            try { await liberar.mutateAsync({ alunoId, aulaId: p.aula_id }); toast.success("Mais uma tentativa liberada."); }
                            catch (e: any) { toast.error(e?.message ?? "Não deu para liberar."); }
                          }}>
                    + 1 tentativa
                  </Button>
                </AcessoGate>
              )}
            </div>
            {p.tentativas.length > 0 && (
              <table className="trn-tab mt-2">
                <thead><tr><th>#</th><th>Nota</th><th>Acertos</th><th>Pontos</th><th>Início</th><th>Envio</th></tr></thead>
                <tbody>
                  {p.tentativas.map((t) => (
                    <tr key={t.numero}>
                      <td>{t.numero}</td>
                      <td>{t.enviada_em ? <span className={t.aprovado ? "font-bold text-emerald-700" : "text-rose-700"}>{t.nota}%</span> : <span className="text-slate-400">em andamento</span>}</td>
                      <td>{t.acertos != null ? `${t.acertos}/${t.total}` : "—"}</td>
                      <td>{t.pontos != null ? `${Number(t.pontos)}/${Number(t.pontos_total)}` : "—"}</td>
                      <td className="whitespace-nowrap text-xs">{fmtDataHora(t.iniciada_em)}</td>
                      <td className="whitespace-nowrap text-xs">{t.enviada_em ? fmtDataHora(t.enviada_em) : "—"}{t.encerramento === "tempo_esgotado" && <span className="ml-1 text-rose-600">(tempo esgotado)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
