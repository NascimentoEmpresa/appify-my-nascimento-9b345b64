import { useEffect, type CSSProperties } from "react";
import type { AssinaturaCertificado } from "./tipos";

// =====================================================================
// TREINAMENTOS — assinatura do treinador no certificado (mig 20261005000003)
//
// Pedido (05/10/2026): "ASSINADO DIGITALMENTE POR: nome completo do
// treinador + assinatura desenhada na tela, pode ser em texto bonito,
// desenhada, texto com escolha de letra". Dois tipos:
//   · desenho — o traço feito com o mouse/dedo, salvo como PNG;
//   · texto   — o nome escrito numa das fontes cursivas abaixo.
// A folha (CertificadoPreview) usa BlocoAssinatura; o editor
// (AssinaturaEditor) e a tela Cursos › Assinaturas usam AssinaturaTraco.
//
// O nome do arquivo não é "assinaturas.tsx" de propósito: no Windows ele
// é o mesmo arquivo que a tela "Assinaturas.tsx".
// =====================================================================

/** Fontes da assinatura em texto (Google Fonts, carregadas sob demanda). */
export const FONTES_ASSINATURA = [
  { id: "Great Vibes", nome: "Great Vibes" },
  { id: "Dancing Script", nome: "Dancing Script" },
  { id: "Allura", nome: "Allura" },
  { id: "Alex Brush", nome: "Alex Brush" },
  { id: "Sacramento", nome: "Sacramento" },
  { id: "Pinyon Script", nome: "Pinyon Script" },
  { id: "Parisienne", nome: "Parisienne" },
  { id: "Caveat", nome: "Caveat" },
] as const;

const URL_FONTES = "https://fonts.googleapis.com/css2?" +
  FONTES_ASSINATURA.map((f) => `family=${f.id.replace(/ /g, "+")}`).join("&") + "&display=swap";

/** Põe o <link> das fontes cursivas uma vez só (index.html já traz a Dancing Script). */
export function useFontesAssinatura() {
  useEffect(() => {
    if (document.getElementById("trn-fontes-assinatura")) return;
    const l = document.createElement("link");
    l.id = "trn-fontes-assinatura"; l.rel = "stylesheet"; l.href = URL_FONTES;
    document.head.appendChild(l);
  }, []);
}

/**
 * Assinatura que deixa o curso ser PUBLICADO (mig 20261006000001, pedido de
 * 06/10/2026): cargo de Técnico(a) em Segurança — aceita "Téc em segurança"
 * — e registro preenchido. Mesma regra de trn_assinatura_eh_tst no banco;
 * mudar nos dois lugares.
 */
export function assinaturaValeParaPublicar(a: Pick<AssinaturaCertificado, "cargo" | "registro"> | null | undefined): boolean {
  if (!a) return false;
  const cargo = (a.cargo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /tec.*seguranc/.test(cargo) && (a.registro ?? "").trim().length >= 2;
}

/** "Cargo · Registro: X" — a linha embaixo do nome nas listas e seletores. */
export function cargoERegistro(a: Pick<AssinaturaCertificado, "cargo" | "registro">): string {
  return [a.cargo?.trim(), a.registro?.trim() ? `Registro: ${a.registro.trim()}` : ""].filter(Boolean).join(" · ");
}

/** O que falta para a assinatura poder ser salva; null = está ok. Mesmas regras do CHECK do banco. */
export function problemaAssinatura(a: Partial<AssinaturaCertificado>): string | null {
  if ((a.nome_completo ?? "").trim().length < 3) return "Informe o nome completo do treinador.";
  // Cargo e registro aparecem na assinatura (06/10/2026) — obrigatórios.
  if ((a.cargo ?? "").trim().length < 2) return "Informe o cargo (ex.: Técnica em Segurança do Trabalho).";
  if ((a.registro ?? "").trim().length < 2) return "Informe o registro profissional.";
  if (a.tipo === "desenho") {
    if (!a.imagem?.startsWith("data:image/png;base64,")) return "Desenhe a assinatura no quadro.";
    if (a.imagem.length > 400_000) return "A assinatura ficou grande demais — limpe e desenhe de novo.";
    return null;
  }
  if (a.tipo === "texto") {
    if ((a.texto ?? "").trim().length < 2) return "Escreva a assinatura.";
    if (!FONTES_ASSINATURA.some((f) => f.id === a.fonte)) return "Escolha a letra da assinatura.";
    return null;
  }
  return "Escolha desenhar ou escrever a assinatura.";
}

/**
 * Só o traço: a imagem desenhada ou o texto na fonte escolhida. `altura`
 * em qualquer unidade CSS — na folha usa cqw, na tela px.
 */
export function AssinaturaTraco({ a, altura, cor = "#1e293b" }: { a: AssinaturaCertificado; altura: string; cor?: string }) {
  useFontesAssinatura();
  if (a.tipo === "desenho") {
    return a.imagem
      ? <img src={a.imagem} alt={`Assinatura de ${a.nome_completo}`} style={{ height: altura, maxWidth: "100%", objectFit: "contain" }} />
      : <div style={{ height: altura }} />;
  }
  const estilo: CSSProperties = {
    fontFamily: `'${a.fonte ?? "Great Vibes"}', cursive`, fontSize: `calc(${altura} * 0.72)`, lineHeight: altura,
    height: altura, color: cor, whiteSpace: "nowrap", overflow: "hidden",
  };
  return <div style={estilo}>{a.texto}</div>;
}

/**
 * O bloco da folha: traço, linha, "ASSINADO DIGITALMENTE POR:", nome, cargo
 * e registro (registro desde 06/10/2026, mig 20261006000001).
 * Medido em cqw da folha; `escala` aumenta tudo junto (a prévia do editor
 * não está dentro de uma folha, então desenha maior).
 */
export function BlocoAssinatura({ a, escala = 1 }: { a: AssinaturaCertificado; escala?: number }) {
  const u = (n: number) => `${n * escala}cqw`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: u(24) }}>
      <AssinaturaTraco a={a} altura={u(4.6)} />
      <div style={{ width: "100%", borderTop: "1px solid #52525b", marginTop: u(0.3) }} />
      <div style={{ fontSize: u(0.72), letterSpacing: ".08em", color: "#71717a", marginTop: u(0.5), fontWeight: 600 }}>
        ASSINADO DIGITALMENTE POR:
      </div>
      <div style={{ fontSize: u(1.05), fontWeight: 700, color: "#27272a", marginTop: u(0.2), lineHeight: 1.2 }}>{a.nome_completo}</div>
      {a.cargo && <div style={{ fontSize: u(0.85), color: "#71717a", marginTop: u(0.15) }}>{a.cargo}</div>}
      {a.registro && <div style={{ fontSize: u(0.78), color: "#71717a", marginTop: u(0.1) }}>Registro: {a.registro}</div>}
    </div>
  );
}
