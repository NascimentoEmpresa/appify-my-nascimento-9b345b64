import { useMemo } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  aderenciaUsuarioChave, evolucaoEntregas, modulosSemTreinamento, prontosSemValidacao, rankingAreas, rotuloValor,
  type DadosChecklist, type Historico, type LinhaModulo,
} from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, StatusPill, fmtDataHora } from "./ui";

// As seis "Análises adicionais sugeridas" do rodapé do painel. Cada uma é
// conta da lib (testada); aqui só a apresentação. Módulo na lista abre a
// página do módulo.

export type Analise = "sem_treinamento" | "prontos_sem_validacao" | "ranking_areas" | "evolucao" | "aderencia" | "historico_validacoes";

const TITULO: Record<Analise, [string, string]> = {
  sem_treinamento: ["Módulos sem treinamento", "Módulos ativos cujo treinamento ainda não foi realizado (pendente, agendado ou sem preenchimento)."],
  prontos_sem_validacao: ["Módulos liberados sem validação", "Desenvolvimento liberado, mas o usuário-chave ainda não validou."],
  ranking_areas: ["Ranking de áreas com mais pendências", "Pendência = etapa não concluída (desenvolvimento, treinamento ou validação) em cada módulo da área."],
  evolucao: ["Evolução das entregas", "Quantas vezes algo (módulo ou tela) virou Liberado, Treinado ou Validado em cada mês."],
  aderencia: ["Aderência por usuário-chave", "Módulos e telas sob cada usuário-chave e quantos ele já validou."],
  historico_validacoes: ["Histórico de validações", "Toda mudança de validação do usuário, com quem fez e quando (auditoria)."],
};

export function AnaliseDialog({ tipo, modulos, dados, historico, nomeUsuario, onAbrirModulo, onFechar }: {
  tipo: Analise; modulos: LinhaModulo[]; dados: DadosChecklist; historico: Historico[] | null;
  nomeUsuario: Map<string, string>; onAbrirModulo: (id: string) => void; onFechar: () => void;
}) {
  const [titulo, desc] = TITULO[tipo];
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <Conteudo tipo={tipo} modulos={modulos} dados={dados} historico={historico} nomeUsuario={nomeUsuario} onAbrirModulo={onAbrirModulo} />
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({ tipo, modulos, dados, historico, nomeUsuario, onAbrirModulo }: Omit<Parameters<typeof AnaliseDialog>[0], "onFechar">) {
  const nomeModulo = useMemo(() => new Map(dados.modulos.map((m) => [m.id, m.nome])), [dados.modulos]);
  const nomeTela = useMemo(() => new Map(dados.telas.map((t) => [t.id, t.nome])), [dados.telas]);

  if (tipo === "sem_treinamento" || tipo === "prontos_sem_validacao") {
    const lista = tipo === "sem_treinamento" ? modulosSemTreinamento(modulos) : prontosSemValidacao(modulos);
    if (!lista.length) return <Vazio texto="Nenhum módulo nessa situação." />;
    return (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lista.map((m) => (
          <li key={m.modulo.id}>
            <button type="button" onClick={() => onAbrirModulo(m.modulo.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{m.modulo.nome}</p>
                <p className="text-xs text-muted-foreground">{m.area} · {m.responsavelId ? nomeUsuario.get(m.responsavelId) ?? "—" : "sem responsável"}</p>
              </div>
              <StatusPill etapa={tipo === "sem_treinamento" ? "treinamento" : "validacao"}
                valor={tipo === "sem_treinamento" ? m.status.status_treinamento : m.status.status_validacao} compacto />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (tipo === "ranking_areas") {
    const r = rankingAreas(modulos);
    const max = Math.max(1, ...r.map((x) => x.pendencias));
    return (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr><th className="py-2">Área</th><th className="py-2 text-right">Módulos</th><th className="py-2 pl-4">Pendências</th><th className="py-2">Efetividade</th></tr>
        </thead>
        <tbody>
          {r.map((x) => (
            <tr key={x.area} className="border-t border-border">
              <td className="py-2 font-medium">{x.area}</td>
              <td className="py-2 text-right tabular-nums">{x.modulos}</td>
              <td className="py-2 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-orange-500" style={{ width: `${(x.pendencias / max) * 100}%` }} /></div>
                  <span className="text-xs font-bold tabular-nums">{x.pendencias}</span>
                </div>
              </td>
              <td className="py-2"><BarraEfetividade valor={x.efetividade} largura="w-20" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (tipo === "evolucao") {
    if (!historico) return <Carregando />;
    const ev = evolucaoEntregas(historico);
    const max = Math.max(1, ...ev.flatMap((x) => [x.prontos, x.treinados, x.validados]));
    const series = [
      { k: "prontos" as const, rotulo: "Liberados", cor: "#16a34a" },
      { k: "treinados" as const, rotulo: "Treinados", cor: "#2563eb" },
      { k: "validados" as const, rotulo: "Validados", cor: "#7c3aed" },
    ];
    return (
      <div>
        <div className="mb-3 flex gap-4 text-xs">
          {series.map((s) => <span key={s.k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />{s.rotulo}</span>)}
        </div>
        <div className="flex h-56 items-end gap-3 border-b border-border pb-1">
          {ev.map((m) => (
            <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-48 w-full items-end justify-center gap-1">
                {series.map((s) => (
                  <div key={s.k} className="flex w-1/4 flex-col items-center justify-end" title={`${s.rotulo}: ${m[s.k]}`}>
                    {m[s.k] > 0 && <span className="text-[10px] font-bold tabular-nums">{m[s.k]}</span>}
                    <div className="w-full rounded-t" style={{ height: `${(m[s.k] / max) * 170}px`, background: s.cor, minHeight: m[s.k] ? 3 : 0 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3">{ev.map((m) => <span key={m.mes} className="flex-1 text-center text-xs text-muted-foreground">{m.rotulo}</span>)}</div>
      </div>
    );
  }

  if (tipo === "aderencia") {
    const r = aderenciaUsuarioChave(modulos);
    if (!r.length) return <Vazio texto="Nenhum usuário-chave definido ainda. Defina no status do módulo ou de cada submódulo." />;
    return (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr><th className="py-2">Usuário-chave</th><th className="py-2 text-right">Itens</th><th className="py-2 text-right">Em validação</th><th className="py-2 text-right">Validados</th><th className="py-2 pl-4">Taxa</th></tr>
        </thead>
        <tbody>
          {r.map((x) => (
            <tr key={x.userId} className="border-t border-border">
              <td className="py-2 font-medium">{nomeUsuario.get(x.userId) ?? "—"}</td>
              <td className="py-2 text-right tabular-nums">{x.itens}</td>
              <td className="py-2 text-right tabular-nums">{x.emValidacao}</td>
              <td className="py-2 text-right tabular-nums">{x.validados}</td>
              <td className="py-2 pl-4"><BarraEfetividade valor={x.taxa} largura="w-20" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // historico_validacoes
  if (!historico) return <Carregando />;
  const val = historico.filter((h) => h.campo === "status_validacao" || h.campo === "data_validacao" || h.campo === "usuario_chave_id");
  if (!val.length) return <Vazio texto="Nenhuma validação registrada ainda." />;
  return (
    <ol className="space-y-2">
      {val.slice(0, 300).map((h) => (
        <li key={h.id} className="rounded-lg border border-border p-2.5 text-sm">
          <p>
            <b>{nomeModulo.get(h.modulo_id ?? "") ?? "—"}</b>
            {h.menu_id && <span className="text-muted-foreground"> › {nomeTela.get(h.menu_id) ?? "tela removida"}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{h.campo === "status_validacao" ? "Validação" : h.campo === "data_validacao" ? "Data da validação" : "Usuário-chave"}:</span>
            <span className="text-muted-foreground line-through">{rotuloValor(h.campo, h.de)}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-semibold">{rotuloValor(h.campo, h.para)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">{h.usuario_nome ?? "—"} · {fmtDataHora(h.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}

const Vazio = ({ texto }: { texto: string }) => <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{texto}</p>;
const Carregando = () => <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>;
