// Painel Gerencial — aba DIAGNÓSTICO IA para QUALQUER formulário (15/09/2026).
//
// Irmã da AbaDiagnostico (feedback guiado). Aqui não há eixos de liderança:
// a IA lê todas as perguntas e devolve resumo, pontos fortes, pontos de
// atenção, uma leitura por pergunta e plano de ação. O setor é opcional —
// sem filtro, o diagnóstico é de todas as respostas visíveis. A Edge
// Function relê as respostas sob a RLS do usuário e monta o agregado anônimo;
// nada de pessoa sai do navegador.
import { useEffect, useMemo, useState } from "react";
import { useDiagnosticoFormulario } from "@/hooks/useDiagnosticoFormulario";
import type { ForcaDiagnostico } from "@/hooks/useDiagnosticoFeedback";
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

function BlocoTemas({ titulo, subtitulo, itens, cor, vazio }: {
  titulo: string;
  subtitulo: string;
  itens: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  cor: string;
  vazio: string;
}) {
  return (
    <section style={caixa}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>{subtitulo}</div>
      {itens.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>{vazio}</div> : (
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

export default function AbaDiagnosticoFormulario({ formularioId, tituloFormulario, setor, respostas }: {
  formularioId: string;
  tituloFormulario: string;
  setor: string;
  respostas: Resp[];
}) {
  const { data, loading, error, run, reset, carregarUltimo } = useDiagnosticoFormulario();
  const [gerando, setGerando] = useState(false);
  const setorNorm = normSetor(setor);
  // Sem setor no filtro: todas as respostas visíveis do formulário.
  const respostasDoRecorte = useMemo(
    () => setorNorm ? respostas.filter((r) => normSetor(r.setor) === setorNorm) : respostas,
    [respostas, setorNorm],
  );
  const qtd = respostasDoRecorte.length;
  const elegivel = qtd >= 1;
  const amostraPequena = qtd > 0 && qtd < 5;
  const rotuloRecorte = setorNorm ? <>do setor <b>{setor}</b></> : <>de <b>todas as respostas</b></>;

  useEffect(() => {
    setGerando(false);
    if (!formularioId || !elegivel) {
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
    return respostasDoRecorte.filter((r) => +new Date(r.enviado_em) > corte).length;
  }, [data, qtd, respostasDoRecorte]);

  if (!elegivel) {
    return (
      <div style={{ ...caixa, padding: 40, textAlign: "center", borderColor: "#fde68a", background: "#fffbeb" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#92400e", marginBottom: 6 }}>
          Nenhuma resposta visível {setorNorm ? `em ${setor}` : "neste formulário"}
        </div>
        <div style={{ fontSize: 12.5, color: "#92400e", lineHeight: 1.5 }}>
          O diagnóstico precisa de pelo menos uma resposta para ter o que ler. Ou ninguém respondeu
          ainda, ou o seu acesso não alcança as respostas.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>DIAGNÓSTICO IA</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>
            Leitura anônima {rotuloRecorte} de <b>{tituloFormulario}</b>: pontos fortes, pontos de atenção e próximos passos.
            {!setorNorm && <> Use o filtro <b>Setor</b> acima para um recorte.</>}
          </div>
        </div>
        <button onClick={gerar} disabled={loading}
          style={{ ...btn("#0f3171"), opacity: loading ? .65 : 1, cursor: loading ? "wait" : "pointer" }}>
          {gerando ? "Gerando diagnóstico…" : loading ? "Carregando…" : "Gerar diagnóstico"}
        </button>
      </div>

      {amostraPequena && (
        <div style={{ marginBottom: 14, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", color: "#475569", fontSize: 12, lineHeight: 1.5 }}>
          Amostra pequena: <b>{qtd}</b> resposta(s) visível(is). O diagnóstico sai normalmente, mas
          com poucas respostas ele pode estar refletindo a opinião de uma pessoa só — leia como
          indício, não como conclusão.
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginBottom: 14, padding: "12px 14px", border: "1px solid #fecaca", borderRadius: 12, background: "#fef2f2", color: "#b91c1c", fontSize: 12.5 }}>
          <b>Não foi possível concluir o diagnóstico.</b> {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ ...caixa, padding: 50, textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 5 }}>{gerando ? "Analisando as respostas…" : "Carregando o último diagnóstico…"}</div>
          {gerando ? "As distribuições já foram calculadas. A IA está agrupando os temas e preparando o plano de ação." : "Consultando o histórico salvo para este formulário."}
        </div>
      ) : !data ? (
        <div style={{ ...caixa, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Ainda não há diagnóstico salvo</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Há {qtd} resposta(s) visível(is) pronta(s) para análise.</div>
        </div>
      ) : (
        <>
          <div style={{ ...caixa, padding: "11px 15px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>
              Último diagnóstico salvo em <b>{formatarData(data.gerado_em)}</b>, sobre <b>{data.qtd_respostas} respostas</b>
              {data.gerado_por_nome ? <> — por {data.gerado_por_nome}</> : null}.
            </div>
            {novas > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "#92400e", background: "#fef3c7", borderRadius: 20, padding: "4px 9px" }}>
                {novas} resposta(s) nova(s) depois dele
              </div>
            )}
          </div>

          <section style={{ ...caixa, marginBottom: 14, borderLeft: "4px solid #0f3171" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Resumo</div>
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6 }}>{data.resumo}</div>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
            <BlocoTemas titulo="Pontos fortes" subtitulo="O que as respostas mostram de positivo." itens={data.pontos_fortes ?? []} cor="#15803d" vazio="Nenhum ponto forte material identificado." />
            <BlocoTemas titulo="Pontos de atenção" subtitulo="O que pede cuidado ou ação da gestão." itens={data.pontos_de_atencao ?? []} cor="#dc2626" vazio="Nenhum ponto de atenção material identificado." />
          </div>

          <section style={{ ...caixa, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Leitura por pergunta</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>Uma frase objetiva sobre cada pergunta que mais disse alguma coisa.</div>
            {(data.leitura_por_pergunta ?? []).length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhuma leitura por pergunta.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>
                {data.leitura_por_pergunta.map((item, i) => (
                  <div key={`${item.pergunta}-${i}`} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 11, padding: "11px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>{item.pergunta}</div>
                    <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{item.leitura}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={caixa}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Plano de ação</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 12px" }}>Próximos passos sugeridos a partir das respostas.</div>
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
