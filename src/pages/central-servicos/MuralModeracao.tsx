import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useDecidirMural, useMuralModeracao, type ItemModeracao } from "@/hooks/useMuralReconhecimento";
import { mesAnterior, rotuloMes, somarMes, type StatusMural } from "@/lib/formularios/muralReconhecimento";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - Mural do Início (moderação)
//
// Pedido do Pablo (30/10/2026): os comentários POSITIVOS da pergunta
// "colegas" vão para o cartão "Reconhecimento e Convivência Profissional"
// do Início, sempre do mês anterior — mas só depois que quem tem acesso às
// permissões do formulário LIBERAR. Esta janela é essa liberação.
//
// A fila já chega filtrada pelo banco (cs_form_mural_moderacao): só nota
// alta + comentário com texto. Nada aqui mostra quem respondeu — o
// formulário é anônimo e a moderação também.
//
// Abre no MÊS ANTERIOR, que é o que está no Início agora; as setas
// adiantam o mês corrente para deixar a lista pronta antes da virada.
// =====================================================================

const MESES_CAP = (ym: string) => rotuloMes(ym).replace(/^./, (c) => c.toUpperCase());

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const btnSeta: React.CSSProperties = { width: 32, height: 32, borderRadius: 9, border: "1px solid #e2e8f0", background: "#fff", color: "#0f3171", fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: "pointer" };

const COR_STATUS: Record<StatusMural, { bg: string; c: string; rot: string }> = {
  pendente: { bg: "#fef3c7", c: "#b45309", rot: "Pendente" },
  liberado: { bg: "#dcfce7", c: "#15803d", rot: "No mural" },
  recusado: { bg: "#f1f5f9", c: "#64748b", rot: "Recusado" },
};

type Filtro = "todos" | StatusMural;

export default function MuralModeracao({ formId, onFechar }: { formId: string; onFechar: () => void }) {
  const noInicio = mesAnterior();
  const [mes, setMes] = useState(noInicio);
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const { data: itens = [], isLoading, error } = useMuralModeracao(formId, mes, true);
  const decidir = useDecidirMural();

  const contagem = useMemo(() => {
    const c: Record<StatusMural, number> = { pendente: 0, liberado: 0, recusado: 0 };
    itens.forEach((i) => { c[i.status] += 1; });
    return c;
  }, [itens]);
  const visiveis = filtro === "todos" ? itens : itens.filter((i) => i.status === filtro);
  const pendentes = itens.filter((i) => i.status === "pendente");

  const aplicar = (lista: ItemModeracao[], status: StatusMural) => {
    if (!lista.length) return;
    decidir.mutate({ itens: lista, status }, {
      onSuccess: () => {
        if (lista.length > 1) toast.success(`${lista.length} comentário(s) ${status === "liberado" ? "liberados para o mural" : "atualizados"}.`);
      },
      onError: (e: Error) => toast.error(e?.message ?? "Não foi possível salvar."),
    });
  };

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(780px, 100%)", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#f8fafc", borderRadius: 18, boxShadow: "0 30px 70px rgba(15,23,42,.35)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "linear-gradient(120deg,#0f3171,#1d4a92 60%,#f97316)", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>🏆 Mural do Início — Reconhecimento</div>
              <div style={{ fontSize: 12, opacity: .85, marginTop: 3, lineHeight: 1.45 }}>
                Só comentários <b>positivos</b> (nota alta e com texto). O que você liberar aparece no cartão
                "Reconhecimento e Convivência Profissional" do Início <b>no mês seguinte ao do voto</b>, sem o nome de quem escreveu.
              </div>
            </div>
            <button onClick={onFechar} aria-label="Fechar" style={{ ...btn("rgba(255,255,255,.16)"), fontSize: 15, padding: "4px 10px" }}>✕</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderBottom: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
          <button style={btnSeta} onClick={() => setMes((m) => somarMes(m, -1))} aria-label="Mês anterior">‹</button>
          <div style={{ minWidth: 150, textAlign: "center" }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>Votos de {MESES_CAP(mes)}</div>
            <div style={{ fontSize: 10.5, color: mes === noInicio ? "#15803d" : "#94a3b8", fontWeight: 700 }}>
              {mes === noInicio ? "● no Início agora" : `vai ao Início em ${rotuloMes(somarMes(mes, 1))}`}
            </div>
          </div>
          <button style={btnSeta} onClick={() => setMes((m) => somarMes(m, 1))} aria-label="Próximo mês">›</button>
          <div style={{ flex: 1 }} />
          {(["pendente", "liberado", "recusado", "todos"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ ...btn(filtro === f ? "#0f3171" : "#fff", filtro === f ? "#fff" : "#475569", "1px solid #e2e8f0"), padding: "5px 10px", fontSize: 11.5 }}>
              {f === "todos" ? `Todos (${itens.length})` : `${COR_STATUS[f].rot} (${contagem[f]})`}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          ) : error ? (
            <div style={{ padding: 30, textAlign: "center", color: "#b91c1c", fontSize: 13 }}>{(error as Error)?.message ?? "Não foi possível carregar."}</div>
          ) : !visiveis.length ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              {itens.length ? "Nada neste filtro." : `Nenhum comentário positivo nos votos de ${rotuloMes(mes)}.`}
              {/* Abre no mês que está no Início; quem chega antes da virada
                  quer preparar o mês corrente — um clique em vez de achar a seta. */}
              {!itens.length && mes === noInicio && (
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => setMes(somarMes(noInicio, 1))} style={btn("#0f3171")}>
                    Ver os votos de {rotuloMes(somarMes(noInicio, 1))} →
                  </button>
                </div>
              )}
            </div>
          ) : visiveis.map((i) => {
            const st = COR_STATUS[i.status];
            const ocupado = decidir.isPending;
            return (
              <div key={`${i.resposta_id}:${i.pergunta_id}:${i.linha}`}
                style={{ background: "#fff", border: "1px solid #e2e8f0", borderLeft: `4px solid ${st.c}`, borderRadius: 12, padding: "12px 14px", boxShadow: "0 4px 14px rgba(15,23,42,.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a", textTransform: "uppercase" }}>{i.colaborador}</span>
                  {i.setor && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{i.setor}</span>}
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b" }}>★ {i.nota}/{i.escala}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.c }}>{st.rot}</span>
                  <div style={{ flex: 1 }} />
                  {i.status !== "liberado" && (
                    <button disabled={ocupado} onClick={() => aplicar([i], "liberado")} style={btn("#16a34a")}>✓ Liberar</button>
                  )}
                  {i.status !== "recusado" && (
                    <button disabled={ocupado} onClick={() => aplicar([i], "recusado")} style={btn("#fff", "#b91c1c", "1px solid #fecaca")}>Recusar</button>
                  )}
                  {i.status !== "pendente" && (
                    <button disabled={ocupado} onClick={() => aplicar([i], "pendente")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Desfazer</button>
                  )}
                </div>
                <div style={{ marginTop: 7, fontSize: 13, color: "#334155", fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>“{i.comentario}”</div>
                {i.decidido_por && i.status !== "pendente" && (
                  <div style={{ marginTop: 6, fontSize: 10.5, color: "#94a3b8" }}>
                    {i.status === "liberado" ? "Liberado" : "Recusado"} por {i.decidido_por}
                    {i.decidido_em ? ` em ${new Date(i.decidido_em).toLocaleDateString("pt-BR")}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid #e2e8f0", background: "#fff" }}>
          <span style={{ fontSize: 11.5, color: "#64748b", flex: 1 }}>
            {contagem.liberado} no mural · {contagem.pendente} pendente(s) · {contagem.recusado} recusado(s)
          </span>
          <button disabled={!pendentes.length || decidir.isPending}
            onClick={() => { if (confirm(`Liberar os ${pendentes.length} comentário(s) pendente(s) de ${rotuloMes(mes)}?`)) aplicar(pendentes, "liberado"); }}
            style={btn(pendentes.length ? "#16a34a" : "#94a3b8")}>✓ Liberar todos os pendentes</button>
        </div>
      </div>
    </div>
  );
}
