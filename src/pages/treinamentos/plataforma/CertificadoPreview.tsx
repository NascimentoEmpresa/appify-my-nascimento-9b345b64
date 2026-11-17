import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import logoNascimento from "@/assets/logo-nascimento-completo.webp";
import fundoNascimento from "@/assets/certificado-fundo-nascimento.png";
import fundoSN from "@/assets/certificado-fundo-sn.png";
import fundoNH from "@/assets/certificado-fundo-nh.png";
import { arteDaEmpresa, type AssinaturaColaborador } from "@/lib/treinamentos/certificadoColaborador";
import type { AssinaturaCertificado, CertificadoModelo } from "./tipos";
import { AssinaturaTraco, BlocoAssinatura } from "./assinaturaFolha";

// =====================================================================
// A folha do certificado — usada na prévia do editor de modelo e na
// visualização/impressão do certificado emitido. Substitui ${curso} e
// ${data} nos textos, como o membox.
//
// Layout (set/2026): folha branca, texto em sans-serif, QR de validação
// real no rodapé e "Grupo Nascimento" como assinatura à direita.
//
// Fundos: `fundo_path` guarda OU o path de uma imagem enviada (storage do
// Treinamentos) OU `preset:<id>` de um dos fundos prontos desenhados aqui
// em SVG (FUNDOS_PRONTOS). NULL = o padrão — até 13/11/2026 o arco
// Nascimento, desde então o modelo da empresa (ver abaixo); quem quiser o
// arco escolhe "Nascimento (antigo)". A coluna é text livre.
//
// Assinatura (05/10/2026, mig 20261005000003): quando o certificado foi
// emitido com assinatura, o rodapé ganha à direita o bloco "ASSINADO
// DIGITALMENTE POR:" + nome do treinador, e "Grupo Nascimento" vai pro meio.
//
// Tamanhos em `cqw` (relativos à largura da folha): a arte fica igual na
// prévia pequena do editor, na tela do colaborador e na impressão A4.
//
// Modelo da empresa (13/11/2026, mig 20261115000200): `preset:empresa` é a
// arte dos pptx "Certificado Nascimento" e "Certificado SN" que o Pablo
// mandou como padrão dos cursos — a folha escolhe a arte pela empresa do
// colaborador (arteDaEmpresa) e traz DUAS linhas de assinatura: a da
// técnica à esquerda e a do colaborador à direita. O colaborador assina
// antes de abrir o certificado (lib/treinamentos/certificadoColaborador).
// =====================================================================

export interface DadosCertificado {
  aluno: string; documento?: string | null; curso: string; data: string;
  cargaHorariaMin?: number | null; codigo: string;
  modulos?: { nome: string; aulas: string[] }[];
  assinatura?: AssinaturaCertificado | null;
  /** Assinatura do próprio colaborador (cópia gravada no certificado). */
  assinaturaAluno?: AssinaturaColaborador | null;
  /** Empresa do colaborador na emissão (HAGG, SN, NH…) — escolhe a arte do modelo da empresa. */
  empresa?: string | null;
}

/** "30 de Setembro de 2026" — mês com inicial maiúscula, como no modelo. */
export const dataCertificado = (d: Date | string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })
    .replace(/ de (\p{L})/u, (_, l: string) => ` de ${l.toUpperCase()}`);

const troca = (t: string | null | undefined, d: DadosCertificado) =>
  (t ?? "").replace(/\$\{curso\}/g, d.curso).replace(/\$\{data\}/g, d.data);

// ---------------------------------------------------------------------
// Fundos prontos
// ---------------------------------------------------------------------

export const FUNDOS_PRONTOS = [
  { id: "empresa", nome: "Modelo da empresa (Nascimento / SN / NH)" },
  { id: "nascimento", nome: "Nascimento (antigo)" },
  { id: "faixa", nome: "Faixa escura" },
  { id: "fita", nome: "Fita dourada" },
  { id: "geometrico", nome: "Geométrico" },
  { id: "dourado", nome: "Moldura dourada" },
  { id: "creme", nome: "Clássico creme" },
] as const;
export type FundoPronto = (typeof FUNDOS_PRONTOS)[number]["id"];

export const PREFIXO_PRESET = "preset:";

/** Traduz o valor gravado em `fundo_path` para preset ou URL de imagem. */
export function resolverFundo(path: string | null | undefined): { preset: FundoPronto | null; url: string | null } {
  // NULL = padrão: desde 13/11/2026 é o modelo da empresa (antes, o arco Nascimento).
  if (!path) return { preset: "empresa", url: null };
  if (path.startsWith(PREFIXO_PRESET)) {
    const id = path.slice(PREFIXO_PRESET.length) as FundoPronto;
    return { preset: FUNDOS_PRONTOS.some((f) => f.id === id) ? id : "nascimento", url: null };
  }
  return { preset: null, url: urlMidia(path) };
}

const COR_FUNDO: Record<FundoPronto, string> = {
  empresa: "#ffffff", nascimento: "#ffffff", faixa: "#f7f7f5", fita: "#ffffff", geometrico: "#ffffff", dourado: "#ffffff", creme: "#faf6ee",
};

/** Canto ornamental (curvas) desenhado no canto superior esquerdo; os outros são espelhados. */
const Ornamento = ({ cor, largura }: { cor: string; largura: number }) => (
  <g fill="none" stroke={cor} strokeWidth={largura} strokeLinecap="round">
    <path d="M14 34 C14 22 22 14 34 14" />
    <path d="M18 30 C20 24 24 20 30 18" />
    <path d="M14 34 C10 30 10 26 14 24 C17 22 20 25 18 28" />
    <path d="M34 14 C30 10 26 10 24 14 C22 17 25 20 28 18" />
    <circle cx="22" cy="22" r="1.4" fill={cor} />
  </g>
);
const cantos = (el: ReactNode) => (
  <>
    <g>{el}</g>
    <g transform="translate(297 0) scale(-1 1)">{el}</g>
    <g transform="translate(0 210) scale(1 -1)">{el}</g>
    <g transform="translate(297 210) scale(-1 -1)">{el}</g>
  </>
);

/** Desenho do fundo pronto, em coordenadas A4 paisagem (297 × 210). */
function ArteFundo({ preset, lado }: { preset: FundoPronto; lado: "frente" | "verso" }) {
  let arte: ReactNode = null;
  switch (preset) {
    case "nascimento":
      // O verso do modelo Nascimento é liso: o arco competiria com a lista de aulas.
      arte = lado === "frente" && (
        <g fill="#f1f1f2">
          <path d="M0 110 H26 V210 H0 Z" />
          <circle cx="166" cy="258" r="158" fill="none" stroke="#f1f1f2" strokeWidth="30" />
        </g>
      );
      break;
    case "faixa":
      arte = (
        <g>
          <rect x="0" y="0" width="7" height="210" fill="#1c1a2e" />
          <path d="M287 8 V22" stroke="#9ca3af" strokeWidth=".6" />
          <path d="M275 202 H287 V190" fill="none" stroke="#9ca3af" strokeWidth=".6" />
        </g>
      );
      break;
    case "fita":
      arte = (
        <g>
          <defs>
            <pattern id="cert-losango" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M4 0 L8 4 L4 8 L0 4 Z" fill="none" stroke="#e7e2d3" strokeWidth=".25" />
            </pattern>
          </defs>
          <rect x="6" y="6" width="285" height="198" fill="url(#cert-losango)" stroke="#efe6c9" strokeWidth=".6" />
          <path d="M252 0 H266 V64 L259 57 L252 64 Z" fill="#fcd97a" />
          <path d="M254 0 V60" stroke="#f6c453" strokeWidth=".5" />
        </g>
      );
      break;
    case "geometrico":
      arte = (
        <g>
          <rect x="3" y="3" width="291" height="204" fill="none" stroke="#a1a1aa" strokeWidth="4" />
          <path d="M0 0 H46 L0 46 Z" fill="#71717a" />
          <path d="M0 0 H30 L0 30 Z" fill="#3f3f46" />
          <path d="M40 8 L48 16 L40 24 L32 16 Z" fill="#a1a1aa" />
          <path d="M297 210 H251 L297 164 Z" fill="#71717a" />
          <path d="M297 210 H267 L297 180 Z" fill="#3f3f46" />
          <path d="M257 186 L265 194 L257 202 L249 194 Z" fill="#a1a1aa" />
          <path d="M240 202 L247 195 L254 202 Z" fill="#52525b" />
        </g>
      );
      break;
    case "dourado":
      arte = (
        <g>
          <rect x="8" y="8" width="281" height="194" fill="none" stroke="#c9a44c" strokeWidth="2" />
          <rect x="12" y="12" width="273" height="186" fill="none" stroke="#c9a44c" strokeWidth=".6" />
          {cantos(<Ornamento cor="#c9a44c" largura={0.8} />)}
          <path d="M138 12 Q148.5 20 159 12 M138 198 Q148.5 190 159 198" fill="none" stroke="#c9a44c" strokeWidth=".8" />
        </g>
      );
      break;
    case "creme":
      arte = (
        <g>
          <rect x="10" y="10" width="277" height="190" fill="none" stroke="#3f3f46" strokeWidth=".7" strokeDasharray=".6 1.6" strokeLinecap="round" />
          {cantos(<Ornamento cor="#27272a" largura={0.9} />)}
        </g>
      );
      break;
  }
  return (
    <svg viewBox="0 0 297 210" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
      {arte}
    </svg>
  );
}

/** Miniatura do fundo (galeria do editor e lista de modelos). */
export function FundoMiniatura({ path, lado = "frente" }: { path: string | null | undefined; lado?: "frente" | "verso" }) {
  const { preset, url } = resolverFundo(path);
  if (preset === "empresa" && lado === "frente") {
    // As três artes lado a lado: qual sai depende da empresa do colaborador.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, width: "100%", aspectRatio: "297/210", background: "#fff" }}>
        {[fundoNascimento, fundoSN, fundoNH].map((src) => <img key={src} src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />)}
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "297/210", overflow: "hidden", background: url ? `url(${url}) center/cover no-repeat` : COR_FUNDO[preset!] }}>
      {preset && <ArteFundo preset={preset} lado={lado} />}
      {preset === "nascimento" && lado === "frente" && <img src={logoNascimento} alt="" style={{ position: "absolute", top: "7%", right: "5%", width: "18%" }} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Folha
// ---------------------------------------------------------------------

const COR_TEXTO = "#3f3f46";

function QrValidacao({ codigo }: { codigo: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(codigo, { width: 256, margin: 0, errorCorrectionLevel: "M" }).then((u) => vivo && setSrc(u)).catch(() => vivo && setSrc(null));
    return () => { vivo = false; };
  }, [codigo]);
  return <div style={{ width: "6cqw", height: "6cqw", flexShrink: 0 }}>{src && <img src={src} alt="QR Code de validação" style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />}</div>;
}

function Folha({ modelo, lado, children }: { modelo: CertificadoModelo; lado: "frente" | "verso"; children: ReactNode }) {
  const { preset, url } = resolverFundo(lado === "verso" ? (modelo.fundo_verso_path ?? modelo.fundo_path) : modelo.fundo_path);
  const logo = lado === "frente" && (preset === "nascimento" || modelo.exibir_logo);
  return (
    <div className="trn-cert" style={{
      position: "relative", width: "100%", aspectRatio: "297/210", containerType: "inline-size",
      background: url ? `url(${url}) center/cover no-repeat` : COR_FUNDO[preset!],
      border: "1px solid #e4e4e7", borderRadius: 12, overflow: "hidden", color: COR_TEXTO,
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
    } as CSSProperties}>
      {preset && <ArteFundo preset={preset} lado={lado} />}
      {logo && <img src={logoNascimento} alt="Nascimento" style={{ position: "absolute", top: "6.5%", right: "4%", width: "18.5%" }} />}
      {children}
    </div>
  );
}

function Rodape({ modelo, dados, centro }: { modelo: CertificadoModelo; dados: DadosCertificado; centro: boolean }) {
  return (
    <div style={{ position: "absolute", left: centro ? "12%" : "16.5%", right: centro ? "12%" : "15%", bottom: dados.assinatura ? "11%" : "15.5%", display: "flex", alignItems: dados.assinatura ? "flex-end" : "center", justifyContent: "space-between", gap: "2cqw" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1cqw" }}>
        {modelo.exibir_qr && <QrValidacao codigo={dados.codigo} />}
        <div style={{ fontSize: ".85cqw", lineHeight: 1.5, color: "#8a90b4" }}>
          ID de validação:<br /><span style={{ letterSpacing: ".02em" }}>{dados.codigo}</span>
        </div>
      </div>
      {/* Modelos antigos: a assinatura do colaborador ocupa o meio (no lugar de "Grupo Nascimento"). */}
      {dados.assinaturaAluno ? <LinhaAssinatura traco={tracoAluno(dados)} nome={dados.aluno} papel="Colaborador" largura={22} /> : (modelo.exibir_nome_negocio || modelo.exibir_cnpj) && (
        <div style={{ fontSize: ".95cqw", textAlign: "center", color: "#27272a" }}>
          {modelo.exibir_nome_negocio && <div>Grupo Nascimento</div>}
          {modelo.exibir_cnpj && <div style={{ color: "#71717a" }}>CNPJ: —</div>}
        </div>
      )}
      {dados.assinatura && <BlocoAssinatura a={dados.assinatura} />}
    </div>
  );
}

/** A assinatura do colaborador no formato que AssinaturaTraco desenha. */
const tracoAluno = (d: DadosCertificado): AssinaturaCertificado => ({
  nome_completo: d.aluno, cargo: null, registro: null,
  tipo: d.assinaturaAluno?.tipo ?? "texto", imagem: d.assinaturaAluno?.imagem ?? null,
  texto: d.assinaturaAluno?.texto ?? null, fonte: d.assinaturaAluno?.fonte ?? null, tamanho: d.assinaturaAluno?.tamanho ?? 1,
});

/** Traço + linha + nome + papel, como as duas caixas do rodapé dos pptx. */
function LinhaAssinatura({ traco, nome, papel, extra, largura = 28 }: { traco: AssinaturaCertificado | null; nome: string; papel: string | null; extra?: string | null; largura?: number }) {
  return (
    <div style={{ width: `${largura}cqw`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", color: "#27272a" }}>
      {traco ? <AssinaturaTraco a={traco} altura="4.6cqw" /> : <div style={{ height: "4.6cqw" }} />}
      <div style={{ width: "82%", borderTop: "1px solid #3f3f46", marginTop: ".3cqw" }} />
      <div style={{ fontSize: "1.45cqw", marginTop: ".5cqw", lineHeight: 1.2 }}>{nome}</div>
      {papel && <div style={{ fontSize: "1.3cqw", marginTop: ".2cqw", lineHeight: 1.2 }}>{papel}</div>}
      {extra && <div style={{ fontSize: ".95cqw", marginTop: ".15cqw", color: "#71717a" }}>{extra}</div>}
    </div>
  );
}

const horasTexto = (min: number | null | undefined) =>
  min != null && min > 0 ? `${(Math.round(min / 60 * 10) / 10).toLocaleString("pt-BR")} ${min === 60 ? "hora" : "horas"}` : null;

/**
 * Modelo da empresa — pptx "Certificado Nascimento" / "Certificado SN" /
 * "Certificado_NH" (16/11/2026 — mesmas posições, só o fundo muda)
 * (slide 297 × 210 mm). Posições tiradas do próprio pptx: texto a 33,7% do
 * topo, caixas de assinatura a 75% (técnica em 6,7% da largura, colaborador
 * em 65,2%) e a caixa do meio, vazia no pptx, leva o QR de validação.
 */
function CertificadoEmpresa({ modelo, dados }: { modelo: CertificadoModelo; dados: DadosCertificado }) {
  const fundo = { sn: fundoSN, nh: fundoNH, nascimento: fundoNascimento }[arteDaEmpresa(dados.empresa)];
  const horas = modelo.exibir_carga_horaria ? horasTexto(dados.cargaHorariaMin) : null;
  const t = dados.assinatura;
  return (
    <div className="trn-cert" style={{
      position: "relative", width: "100%", aspectRatio: "297/210", containerType: "inline-size",
      background: `#fff url(${fundo}) center/100% 100% no-repeat`,
      border: "1px solid #e4e4e7", borderRadius: 12, overflow: "hidden", color: "#000",
      fontFamily: "Arial, Inter, ui-sans-serif, system-ui, sans-serif",
      WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
    } as CSSProperties}>
      <div style={{ position: "absolute", top: "33.7%", left: "4.5%", right: "4.5%", textAlign: "center", fontSize: "1.9cqw", lineHeight: 1.15 }}>
        <div>Certificamos que</div>
        <div style={{ fontSize: "2.85cqw", fontWeight: 700, marginTop: "2.2cqw", textTransform: "uppercase" }}>{dados.aluno}</div>
        {modelo.exibir_documento && dados.documento && <div style={{ fontSize: "1.3cqw", marginTop: ".6cqw" }}>CPF: {dados.documento}</div>}
        <div style={{ marginTop: "2.2cqw", lineHeight: 1.5 }}>concluiu o curso de aperfeiçoamento de <b>{dados.curso},</b></div>
        <div style={{ lineHeight: 1.5 }}>
          {horas && <>com total de <b>{horas}</b>, </>}no dia <b>{dados.data}.</b>
        </div>
      </div>
      <div style={{ position: "absolute", top: "75.2%", left: "6.7%", width: "28%", display: "flex", justifyContent: "center" }}>
        {t && <LinhaAssinatura traco={t} nome={t.nome_completo} papel={t.cargo} extra={t.registro ? `Registro: ${t.registro}` : null} />}
      </div>
      <div style={{ position: "absolute", top: "78%", left: "36%", width: "28%", display: "flex", alignItems: "center", justifyContent: "center", gap: "1cqw" }}>
        {modelo.exibir_qr && <QrValidacao codigo={dados.codigo} />}
        <div style={{ fontSize: ".85cqw", lineHeight: 1.5, color: "#6b7280" }}>ID de validação:<br /><span style={{ letterSpacing: ".02em" }}>{dados.codigo}</span></div>
      </div>
      <div style={{ position: "absolute", top: "75.2%", left: "65.2%", width: "28%", display: "flex", justifyContent: "center" }}>
        <LinhaAssinatura traco={dados.assinaturaAluno ? tracoAluno(dados) : null} nome={dados.aluno} papel="Colaborador" />
      </div>
    </div>
  );
}

export function CertificadoFrente({ modelo, dados }: { modelo: CertificadoModelo; dados: DadosCertificado }) {
  if (resolverFundo(modelo.fundo_path).preset === "empresa") return <CertificadoEmpresa modelo={modelo} dados={dados} />;
  const centro = modelo.layout === "centro";
  const horas = dados.cargaHorariaMin != null && dados.cargaHorariaMin > 0 ? Math.round(dados.cargaHorariaMin / 60 * 10) / 10 : null;
  return (
    <Folha modelo={modelo} lado="frente">
      <div style={{ position: "absolute", top: "21.5%", left: centro ? "12%" : "16.5%", right: centro ? "12%" : "24%", textAlign: centro ? "center" : "left" }}>
        <div style={{ fontSize: "2cqw", fontWeight: 500 }}>{modelo.titulo}</div>
        {modelo.texto_superior && <div style={{ fontSize: "1.2cqw", marginTop: "2.6cqw" }}>{troca(modelo.texto_superior, dados)}</div>}
        <div style={{ fontSize: "3.1cqw", fontWeight: 700, marginTop: "2.2cqw", lineHeight: 1.15 }}>{dados.aluno}</div>
        {modelo.exibir_documento && dados.documento && <div style={{ fontSize: "1.2cqw", marginTop: "2.6cqw" }}>CPF: {dados.documento}</div>}
        {modelo.texto_inferior && <div style={{ fontSize: "1.2cqw", marginTop: "2.6cqw" }}>{troca(modelo.texto_inferior, dados)}</div>}
        {modelo.exibir_carga_horaria && horas != null && (
          <div style={{ fontSize: "1.1cqw", marginTop: "2.6cqw", color: "#3b3f73" }}>Carga horária: {horas} horas</div>
        )}
      </div>
      <Rodape modelo={modelo} dados={dados} centro={centro} />
    </Folha>
  );
}

export function CertificadoVerso({ modelo, dados }: { modelo: CertificadoModelo; dados: DadosCertificado }) {
  const centro = modelo.layout === "centro";
  return (
    <Folha modelo={modelo} lado="verso">
      <div style={{ position: "absolute", top: "21.5%", bottom: "29%", left: centro ? "12%" : "16.5%", right: centro ? "12%" : "15%", overflow: "hidden", textAlign: centro ? "center" : "left" }}>
        <div style={{ fontSize: "2cqw", fontWeight: 500 }}>{modelo.verso_titulo || "Conteúdo programático"}</div>
        <div style={{ fontSize: "1.8cqw", fontWeight: 500, color: "#1e1b4b", marginTop: "3.4cqw" }}>{dados.curso}</div>
        <div style={{ marginTop: "1.6cqw", columns: (dados.modulos?.length ?? 0) > 4 ? 2 : 1, columnGap: "3cqw" }}>
          {(dados.modulos ?? []).map((m, i) => (
            <div key={i} style={{ breakInside: "avoid", marginBottom: "1cqw" }}>
              <div style={{ fontSize: "1.45cqw", fontWeight: 700 }}>Módulo {i + 1} - {m.nome}</div>
              {!modelo.verso_somente_modulos && m.aulas.map((a, k) => (
                <div key={k} style={{ fontSize: "1.4cqw", marginTop: ".9cqw", paddingLeft: centro ? 0 : "1.6cqw" }}>✓ Aula {k + 1} - {a}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Rodape modelo={modelo} dados={dados} centro={centro} />
    </Folha>
  );
}

export const EXEMPLO: DadosCertificado = {
  aluno: "Nome do aluno", documento: "XXX.XXX.XXX-XX", curso: "NOME_EXEMPLO",
  data: dataCertificado(new Date()),
  cargaHorariaMin: 1800, codigo: "ABC789GHTD445S0",
  modulos: [{ nome: "Introdução", aulas: ["Conceitos básicos", "Primeiros passos"] }, { nome: "Desenvolvimento", aulas: ["Conceitos avançados", "Projeto prático"] }],
  assinatura: { nome_completo: "Nome da Técnica", cargo: "Técnica em Segurança do Trabalho", registro: "0000000", tipo: "texto", imagem: null, texto: "Nome da Técnica", fonte: "Great Vibes", tamanho: 1 },
  assinaturaAluno: { tipo: "texto", texto: "Nome do aluno", fonte: "Dancing Script", tamanho: 1 },
  empresa: "HAGG",
};
