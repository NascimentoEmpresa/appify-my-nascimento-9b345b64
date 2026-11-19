// Jurídico / Patrimônio — "Importar demonstrativo (PDF)" da aba Parcelas
// (SIS-2026-0939, 18/11/2026). Lê o Documento Descritivo do Crédito da
// CAIXA no navegador, mostra a PRÉVIA (novas, iguais, complementa,
// divergentes, eventos) e só grava depois do clique, com as divergências que
// o usuário aceitou. A conta toda está em ./demonstrativoCaixa.ts (testada).
//
// O que a gravação toca (e nada além):
//   • JUR_PATRIMONIO_FINANCIAMENTOS — condições do contrato (cria ou atualiza);
//   • JUR_PATRIMONIO_PARCELAS — um INSERT das novas e um UPSERT por id das
//     existentes (cada um é uma requisição = uma transação no PostgREST).
//     Só as colunas da composição: pagamentos registrados, comprovantes,
//     demonstrativos anexados e situação da planilha ficam como estão;
//   • JUR_PATRIMONIO_ITENS — os eventos no histórico (sem repetir) e, se
//     marcado, o PDF em Documentos.
// Nenhuma conta a pagar, baixa ou lançamento no Malote/Contas.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerTextoDoPdf } from "./lerPdfTexto";
import {
  lerDemonstrativoCaixa, planejarDemonstrativo, parcelasDoContrato, financiamentoDestino, montarGravacao,
  compararContrato, payloadDoContrato, itensDeEventos, lerItemEvento, chaveDecisao, chavesDivergentes,
  chaveEvento, ROTULO_CAMPO_CAIXA, TIPO_ITEM_EVENTO,
  type DemonstrativoCaixa, type FinanciamentoCadastro, type ParcelaComparada, type StatusParcela,
} from "./demonstrativoCaixa";
import type { ParcelaFinanciamento } from "./financiamento";

interface Props {
  db: SupabaseClient;
  patrimonioId: number;
  fins: FinanciamentoCadastro[];
  /** Parcelas CRUAS do imóvel (sem a baixa das contas). */
  brutas: ParcelaFinanciamento[];
  autor: string;
  toast: (msg: string, t?: string) => void;
  logHist: (acao: string, detalhe?: string) => Promise<void>;
  subirArquivo: (file: File, pasta: string) => Promise<string | null>;
  fechar: () => void;
  /** Depois de gravar: recarrega parcelas/contratos e seleciona o contrato. */
  aoConcluir: (financiamentoId: number) => Promise<void>;
}

const COR = { azul: "#0f3171", verde: "#15803d", laranja: "#ea580c", roxo: "#6d28d9", cinza: "#64748b", claro: "#94a3b8", borda: "#e2e8f0", texto: "#0f172a" };
const fmtDt = (s?: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const fmtValor = (campo: string, v: string | number | null) => {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDt(v) : v;
  if (campo === "indice_correcao") return v.toLocaleString("pt-BR", { minimumFractionDigits: 8, maximumFractionDigits: 8 });
  if (/aa$|percentual/.test(campo)) return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
  if (/prazo|cotas|parcelas_/.test(campo)) return String(v);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const ROTULO_STATUS: Record<StatusParcela, { t: string; fundo: string; cor: string }> = {
  nova: { t: "Nova", fundo: "#dcfce7", cor: COR.verde },
  igual: { t: "Igual", fundo: "#f1f5f9", cor: "#475569" },
  complementa: { t: "Complementa", fundo: "#e0f2fe", cor: "#0369a1" },
  divergente: { t: "Divergente", fundo: "#ede9fe", cor: COR.roxo },
};
const ROTULO_CLASSE = { paga: "Paga", vencida: "Vencida em aberto", futura: "Futura (prevista)" } as const;
const POR_PAGINA = 60;

export function ImportarDemonstrativoCaixa({ db, patrimonioId, fins, brutas, autor, toast, logHist, subirArquivo, fechar, aoConcluir }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [demo, setDemo] = useState<DemonstrativoCaixa | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  /** "" = criar contrato novo; senão o id do financiamento de destino. */
  const [destino, setDestino] = useState<string>("");
  const [aceitas, setAceitas] = useState<Set<string>>(new Set());
  const [eventosGravados, setEventosGravados] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<"" | StatusParcela>("");
  const [pagina, setPagina] = useState(0);
  const [aberta, setAberta] = useState<number | null>(null);
  const [guardarPdf, setGuardarPdf] = useState(true);
  const [gravando, setGravando] = useState(false);

  // Eventos já no histórico do imóvel (para não repetir).
  useEffect(() => {
    (async () => {
      const { data } = await db.from("JUR_PATRIMONIO_ITENS").select("observacao")
        .eq("patrimonio_id", patrimonioId).eq("kind", "historico").eq("tipo", TIPO_ITEM_EVENTO).limit(2000);
      setEventosGravados(new Set((data ?? []).map(d => lerItemEvento((d as { observacao?: string }).observacao)?.chave).filter((c): c is string => !!c)));
    })();
  }, [db, patrimonioId]);

  const ler = async (f: File) => {
    setArquivo(f); setDemo(null); setErroLeitura(null); setLendo(true); setAceitas(new Set()); setPagina(0); setAberta(null);
    try {
      const { texto } = await lerTextoDoPdf(f);
      if (!texto.trim()) throw new Error("O PDF não tem texto (é imagem escaneada). Use o PDF baixado do internet banking / enviado pela CAIXA.");
      const d = lerDemonstrativoCaixa(texto);
      if (!d.parcelas.length) throw new Error(d.avisos[0] ?? "Nenhuma parcela encontrada no layout do demonstrativo da CAIXA.");
      setDemo(d);
      const alvo = financiamentoDestino(fins, d.contrato.numero_contrato);
      setDestino(alvo ? String(alvo.id) : "");
    } catch (e) {
      setErroLeitura(e instanceof Error ? e.message : String(e));
    } finally { setLendo(false); }
  };

  const finDestino = fins.find(f => String(f.id) === destino) ?? null;
  const existentes = useMemo(() => {
    if (finDestino) return parcelasDoContrato(brutas, finDestino.id, finDestino.id === fins[0]?.id);
    // Contrato novo: só herda as parcelas sem contrato se o imóvel não tem
    // nenhum contrato (senão elas são do primeiro).
    return fins.length ? [] : parcelasDoContrato(brutas, null, true);
  }, [brutas, finDestino, fins]);
  const plano = useMemo(() => (demo ? planejarDemonstrativo(demo, existentes) : null), [demo, existentes]);
  const contrato = useMemo(() => (demo ? compararContrato(finDestino, demo.contrato) : []), [demo, finDestino]);
  const eventosNovos = useMemo(() => (demo ? demo.eventos.filter(ev => !eventosGravados.has(chaveEvento(demo.contrato.numero_contrato, ev))) : []), [demo, eventosGravados]);

  const todasDivergencias = useMemo(() => [
    ...(plano ? chavesDivergentes(plano.parcelas) : []),
    ...contrato.filter(c => c.tipo === "divergente").map(c => chaveDecisao(0, c.campo)),
  ], [plano, contrato]);
  const alternar = (chaves: string[], ligar: boolean) => setAceitas(prev => {
    const n = new Set(prev);
    for (const k of chaves) { if (ligar) n.add(k); else n.delete(k); }
    return n;
  });

  const lista = (plano?.parcelas ?? []).filter(p => !filtro || p.status === filtro);
  const visiveis = lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const aceitasCount = todasDivergencias.filter(k => aceitas.has(k)).length;

  const importar = async () => {
    if (!demo || !plano) return;
    setGravando(true);
    try {
      // 1) Contrato.
      const payloadFin = payloadDoContrato(contrato, aceitas, finDestino?.observacoes as string | null, demo.contrato, autor);
      let finId: number;
      if (finDestino) {
        const { error } = await db.from("JUR_PATRIMONIO_FINANCIAMENTOS").update(payloadFin).eq("id", finDestino.id);
        if (error) throw new Error("condições do contrato: " + error.message);
        finId = finDestino.id;
      } else {
        const { data, error } = await db.from("JUR_PATRIMONIO_FINANCIAMENTOS")
          .insert({ ...payloadFin, patrimonio_id: patrimonioId, criado_por: autor }).select("id").single();
        if (error) throw new Error("cadastro do contrato: " + error.message);
        finId = data.id as number;
      }

      // 2) Parcelas: um INSERT das novas e um UPSERT das existentes.
      const ordemInicial = Math.max(0, ...brutas.map(p => Number(p.ordem ?? 0)));
      const grav = montarGravacao(plano, aceitas, { patrimonioId, financiamentoId: finId, autor, documentoData: demo.contrato.data_referencia, ordemInicial });
      if (grav.inserir.length) {
        const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").insert(grav.inserir);
        if (error) throw new Error("parcelas novas: " + error.message);
      }
      if (grav.atualizar.length) {
        const { error } = await db.from("JUR_PATRIMONIO_PARCELAS").upsert(grav.atualizar, { onConflict: "id" });
        if (error) throw new Error(`parcelas existentes: ${error.message}${grav.inserir.length ? " (as novas já entraram; importar de novo completa sem duplicar)" : ""}`);
      }

      // 3) Eventos no histórico.
      const itens = itensDeEventos(demo.eventos, eventosGravados, { patrimonioId, financiamentoId: finId, numeroContrato: demo.contrato.numero_contrato, autor });
      if (itens.length) {
        const { error } = await db.from("JUR_PATRIMONIO_ITENS").insert(itens);
        if (error) throw new Error("eventos do histórico: " + error.message);
      }

      // 4) O PDF em Documentos do imóvel (opcional).
      if (guardarPdf && arquivo) {
        const path = await subirArquivo(arquivo, `${patrimonioId}/financiamento/demonstrativos`);
        if (path) await db.from("JUR_PATRIMONIO_ITENS").insert({ patrimonio_id: patrimonioId, kind: "documento", tipo: `Demonstrativo CAIXA — referência ${fmtDt(demo.contrato.data_referencia)}`, nome: arquivo.name, storage_path: path, criado_por: autor });
      }

      const c = plano.contagem;
      await logHist("Demonstrativo CAIXA importado (PDF)",
        `Contrato ${demo.contrato.numero_contrato ?? "—"} · referência ${fmtDt(demo.contrato.data_referencia)} · ${c.novas} nova(s), ${c.complementa} complementada(s), ${c.divergentes} com divergência (${aceitasCount} campo(s) aceito(s)), ${c.iguais} igual(is) · ${itens.length} evento(s) no histórico`);
      toast(`Demonstrativo importado: ${grav.inserir.length} parcela(s) nova(s), ${grav.atualizar.length} atualizada(s), ${itens.length} evento(s).`, "ok");
      await aoConcluir(finId);
      fechar();
    } catch (e) {
      toast("Erro ao importar — " + (e instanceof Error ? e.message : String(e)), "err");
    } finally { setGravando(false); }
  };

  const chip = (s: StatusParcela) => { const r = ROTULO_STATUS[s]; return <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: r.fundo, color: r.cor, whiteSpace: "nowrap" }}>{r.t}</span>; };
  const cartao = (rotulo: string, valor: number, cor: string, f?: "" | StatusParcela): JSX.Element => (
    <button type="button" className="jp-btn" onClick={() => { if (f !== undefined) { setFiltro(f); setPagina(0); } }}
      style={{ flex: 1, minWidth: 104, textAlign: "left", background: f !== undefined && filtro === f ? "#eef4ff" : "#fff", border: `1px solid ${COR.borda}`, borderRadius: 10, padding: "8px 10px", cursor: f !== undefined ? "pointer" : "default" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: COR.claro, textTransform: "uppercase" }}>{rotulo}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: cor }}>{valor}</div>
    </button>
  );
  const th: CSSProperties = { padding: "6px 8px", textAlign: "left", fontSize: 10.5, color: COR.claro, textTransform: "uppercase" };
  const td: CSSProperties = { padding: "6px 8px", borderTop: "1px solid #f1f5f9", fontSize: 12 };

  const linhaParcela = (p: ParcelaComparada) => {
    const div = p.campos.filter(x => x.tipo === "divergente");
    const chaves = div.map(x => chaveDecisao(p.numero, x.campo));
    const todasAceitas = chaves.length > 0 && chaves.every(k => aceitas.has(k));
    const ab = aberta === p.numero;
    return (
      <tbody key={p.numero}>
        <tr style={{ cursor: "pointer", background: ab ? "#f8fafc" : undefined }} onClick={() => setAberta(ab ? null : p.numero)}>
          <td style={{ ...td, fontWeight: 800 }}>{p.numero}ª</td>
          <td style={td}>{fmtDt(p.doc.vencimento)}</td>
          <td style={td}>{ROTULO_CLASSE[p.doc.classe]}{p.doc.data_pagamento ? ` em ${fmtDt(p.doc.data_pagamento)}` : ""}</td>
          <td style={{ ...td, textAlign: "right" }}>{fmtValor("valor", p.doc.valor)}</td>
          <td style={{ ...td, textAlign: "right" }}>{fmtValor("saldo_devedor", p.doc.saldo_devedor)}</td>
          <td style={td}>{chip(p.status)}{div.length > 0 && <span style={{ fontSize: 11, color: COR.roxo, marginLeft: 6 }}>{div.length} campo(s)</span>}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
            {div.length > 0 && <label style={{ fontSize: 11.5, color: COR.roxo, fontWeight: 700 }}>
              <input type="checkbox" checked={todasAceitas} onChange={e => alternar(chaves, e.target.checked)} /> aceitar a parcela</label>}
          </td>
        </tr>
        {ab && (
          <tr><td colSpan={7} style={{ padding: "4px 10px 10px", background: "#f8fafc" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Campo</th><th style={th}>No cadastro</th><th style={th}>No demonstrativo</th><th style={th}>O que acontece</th></tr></thead>
              <tbody>{p.campos.filter(x => x.novo != null || x.atual != null).map(x => {
                const k = chaveDecisao(p.numero, x.campo);
                return (
                  <tr key={x.campo} style={{ background: x.tipo === "divergente" ? "#faf5ff" : undefined }}>
                    <td style={td}>{ROTULO_CAMPO_CAIXA[x.campo]}</td>
                    <td style={{ ...td, color: x.atual == null ? COR.claro : COR.texto }}>{x.atual == null ? "Não informado" : fmtValor(x.campo, x.atual)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{x.novo == null ? "—" : fmtValor(x.campo, x.novo)}</td>
                    <td style={td}>
                      {x.tipo === "divergente"
                        ? <label style={{ color: COR.roxo, fontWeight: 700 }}><input type="checkbox" checked={aceitas.has(k)} onChange={e => alternar([k], e.target.checked)} /> {aceitas.has(k) ? "substituir pelo demonstrativo" : "manter o do cadastro"}</label>
                        : x.tipo === "novo" ? <span style={{ color: COR.verde }}>{p.existente ? "complementa (campo vazio)" : "grava"}</span>
                        : x.novo == null ? <span style={{ color: COR.claro }}>não muda{p.doc.classe !== "paga" && (x.campo === "valor_pago" || x.campo === "data_pagamento" || x.campo === "diferenca_valor") ? " (parcela não paga)" : ""}</span>
                        : <span style={{ color: COR.claro }}>igual</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </td></tr>
        )}
      </tbody>
    );
  };

  return (
    <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget && !gravando) fechar(); }}>
      <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1000, width: "96vw" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COR.texto, marginBottom: 4 }}>Importar demonstrativo da CAIXA (PDF)</div>
        <div style={{ fontSize: 12, color: COR.cinza, marginBottom: 10, lineHeight: 1.5 }}>
          Escolha o “Documento Descritivo do Crédito” da CAIXA em PDF. O sistema lê as parcelas, os dados do contrato e os eventos,
          e mostra o que vai mudar antes de gravar. A parcela é casada pelo contrato e pelo número — nada é duplicado.
          Campo vazio é completado; campo preenchido com valor diferente só é trocado se você aceitar.
          Pagamentos registrados, comprovantes e anexos não são alterados, e nada é lançado em Contas ou no Malote.
        </div>
        <input type="file" accept="application/pdf,.pdf" disabled={lendo || gravando} onChange={e => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }} />
        {lendo && <div style={{ fontSize: 12.5, color: COR.azul, marginTop: 8 }}>Lendo o PDF…</div>}
        {erroLeitura && <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 8, fontWeight: 700 }}>{erroLeitura}</div>}

        {demo && plano && (<>
          {/* Contrato */}
          <div style={{ marginTop: 12, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, color: COR.texto }}>Contrato {demo.contrato.numero_contrato ?? "—"}</div>
              <div style={{ fontSize: 12, color: COR.cinza }}>{demo.contrato.credor ?? ""} · referência {fmtDt(demo.contrato.data_referencia)} · {demo.parcelas.length} parcela(s) · {demo.eventos.length} evento(s)</div>
              <label style={{ marginLeft: "auto", fontSize: 12.5, color: "#475569" }}>Gravar no contrato:{" "}
                <select className="jp-fi" style={{ width: "auto", display: "inline-block", height: 30 }} value={destino} onChange={e => { setDestino(e.target.value); setAceitas(new Set()); }}>
                  {fins.map(f => <option key={f.id} value={f.id}>{f.nome || `Contrato ${f.id}`}</option>)}
                  <option value="">Cadastrar contrato novo</option>
                </select>
              </label>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead><tr><th style={th}>Dado do contrato</th><th style={th}>No cadastro</th><th style={th}>No demonstrativo</th><th style={th}>O que acontece</th></tr></thead>
              <tbody>{contrato.filter(c => c.novo != null).map(c => {
                const k = chaveDecisao(0, c.campo);
                return (
                  <tr key={c.campo} style={{ background: c.tipo === "divergente" ? "#faf5ff" : undefined }}>
                    <td style={td}>{c.rotulo}</td>
                    <td style={{ ...td, color: c.atual == null ? COR.claro : COR.texto }}>{c.atual == null ? "Não informado" : fmtValor(c.campo, c.atual)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtValor(c.campo, c.novo)}</td>
                    <td style={td}>{c.tipo === "divergente"
                      ? <label style={{ color: COR.roxo, fontWeight: 700 }}><input type="checkbox" checked={aceitas.has(k)} onChange={e => alternar([k], e.target.checked)} /> {aceitas.has(k) ? "substituir" : "manter o do cadastro"}</label>
                      : c.tipo === "novo" ? <span style={{ color: COR.verde }}>grava</span> : <span style={{ color: COR.claro }}>igual</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <div style={{ fontSize: 11.5, color: COR.claro, marginTop: 6 }}>
              Agência, devedor, sistema por extenso, prazo remanescente e vencimento da última parcela ficam nas observações do contrato (o bloco é trocado a cada importação).
            </div>
          </div>

          {/* Contagem */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {cartao("Todas", plano.parcelas.length, COR.texto, "")}
            {cartao("Novas", plano.contagem.novas, COR.verde, "nova")}
            {cartao("Complementa", plano.contagem.complementa, "#0369a1", "complementa")}
            {cartao("Divergentes", plano.contagem.divergentes, COR.roxo, "divergente")}
            {cartao("Iguais", plano.contagem.iguais, "#475569", "igual")}
            {cartao("Eventos novos", eventosNovos.length, COR.laranja)}
          </div>
          <div style={{ fontSize: 12, color: COR.cinza, marginTop: 6 }}>
            {plano.contagem.pagas} paga(s) · {plano.contagem.vencidas} vencida(s) em aberto · {plano.contagem.futuras} futura(s) — as futuras entram como <b>projetadas</b> (valores previstos, sujeitos a atualização pela CAIXA).
          </div>

          {(demo.avisos.length > 0 || plano.repetidasNoCadastro.length > 0 || plano.foraDoDocumento.length > 0) && (
            <div style={{ marginTop: 8, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "#92400e", lineHeight: 1.5 }}>
              {demo.avisos.map((a, i) => <div key={i}>{a}</div>)}
              {plano.repetidasNoCadastro.length > 0 && <div>Números repetidos no cadastro: {plano.repetidasNoCadastro.join(", ")} — o demonstrativo atualiza a primeira de cada; as outras ficam como estão (confira e exclua a duplicada).</div>}
              {plano.foraDoDocumento.length > 0 && <div>{plano.foraDoDocumento.length} parcela(s) do cadastro não estão no demonstrativo e não serão alteradas.</div>}
            </div>
          )}

          {todasDivergencias.length > 0 && (
            <div style={{ marginTop: 10, background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: COR.roxo, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b>{todasDivergencias.length} divergência(s) entre o cadastro e o demonstrativo.</b>
              <span>{aceitasCount} aceita(s) — as demais mantêm o valor do cadastro.</span>
              <button className="jp-btn" onClick={() => alternar(todasDivergencias, true)} style={{ background: "#fff", color: COR.roxo, border: "1px solid #e9d5ff" }}>Aceitar todas</button>
              <button className="jp-btn" onClick={() => alternar(todasDivergencias, false)} style={{ background: "#fff", color: "#475569", border: `1px solid ${COR.borda}` }}>Recusar todas</button>
            </div>
          )}

          {/* Parcelas */}
          <div style={{ marginTop: 10, maxHeight: "42vh", overflow: "auto", border: `1px solid ${COR.borda}`, borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead style={{ position: "sticky", top: 0, background: "#f8fafc" }}><tr>
                <th style={th}>Parcela</th><th style={th}>Vencimento</th><th style={th}>Situação no documento</th>
                <th style={{ ...th, textAlign: "right" }}>Valor devido</th><th style={{ ...th, textAlign: "right" }}>Saldo devedor</th><th style={th}>Prévia</th><th style={th} />
              </tr></thead>
              {visiveis.map(linhaParcela)}
            </table>
          </div>
          {lista.length > POR_PAGINA && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginTop: 6, color: COR.cinza }}>
              <button className="jp-btn" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} style={{ background: "#fff", border: `1px solid ${COR.borda}` }}>‹</button>
              {pagina * POR_PAGINA + 1}–{Math.min(lista.length, (pagina + 1) * POR_PAGINA)} de {lista.length}
              <button className="jp-btn" disabled={(pagina + 1) * POR_PAGINA >= lista.length} onClick={() => setPagina(p => p + 1)} style={{ background: "#fff", border: `1px solid ${COR.borda}` }}>›</button>
              <span>Clique numa parcela para ver campo a campo.</span>
            </div>
          )}

          {/* Eventos */}
          {demo.eventos.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 800, color: COR.texto, marginBottom: 4 }}>Eventos do contrato → histórico (não viram parcela)</div>
              {demo.eventos.map(ev => {
                const ja = eventosGravados.has(chaveEvento(demo.contrato.numero_contrato, ev));
                return (
                  <div key={ev.linha} style={{ display: "flex", gap: 10, padding: "3px 0", borderTop: "1px solid #f1f5f9", color: ja ? COR.claro : COR.texto }}>
                    <b style={{ minWidth: 78 }}>{fmtDt(ev.data)}</b>
                    <span style={{ flex: 1 }}>{ev.descricao}{ev.valor_evento ? ` · valor ${fmtValor("v", ev.valor_evento)}` : ""}{ev.saldo_apos ? ` · saldo após ${fmtValor("v", ev.saldo_apos)}` : ""}</span>
                    <span>{ja ? "já está no histórico" : "novo"}</span>
                  </div>
                );
              })}
            </div>
          )}

          <label style={{ display: "block", fontSize: 12.5, color: "#475569", marginTop: 10 }}>
            <input type="checkbox" checked={guardarPdf} onChange={e => setGuardarPdf(e.target.checked)} /> Guardar o PDF em Documentos do imóvel
          </label>
        </>)}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="jp-btn" disabled={gravando} onClick={fechar} style={{ background: "#fff", color: "#475569", border: `1px solid ${COR.borda}` }}>Cancelar</button>
          <button className="jp-btn" disabled={!plano || gravando} onClick={importar} style={{ background: COR.azul, color: "#fff", border: `1px solid ${COR.azul}`, opacity: plano ? 1 : .5 }}>
            {gravando ? "Importando…" : plano ? `Importar ${plano.parcelas.length} parcela(s)` : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}
