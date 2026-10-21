// RH › Rateio de Despesas — a leitura do PDF com I.A (21/10/2026).
//
// Pedido do Pablo depois do boleto da Bullla de 09/2026: o leitor por regra
// somou o boleto (19.445,87) com a "Relação de Eventos" anexa (19.765,08) e
// jogou as 70 linhas de colaborador num contrato só. "Coloca uma i.a
// inteligente pra ajudar bem aqui no rateio."
//
// O QUE ESTA FUNÇÃO FAZ — E O QUE ELA NÃO FAZ
//
// A IA LÊ o documento: entende o que é boleto, o que é a base por contrato,
// o que é relatório anexo que não deve ser somado, e qual é o valor a pagar.
// Ela NÃO cria número. Cada valor que ela devolve é conferido aqui contra o
// texto da linha que ela citou (tem que estar escrito lá, no centavo); o que
// não bate é descartado e vira alerta. Contrato só vale se for um id da lista
// que o banco devolveu; CPF só vale se estiver na linha e for válido. Assim o
// rateio continua defensável: todo valor na tela aponta para uma linha do PDF.
//
// OS CONTRATOS NÃO VÊM DO CLIENTE: a função chama rh_rateio_contratos com o
// JWT de quem pediu — a RPC cobra rh_rateio_pode('visualizar'), então quem
// não tem a tela leva 403 aqui também. O texto do PDF vem do navegador (o
// arquivo é lido lá), e é só isso que vai para o modelo.
//
// Provedor: o mesmo de sup-estoque-ia — Gemini (GEMINI_API_KEY) primeiro;
// erro passageiro tenta de novo, persistente/sem tokens passa para o Groq
// (GROQ_API_KEY). Modelo: IA_RATEIO_MODELO › IA_CHAT_MODELO (Gemini),
// GROQ_MODEL (Groq).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";
// ~60 mil caracteres ≈ 20 mil tokens: cabe o boleto + relatórios de algumas
// páginas. O FGTS de 180 páginas não cabe — e não precisa, o leitor por
// regra já o lê (layout fgts_digital).
const LIMITE_CARACTERES = 60_000;

type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({
      nome: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      chave: gemini,
      modelo: Deno.env.get("IA_RATEIO_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash",
    });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({
      nome: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      chave: groq,
      modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
    });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(
  provs: Provedor[],
  messages: { role: string; content: string }[],
): Promise<{ texto?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível ler com a IA agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        // Temperatura zero: é transcrição de número, não redação.
        body: JSON.stringify({ model: prov.modelo, temperature: 0, response_format: { type: "json_object" }, messages }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) {
          ultimo = { erro: ERRO_SEM_TOKENS, status: 429 };
          break;
        }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      if (status === 413) return { erro: "O PDF é grande demais para a IA.", status: 413 };
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1200);
    }
  }
  return ultimo;
}

// ── Conferência (mesmas regras de src/lib/rh/rateioDespesas.ts) ──────────
const RE_MOEDA = /(?<![\d,.])-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d,])/g;
const lerMoeda = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const valoresDaLinha = (t: string) => (t.match(RE_MOEDA) ?? []).map(lerMoeda);
const centavos = (n: number) => Math.round(n * 100);
const digitos = (s: string) => s.replace(/\D/g, "");

function cpfValido(cpf: string): boolean {
  const d = digitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const SYSTEM = `Você é o analista do RH do Grupo Nascimento (terceirização: limpeza, portaria, vigilância, administrativo — centenas de contratos com órgãos públicos) que faz o RATEIO DE DESPESAS POR CONTRATO.

Você recebe o TEXTO de um PDF de despesa (boleto, fatura, guia, relatório), uma linha por linha visual, no formato "N| texto" (N = número da linha), e a LISTA DE CONTRATOS do ERP ("id | nome").

SUA TAREFA: dizer QUAL é o valor da despesa e COMO ele se divide entre os contratos, usando só o que está escrito no PDF.

COMO LER (o que já vimos nesses PDFs):
- Um PDF costuma juntar várias coisas: o boleto/fatura, um RESUMO por contrato e relatórios anexos (por exemplo "Relação de Eventos" da Senior, lista de colaboradores com matrícula). Identifique cada parte.
- O VALOR DA DESPESA é o que efetivamente se paga: "(=) Valor cobrado" do boleto (já com desconto/abatimento), "Total Geral" do resumo, "Total a pagar". NÃO é o "Valor do documento" antes do desconto, e NÃO é o rodapé de relatório anexo ("Total de Colaboradores", "Total de Eventos").
- A BASE DO RATEIO é a parte que distribui ESSE valor: de preferência um resumo por contrato/centro de custo que FECHA no valor da despesa. Linhas por CPF também servem quando é o que o documento oferece (seguro, FGTS).
- NUNCA some duas partes que contam o mesmo dinheiro (resumo por contrato + lista de colaboradores, guia + detalhe). Escolha UMA e diga qual ignorou e por quê.
- Linha com valor 0,00 pode ficar de fora.
- Contrato: o nome no PDF costuma vir com código da Senior na frente ("1064 - TRIUNFO VIGIAS - 33/2024"). Case com a lista pelo NOME e pelo NÚMERO do contrato. Datas e competências ("09/2026", "07/10/2026") NÃO são número de contrato. Se não tiver certeza, devolva contrato_id null e explique em "contrato_texto".
- Linha só com matrícula e nome de colaborador (sem CPF e sem contrato) NÃO tem como ir para um contrato: não use como base se houver um resumo por contrato.

REGRAS DURAS:
- Todo "valor" que você devolver TEM que estar escrito na linha N que você citar, exatamente (no formato 1.234,56 do PDF). O sistema confere e descarta o que não estiver.
- "contrato_id" só pode ser um id da lista, copiado igual. Nunca invente.
- "cpf" só se estiver escrito na linha.
- Não arredonde, não estime, não recalcule.

RESPONDA SÓ COM UM JSON, sem texto fora dele, neste formato:
{
  "total_despesa": 19445.87,
  "linha_total": 74,
  "origem_total": "Total Geral do resumo por contrato (pág. 2), igual ao (=) Valor cobrado do boleto",
  "base": "resumo por contrato" | "colaboradores por CPF" | "outro",
  "linhas": [ { "n": 58, "valor": 636.37, "contrato_id": "<id da lista ou null>", "cpf": null, "contrato_texto": "CHARQUEADAS - 249/2020" } ],
  "ignorado": [ "Relação de Eventos da Senior (linhas 77–157, 19.765,08): adiantamento por colaborador, mesmo dinheiro detalhado de outro jeito" ],
  "explicacao": "2 a 4 frases simples para o analista do RH: o que é o documento, de onde veio o valor e o que foi usado como base.",
  "alertas": [ "o que merece conferência humana" ]
}
Valores no JSON como número com ponto decimal (19445.87).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);

    const corpo = await req.json().catch(() => ({}));
    const linhas: string[] = (Array.isArray(corpo?.linhas) ? corpo.linhas : []).map((l: unknown) => String(l ?? ""));
    if (!linhas.some((l) => l.trim())) return respostaJson({ error: "O PDF não tem texto para ler." }, 400);
    const tipo = String(corpo?.tipo ?? "").slice(0, 40);

    const numeradas = linhas.map((l, i) => (l.trim() ? `${i + 1}| ${l}` : "")).filter(Boolean).join("\n");
    if (numeradas.length > LIMITE_CARACTERES) {
      return respostaJson({ error: `O PDF é grande demais para a IA (${linhas.length} linhas). Use a leitura automática e ajuste na tela.` }, 413);
    }

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    // Permissão cobrada dentro da RPC (rh_rateio_pode('visualizar')); 42501 → 403.
    const { data: cts, error: ctErr } = await supa.rpc("rh_rateio_contratos");
    if (ctErr) return respostaJson({ error: ctErr.message }, ctErr.code === "42501" ? 403 : 500);
    const contratos = ((cts ?? []) as { contrato_id: string | null; nome: string | null; status: string | null }[])
      .filter((c) => c.contrato_id && c.nome);
    const idsValidos = new Set(contratos.map((c) => c.contrato_id as string));
    const listaContratos = contratos
      .map((c) => `${c.contrato_id} | ${c.nome}${c.status === "encerrado" ? " (encerrado)" : ""}`)
      .join("\n");

    const res = await chamarIA(provs, [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `TIPO DE DESPESA escolhido na tela: ${tipo || "(não informado)"}\n\nCONTRATOS DO ERP:\n${listaContratos}\n\nTEXTO DO PDF:\n${numeradas}`,
      },
    ]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);

    // deno-lint-ignore no-explicit-any
    let ia: any;
    try {
      ia = JSON.parse(res.texto);
    } catch {
      const m = res.texto.match(/\{[\s\S]*\}/);
      try { ia = m ? JSON.parse(m[0]) : null; } catch { ia = null; }
    }
    if (!ia || typeof ia !== "object") return respostaJson({ error: "A IA respondeu fora do formato. Tente de novo." }, 502);

    // ── Conferência de cada número contra o PDF ──────────────────────────
    const alertas: string[] = (Array.isArray(ia.alertas) ? ia.alertas : []).map(String).slice(0, 10);
    const descartadas: string[] = [];
    const vistas = new Set<number>();
    const saida: { n: number; texto: string; valor: number; contrato_id: string | null; cpf: string | null; contrato_texto: string }[] = [];
    for (const l of Array.isArray(ia.linhas) ? ia.linhas : []) {
      const n = Number(l?.n);
      const valor = Number(l?.valor);
      const texto = Number.isInteger(n) && n >= 1 && n <= linhas.length ? linhas[n - 1] : "";
      if (!texto || !Number.isFinite(valor)) { descartadas.push(`linha ${l?.n ?? "?"}`); continue; }
      if (!valoresDaLinha(texto).some((v) => centavos(v) === centavos(valor))) {
        descartadas.push(`linha ${n} (${valor.toFixed(2).replace(".", ",")} não está escrito nela)`);
        continue;
      }
      if (vistas.has(n)) continue; // mesma linha duas vezes somaria em dobro
      vistas.add(n);
      const cid = typeof l?.contrato_id === "string" && idsValidos.has(l.contrato_id) ? l.contrato_id : null;
      const cpfIa = digitos(String(l?.cpf ?? ""));
      const cpf = cpfIa && cpfValido(cpfIa) && digitos(texto).includes(cpfIa) ? cpfIa : null;
      saida.push({ n, texto: texto.trim(), valor: centavos(valor) / 100, contrato_id: cid, cpf, contrato_texto: String(l?.contrato_texto ?? "").slice(0, 200) });
    }
    if (descartadas.length) {
      alertas.unshift(`${descartadas.length} linha(s) da IA descartada(s) por não baterem com o PDF: ${descartadas.slice(0, 5).join("; ")}${descartadas.length > 5 ? "…" : ""}.`);
    }

    // O total também tem que estar escrito no PDF.
    let total: number | null = Number.isFinite(Number(ia.total_despesa)) ? Number(ia.total_despesa) : null;
    if (total != null && !linhas.some((t) => valoresDaLinha(t).some((v) => centavos(v) === centavos(total as number)))) {
      alertas.unshift(`A IA indicou ${total.toFixed(2).replace(".", ",")} como valor da despesa, mas esse número não aparece no PDF — ignorado.`);
      total = null;
    }
    const soma = centavos(saida.reduce((a, l) => a + l.valor, 0)) / 100;
    if (total != null && centavos(soma) !== centavos(total)) {
      alertas.unshift(`A base lida soma ${soma.toFixed(2).replace(".", ",")} e o valor da despesa é ${total.toFixed(2).replace(".", ",")} — confira as linhas.`);
    }

    return respostaJson({
      total_despesa: total,
      origem_total: String(ia.origem_total ?? "").slice(0, 300),
      base: String(ia.base ?? "").slice(0, 60),
      linhas: saida,
      soma,
      ignorado: (Array.isArray(ia.ignorado) ? ia.ignorado : []).map(String).slice(0, 10),
      explicacao: String(ia.explicacao ?? "").slice(0, 1200),
      alertas,
    });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível ler com a IA agora." }, 500);
  }
});
