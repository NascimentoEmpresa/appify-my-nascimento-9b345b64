import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import type { CertificadoModelo } from "./tipos";

// =====================================================================
// A folha do certificado — usada na prévia do editor de modelo e na
// visualização/impressão do certificado emitido. Substitui ${curso} e
// ${data} nos textos, como o membox.
// =====================================================================

export interface DadosCertificado {
  aluno: string; documento?: string | null; curso: string; data: string;
  cargaHorariaMin?: number | null; codigo: string;
  modulos?: { nome: string; aulas: string[] }[];
}

const troca = (t: string | null | undefined, d: DadosCertificado) =>
  (t ?? "").replace(/\$\{curso\}/g, d.curso).replace(/\$\{data\}/g, d.data);

export function CertificadoFrente({ modelo, dados }: { modelo: CertificadoModelo; dados: DadosCertificado }) {
  const fundo = urlMidia(modelo.fundo_path);
  const centro = modelo.layout === "centro";
  return (
    <div className="trn-cert" style={{
      position: "relative", width: "100%", aspectRatio: "297/210", background: fundo ? `url(${fundo}) center/cover no-repeat` : "linear-gradient(135deg,#f8fafc,#e2e8f0)",
      border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", color: "#0f172a", fontFamily: "Georgia, serif",
    }}>
      <div style={{ position: "absolute", inset: 0, padding: "7% 8%", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: centro ? "center" : "left", alignItems: centro ? "center" : "flex-start" }}>
        {modelo.exibir_nome_negocio && <div style={{ fontSize: "1.1em", letterSpacing: ".2em", textTransform: "uppercase", fontWeight: 700, color: "#0f3171", marginBottom: "1.2em" }}>Grupo Nascimento</div>}
        <div style={{ fontSize: "2.2em", fontWeight: 700, marginBottom: ".6em" }}>{modelo.titulo}</div>
        {modelo.texto_superior && <div style={{ fontSize: "1em", opacity: .85 }}>{troca(modelo.texto_superior, dados)}</div>}
        <div style={{ fontSize: "1.9em", fontWeight: 700, margin: ".4em 0", borderBottom: "2px solid #f26522", paddingBottom: ".15em" }}>{dados.aluno}</div>
        {modelo.exibir_documento && dados.documento && <div style={{ fontSize: ".9em", opacity: .7 }}>CPF: {dados.documento}</div>}
        {modelo.texto_inferior && <div style={{ fontSize: "1em", marginTop: ".6em", opacity: .85 }}>{troca(modelo.texto_inferior, dados)}</div>}
        {modelo.exibir_carga_horaria && dados.cargaHorariaMin != null && dados.cargaHorariaMin > 0 && (
          <div style={{ fontSize: ".9em", marginTop: ".5em", opacity: .8 }}>Carga horária: {Math.round(dados.cargaHorariaMin / 60 * 10) / 10} horas</div>
        )}
        <div style={{ marginTop: "1.6em", fontSize: ".7em", opacity: .7, display: "flex", gap: "1.5em", alignItems: "center" }}>
          {modelo.exibir_qr && <div style={{ width: "3.4em", height: "3.4em", border: "2px solid #0f172a", display: "grid", placeItems: "center", fontSize: ".6em", textAlign: "center", lineHeight: 1.1 }}>QR<br />validação</div>}
          <div>ID de validação:<br /><b style={{ fontFamily: "monospace", fontSize: "1.2em" }}>{dados.codigo}</b></div>
          {modelo.exibir_cnpj && <div>CNPJ: —</div>}
        </div>
      </div>
    </div>
  );
}

export function CertificadoVerso({ modelo, dados }: { modelo: CertificadoModelo; dados: DadosCertificado }) {
  const fundo = urlMidia(modelo.fundo_verso_path ?? modelo.fundo_path);
  return (
    <div className="trn-cert" style={{
      position: "relative", width: "100%", aspectRatio: "297/210", background: fundo ? `url(${fundo}) center/cover no-repeat` : "linear-gradient(135deg,#f8fafc,#e2e8f0)",
      border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", color: "#0f172a", fontFamily: "Georgia, serif",
    }}>
      <div style={{ position: "absolute", inset: 0, padding: "6% 8%", overflow: "hidden" }}>
        <div style={{ fontSize: "1.6em", fontWeight: 700, marginBottom: ".2em" }}>{modelo.verso_titulo || "Conteúdo programático"}</div>
        <div style={{ fontSize: "1em", opacity: .8, marginBottom: ".8em" }}>{dados.curso}</div>
        <div style={{ columns: 2, columnGap: "2em", fontSize: ".85em" }}>
          {(dados.modulos ?? []).map((m, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: ".6em" }}>
              <div style={{ fontWeight: 700 }}>Módulo {i + 1} - {m.nome}</div>
              {!modelo.verso_somente_modulos && m.aulas.map((a, k) => <div key={k} style={{ opacity: .8 }}>✓ Aula {k + 1} - {a}</div>)}
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", bottom: "6%", left: "8%", fontSize: ".7em", opacity: .7 }}>ID de validação: <b style={{ fontFamily: "monospace" }}>{dados.codigo}</b></div>
      </div>
    </div>
  );
}

export const EXEMPLO: DadosCertificado = {
  aluno: "Nome do aluno", documento: "XXX.XXX.XXX-XX", curso: "NOME_EXEMPLO",
  data: new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }),
  cargaHorariaMin: 1800, codigo: "ABC789GHTD445S0",
  modulos: [{ nome: "Introdução", aulas: ["Conceitos básicos", "Primeiros passos"] }, { nome: "Desenvolvimento", aulas: ["Conceitos avançados", "Projeto prático"] }],
};
