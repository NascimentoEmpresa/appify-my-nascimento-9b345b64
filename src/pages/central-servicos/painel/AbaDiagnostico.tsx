// Painel Gerencial — aba DIAGNÓSTICO IA.
//
// A aba só escolhe o setor e apresenta o último resultado persistido. A Edge
// Function relê as respostas sob a RLS do usuário e produz o agregado anônimo;
// nenhum texto de pessoa é montado ou enviado pelo navegador.
import { useEffect, useMemo, useState } from "react";
import { useDiagnosticoFeedback, type ForcaDiagnostico } from "@/hooks/useDiagnosticoFeedback";
import { normSetor } from "../LideresSetor";
import type { Resp } from "./tipos";
import { btn } from "./ui";

const caixa = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
  padding: "16px 18px",
  boxShadow: "0 8px 24px rgba(15,23,42,.05)",
} as const;

const corForca = (forca: ForcaDiagnostico) => forca === "Alta"
  ? { fundo: "#fee2e2", texto: "#b91c1c" }
  : forca === "Média"
  ? { fundo: "#fef3c7", texto: "#b45309" }
  : { fundo: "#e0f2fe", texto: "#0369a1" };

function Selo({ valor, rotulo = "Força" }: { valor: ForcaDiagnostico; rotulo?: string }) {
  const cor = corForca(valor);
  return (
    <span title={`${rotulo}: ${valor}`} style={{
      display: "inline-flex", alignItems: "center", borderRadius: 20, padding: "3px 8px",
      background: cor.fundo, color: cor.texto, fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap",
    }}>{valor}</span>
  );
}

function BlocoTemas({ titulo, subtitulo, itens, cor }: {
  titulo: string;
  subtitulo: string;
  itens: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  cor: string;
}) {
  return (
    <section style={caixa}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>{subtitulo}</div>
      {itens.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhum tema material identificado.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {itens.map((item, i) => (
            <div key={`${item.tema}-${i}`} style={{ borderLeft: `3px solid ${cor}`, paddingLeft: 11 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#1e293b" }}>{item.tema}</div>
                <Selo valor={item.forca} />
              </div>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, marginTop: 3 }}>{item.evidencia}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const formatarData = (valor?: string) => {
  if (!valor) return "data não informada";
  const data = new Date(valor);
  return Number.isNaN(+data) ? valor : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export default function AbaDiagnostico({ formularioId, setor, respostas }: {
  formularioId: string;
  setor: string;
  respostas: Resp[];
}) {
  const { data, loading, error, run, reset, carregarUltimo } = useDiagnosticoFeedback();
  const [gerando, setGerando] = useState(false);
  const setorNorm = normSetor(setor);
  const respostasDoSetor = useMemo(() => respostas.filter((r) => normSetor(r.setor) === setorNorm), [respostas, setorNorm]);
  const qtd = respostasDoSetor.length;
  // Espelha MINIMO_RESPOSTAS_DIAGNOSTICO do _shared da Edge Function (hoje 1) —
  // a autoridade é ela, aqui é só para não oferecer um botão que o backend
  // recusaria. Era 5 até SIS-2026-0311; ver o comentário lá para o porquê.
  const elegivel = qtd >= 1;
  // Abaixo de 5 o diagnóstico sai, mas a leitura é frágil. Deixou de barrar e
  // passou a avisar: a decisão de gerar é do gestor, informada.
  const amostraPequena = qtd > 0 && qtd < 5;

  useEffect(() => {
    setGerando(false);
    if (!formularioId || !setorNorm || !elegivel) {
      reset();
      return;
    }
    carregarUltimo(formularioId, setorNorm);
  }, [formularioId, setorNorm, elegivel, carregarUltimo, reset]);

  const gerar = async () => {
    setGerando(true);
    try { await run(formularioId, setor); }
    finally { setGerando(false); }
  };

  const novas = useMemo(() => {
    if (!data) return 0;
    if (!data.gerado_em) return Math.max(0, qtd - data.qtd_respostas);
    const corte = +new Date(data.gerado_em);
    return respostasDoSetor.filter((r) => +new Date(r.enviado_em) > corte).length;
  }, [data, qtd, respostasDoSetor]);

  if (!setorNorm) {
    return (
      <div style={{ ...caixa, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Escolha um setor</div>
        <div style={{ fontSize: 12.5, color: "#64748b" }}>O diagnóstico lê um setor por vez. Use o filtro <b>Setor</b> acima para começar.</div>
      </div>
    );
  }

  if (!elegivel) {
    return (
      <div style={{ ...caixa, padding: 40, textAlign: "center", borderColor: "#fde68a", background: "#fffbeb" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#92400e", marginBottom: 6 }}>Nenhuma resposta visível em {setor}</div>
        <div style={{ fontSize: 12.5, color: "#92400e", lineHeight: 1.5 }}>
          O diagnóstico precisa de pelo menos uma resposta para ter o que ler. Ou este setor ainda
          não respondeu ao formulário, ou o seu acesso não alcança as respostas dele.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>DIAGNÓSTICO IA</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Leitura anônima dos feedbacks de <b>{setor}</b>, cruzando equipe, liderança e próximos passos.</div>
        </div>
        <button onClick={gerar} disabled={loading}
          style={{ ...btn("#0f3171"), opacity: loading ? .65 : 1, cursor: loading ? "wait" : "pointer" }}>
          {gerando ? "Gerando diagnóstico…" : loading ? "Carregando…" : "Gerar diagnóstico"}
        </button>
      </div>

      {amostraPequena && (
        <div style={{ marginBottom: 14, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", color: "#475569", fontSize: 12, lineHeight: 1.5 }}>
          Amostra pequena: <b>{qtd}</b> resposta(s) visível(is) em {setor}. O diagnóstico sai
          normalmente, mas com poucas respostas ele pode estar refletindo a opinião de uma
          pessoa só — leia como indício, não como conclusão do setor.
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginBottom: 14, padding: "12px 14px", border: "1px solid #fecaca", borderRadius: 12, background: "#fef2f2", color: "#b91c1c", fontSize: 12.5 }}>
          <b>Não foi possível concluir o diagnóstico.</b> {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ ...caixa, padding: 50, textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 5 }}>{gerando ? "Analisando o setor…" : "Carregando o último diagnóstico…"}</div>
          {gerando ? "As distribuições já foram calculadas. A IA está agrupando os temas e preparando o plano de ação." : "Consultando o histórico salvo para este setor."}
        </div>
      ) : !data ? (
        <div style={{ ...caixa, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Ainda não há diagnóstico salvo</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Há {qtd} respostas visíveis prontas para análise neste setor.</div>
        </div>
      ) : (
        <>
          <div style={{ ...caixa, padding: "11px 15px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>
              Último diagnóstico salvo em <b>{formatarData(data.gerado_em)}</b>, sobre <b>{data.qtd_respostas} respostas</b>.
            </div>
            {novas > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "#92400e", background: "#fef3c7", borderRadius: 20, padding: "4px 9px" }}>
                {novas} resposta(s) nova(s) depois dele
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
            <BlocoTemas titulo="Liderados → líder" subtitulo="O que a equipe sinaliza que precisa da liderança." itens={data.liderados_para_lider ?? []} cor="#2563eb" />
            <BlocoTemas titulo="Líder → liderados" subtitulo="O que a liderança aponta nos feedbacks registrados." itens={data.lider_para_liderados ?? []} cor="#7c3aed" />
          </div>

          <section style={{ ...caixa, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Convergências</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>Onde os dois lados se encontram — ou onde há uma diferença importante de percepção.</div>
            {(data.convergencias ?? []).length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhuma convergência material identificada.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
                {data.convergencias.map((item, i) => (
                  <div key={`${item.tema}-${i}`} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 11, padding: "11px 12px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>{item.tema}</div>
                    <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{item.leitura}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={caixa}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Plano de ação</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>Próximos passos sugeridos a partir do cruzamento dos dois eixos.</div>
            {(data.plano_de_acao ?? []).length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhuma ação foi sugerida.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.plano_de_acao.map((item, i) => (
                  <div key={`${item.acao}-${i}`} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 10, alignItems: "start", borderTop: i ? "1px solid #f1f5f9" : "none", paddingTop: i ? 10 : 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 9, background: "#eef2ff", color: "#4338ca", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#1e293b" }}>{item.acao}</div>
                      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, marginTop: 3 }}>{item.porque}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 5 }}>Prazo sugerido: <b>{item.prazo_sugerido_dias} dias</b></div>
                    </div>
                    <Selo valor={item.prioridade} rotulo="Prioridade" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
