import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { AssinaturaCertificado } from "./tipos";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

/**
 * Fontes da assinatura em texto (Google Fonts, carregadas sob demanda).
 * 8 → 34 em 06/10/2026 ("bem mais tipos de letra"), agrupadas pro seletor.
 * As 8 primeiras são as originais — assinatura já salva continua valendo.
 */
export const FONTES_ASSINATURA = [
  { id: "Great Vibes", nome: "Great Vibes", grupo: "Elegante" },
  { id: "Dancing Script", nome: "Dancing Script", grupo: "Manuscrita" },
  { id: "Allura", nome: "Allura", grupo: "Elegante" },
  { id: "Alex Brush", nome: "Alex Brush", grupo: "Elegante" },
  { id: "Sacramento", nome: "Sacramento", grupo: "Fina" },
  { id: "Pinyon Script", nome: "Pinyon Script", grupo: "Elegante" },
  { id: "Parisienne", nome: "Parisienne", grupo: "Elegante" },
  { id: "Caveat", nome: "Caveat", grupo: "Manuscrita" },
  { id: "Mr Dafoe", nome: "Mr Dafoe", grupo: "Rubrica" },
  { id: "Herr Von Muellerhoff", nome: "Herr Von Muellerhoff", grupo: "Rubrica" },
  { id: "Mrs Saint Delafield", nome: "Mrs Saint Delafield", grupo: "Rubrica" },
  { id: "Mr De Haviland", nome: "Mr De Haviland", grupo: "Rubrica" },
  { id: "Monsieur La Doulaise", nome: "Monsieur La Doulaise", grupo: "Rubrica" },
  { id: "Qwigley", nome: "Qwigley", grupo: "Rubrica" },
  { id: "Meddon", nome: "Meddon", grupo: "Manuscrita" },
  { id: "Homemade Apple", nome: "Homemade Apple", grupo: "Manuscrita" },
  { id: "La Belle Aurore", nome: "La Belle Aurore", grupo: "Manuscrita" },
  { id: "Cedarville Cursive", nome: "Cedarville Cursive", grupo: "Manuscrita" },
  { id: "Nothing You Could Do", nome: "Nothing You Could Do", grupo: "Manuscrita" },
  { id: "Zeyada", nome: "Zeyada", grupo: "Manuscrita" },
  { id: "Kristi", nome: "Kristi", grupo: "Fina" },
  { id: "Tangerine", nome: "Tangerine", grupo: "Fina" },
  { id: "Italianno", nome: "Italianno", grupo: "Fina" },
  { id: "WindSong", nome: "WindSong", grupo: "Fina" },
  { id: "Birthstone", nome: "Birthstone", grupo: "Fina" },
  { id: "Rouge Script", nome: "Rouge Script", grupo: "Elegante" },
  { id: "Petit Formal Script", nome: "Petit Formal Script", grupo: "Elegante" },
  { id: "Arizonia", nome: "Arizonia", grupo: "Elegante" },
  { id: "Satisfy", nome: "Satisfy", grupo: "Marcante" },
  { id: "Yellowtail", nome: "Yellowtail", grupo: "Marcante" },
  { id: "Cookie", nome: "Cookie", grupo: "Marcante" },
  { id: "Kaushan Script", nome: "Kaushan Script", grupo: "Marcante" },
  { id: "Marck Script", nome: "Marck Script", grupo: "Marcante" },
  { id: "Bad Script", nome: "Bad Script", grupo: "Marcante" },
] as const;

export const GRUPOS_FONTE = ["Todas", "Elegante", "Rubrica", "Manuscrita", "Fina", "Marcante"] as const;

/** Tamanho da letra escrita: multiplicador (CHECK 0,6–1,4 no banco, mig 20261006000002). */
export const TAMANHO_MIN = 0.6, TAMANHO_MAX = 1.4;

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
export function assinaturaValeParaPublicar(a: { cargo?: string | null; registro?: string | null } | null | undefined): boolean {
  if (!a) return false;
  const cargo = (a.cargo ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return /tec.*seguranc/.test(cargo) && (a.registro ?? "").trim().length >= 2;
}

/**
 * Certificado SEM assinatura (08/10/2026). Pedido do Pablo: "tira a
 * obrigatoriedade de assinatura nos certificados, mas deixa um aviso: TEM
 * CERTEZA QUE DESEJA DISPONIBILIZAR O CERTIFICADO SEM ASSINATURA?". A
 * obrigatoriedade já tinha saído (mig 20261007000002); o aviso aparece no
 * MOMENTO em que o curso passa a liberar certificado sem assinatura —
 * publicado, com modelo de certificado e sem assinatura — e não a cada
 * salvar de um curso que já estava assim.
 */
export type SituacaoCertificado = { publicado: boolean; certificado_modelo_id: string | null | undefined; assinatura_id: string | null | undefined };
export const liberaCertificadoSemAssinatura = (c: SituacaoCertificado | null | undefined) =>
  !!c && c.publicado && !!c.certificado_modelo_id && !c.assinatura_id;
export const pedeConfirmacaoSemAssinatura = (antes: SituacaoCertificado | null | undefined, depois: SituacaoCertificado) =>
  liberaCertificadoSemAssinatura(depois) && !liberaCertificadoSemAssinatura(antes);

/** A pergunta (o texto pedido, como foi pedido). Confirmar = segue; cancelar = não salva. */
export function ConfirmarSemAssinatura({ aberto, onConfirmar, onCancelar }: { aberto: boolean; onConfirmar: () => void; onCancelar: () => void }) {
  return (
    <AlertDialog open={aberto} onOpenChange={(o) => { if (!o) onCancelar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>TEM CERTEZA QUE DESEJA DISPONIBILIZAR O CERTIFICADO SEM ASSINATURA?</AlertDialogTitle>
          <AlertDialogDescription>
            Este curso emite certificado e não tem assinatura: quem concluir recebe o certificado sem o "Assinado digitalmente por".
            Para assinar, use "Adicionar assinatura" (Técnico(a) em Segurança, com cargo e registro).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelar}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmar}>Sim, disponibilizar sem assinatura</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
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
    const t = a.tamanho == null ? 1 : Number(a.tamanho);
    if (!(t >= TAMANHO_MIN && t <= TAMANHO_MAX)) return "Tamanho da letra fora do permitido.";
    return null;
  }
  return "Escolha desenhar ou escrever a assinatura.";
}

/**
 * Só o traço: a imagem desenhada ou o texto na fonte escolhida. `altura`
 * em qualquer unidade CSS — na folha usa cqw, na tela px.
 *
 * "Alguns formatos estão saindo pra fora" (06/10/2026): letras largas
 * (Mrs Saint Delafield, Homemade Apple…) com nome comprido passavam da
 * largura do bloco e eram cortadas. Agora o texto mede a si mesmo e
 * ENCOLHE para caber (transform, não font-size, para a medida não mudar
 * junto), remedindo quando a fonte termina de carregar ou o bloco muda de
 * tamanho. Na vertical não corta mais — floreio de letra cursiva passa da
 * linha de base de propósito.
 */
export function AssinaturaTraco({ a, altura, cor = "#1e293b" }: { a: AssinaturaCertificado; altura: string; cor?: string }) {
  useFontesAssinatura();
  const caixa = useRef<HTMLDivElement>(null);
  const linha = useRef<HTMLSpanElement>(null);
  const [encolher, setEncolher] = useState(1);
  const ehTexto = a.tipo === "texto";
  const tamanho = Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, Number(a.tamanho) || 1));

  useLayoutEffect(() => {
    if (!ehTexto) return;
    const ajustar = () => {
      const c = caixa.current, l = linha.current;
      if (!c || !l) return;
      const cabe = c.clientWidth, precisa = l.scrollWidth;
      setEncolher(cabe > 0 && precisa > cabe ? cabe / precisa : 1);
    };
    ajustar();
    const fontes = (document as Document & { fonts?: FontFaceSet }).fonts;
    fontes?.ready.then(ajustar);
    fontes?.addEventListener?.("loadingdone", ajustar);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ajustar) : null;
    if (caixa.current) ro?.observe(caixa.current);
    return () => { ro?.disconnect(); fontes?.removeEventListener?.("loadingdone", ajustar); };
  }, [ehTexto, a.texto, a.fonte, tamanho, altura]);

  if (!ehTexto) {
    return a.imagem
      ? <img src={a.imagem} alt={`Assinatura de ${a.nome_completo}`} style={{ display: "block", margin: "0 auto", height: altura, maxWidth: "100%", objectFit: "contain" }} />
      : <div style={{ height: altura }} />;
  }
  const estiloCaixa: CSSProperties = {
    width: "100%", height: altura, display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible",
  };
  const estiloLinha: CSSProperties = {
    fontFamily: `'${a.fonte ?? "Great Vibes"}', cursive`, fontSize: `calc(${altura} * ${(0.72 * tamanho).toFixed(3)})`,
    lineHeight: 1, color: cor, whiteSpace: "nowrap", display: "inline-block", flexShrink: 0,
    transform: encolher < 1 ? `scale(${encolher})` : undefined, transformOrigin: "center",
    // Folga para a última letra cursiva (que costuma ter cauda) não ficar fora da medida.
    paddingInline: "0.08em",
  };
  return <div ref={caixa} style={estiloCaixa}><span ref={linha} style={estiloLinha}>{a.texto}</span></div>;
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
