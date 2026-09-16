// Diagnóstico por IA de QUALQUER formulário (sob demanda) — 15/09/2026.
//
// Irmã da diagnostico-feedback-ia: mesma capacidade (diagnostico_feedback),
// mesma RLS escolhendo as respostas, mesma anonimização antes do gateway e a
// mesma tabela de histórico (CS_FORM_DIAGNOSTICOS, tipo = 'formulario'). O
// que muda é o agregado: aqui toda pergunta entra, sem eixos de liderança.
// Setor é opcional — vazio = todas as respostas visíveis do formulário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  elegivel,
  montarDicionarioNomes,
  normalizaSetor,
  MINIMO_RESPOSTAS_DIAGNOSTICO,
  type PerguntaDiagnostico,
  type RespostaDiagnostico,
} from "../_shared/diagnostico-feedback.ts";
import {
  agregadoTemConteudo,
  agregarFormulario,
  montarPromptFormulario,
  validarDiagnosticoFormulario,
} from "../_shared/diagnostico-formulario.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELO = "google/gemini-3-flash-preview";
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: jsonHeaders });

const SYSTEM_PROMPT = `Você é um analista sênior do Grupo Nascimento.
Sua tarefa é diagnosticar, em português do Brasil, o conjunto ANÔNIMO de respostas de um formulário interno.

REGRAS ABSOLUTAS:
1. Nunca nomeie, identifique ou tente inferir uma pessoa. Fale do grupo de respondentes como coletivo.
2. Nunca calcule números. Toda contagem e percentual confiável já chega pronto no agregado; apenas cite esses valores quando sustentarem a leitura.
3. Não invente fatos, causas, consensos ou prazos observados. O prazo do plano é uma sugestão futura, não um dado histórico.
4. Separe o que as respostas mostram de positivo (pontos fortes) do que pede ação (pontos de atenção); dê uma leitura curta por pergunta relevante.
5. Produza temas objetivos, evidências curtas e ações executáveis. Não escreva nada além de chamar a tool "diagnostico_formulario".`;

const itemTema = {
  type: "object",
  properties: {
    tema: { type: "string" },
    evidencia: { type: "string" },
    forca: { type: "string", enum: ["Alta", "Média", "Baixa"] },
  },
  required: ["tema", "evidencia", "forca"],
  additionalProperties: false,
};

const tools = [{
  type: "function",
  function: {
    name: "diagnostico_formulario",
    description: "Retorna o diagnóstico anônimo e estruturado das respostas do formulário.",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        setor: { type: "string" },
        qtd_respostas: { type: "integer", minimum: 0 },
        resumo: { type: "string", description: "Leitura geral em 2 a 4 frases." },
        pontos_fortes: { type: "array", maxItems: 5, items: itemTema },
        pontos_de_atencao: { type: "array", maxItems: 5, items: itemTema },
        leitura_por_pergunta: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: { pergunta: { type: "string" }, leitura: { type: "string" } },
            required: ["pergunta", "leitura"],
            additionalProperties: false,
          },
        },
        plano_de_acao: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              acao: { type: "string" },
              porque: { type: "string" },
              prazo_sugerido_dias: { type: "integer", minimum: 1 },
              prioridade: { type: "string", enum: ["Alta", "Média", "Baixa"] },
            },
            required: ["acao", "porque", "prazo_sugerido_dias", "prioridade"],
            additionalProperties: false,
          },
        },
      },
      required: ["titulo", "setor", "qtd_respostas", "resumo", "pontos_fortes", "pontos_de_atencao", "leitura_por_pergunta", "plano_de_acao"],
      additionalProperties: false,
    },
  },
}];

const normalizarPerguntas = (valor: unknown): PerguntaDiagnostico[] =>
  (Array.isArray(valor) ? valor : []).map((item: unknown) => {
    const p = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: String(p.id ?? ""),
      tipo: String(p.tipo ?? ""),
      titulo: String(p.titulo ?? ""),
      opcoes: Array.isArray(p.opcoes) ? p.opcoes.map(String) : [],
      config: p.config && typeof p.config === "object" ? p.config as Record<string, unknown> : {},
    };
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    const supa = createClient(supaUrl, anon, { global: { headers: { Authorization: auth } } });

    const { data: userData } = await supa.auth.getUser();
    if (!userData.user) return respostaJson({ error: "Não autenticado" }, 401);

    // Mesma capacidade do diagnóstico de feedback — sem gerenciamento novo.
    const { data: temCap, error: erroCap } = await supa.rpc("cs_form_cap", { _cap: "diagnostico_feedback" });
    if (erroCap) throw erroCap;
    if (!temCap) return respostaJson({ error: "Sem permissão para gerar diagnóstico." }, 403);

    const body = await req.json().catch(() => ({}));
    const formularioId = typeof body?.formulario_id === "string" ? body.formulario_id.trim() : "";
    const setorPedido = typeof body?.setor === "string" ? body.setor.trim() : "";
    const setorNorm = normalizaSetor(setorPedido);
    if (!formularioId) return respostaJson({ error: "Informe formulario_id." }, 400);

    const { data: formulario, error: erroFormulario } = await supa
      .from("CS_FORMULARIOS")
      .select("id, titulo, perguntas")
      .eq("id", formularioId)
      .maybeSingle();
    if (erroFormulario) throw erroFormulario;
    if (!formulario) return respostaJson({ error: "Formulário não encontrado ou sem acesso." }, 404);

    // Paginado, como no feedback. respondente_nome só alimenta o dicionário de
    // anonimização; não entra no agregado nem no payload do gateway.
    const respostasVisiveis: RespostaDiagnostico[] = [];
    const TAMANHO_PAGINA = 1000;
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data: pagina, error: erroRespostas } = await supa
        .from("CS_FORM_RESPOSTAS")
        .select("id, setor, itens, respondente_nome")
        .eq("formulario_id", formularioId)
        .order("id", { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (erroRespostas) throw erroRespostas;
      respostasVisiveis.push(...(pagina ?? []));
      if ((pagina ?? []).length < TAMANHO_PAGINA) break;
    }

    const respostas = setorNorm
      ? respostasVisiveis.filter((r) => normalizaSetor(r.setor) === setorNorm)
      : respostasVisiveis;
    if (!elegivel(respostas.length)) {
      return respostaJson({
        error: MINIMO_RESPOSTAS_DIAGNOSTICO === 1
          ? "É necessária pelo menos 1 resposta visível para gerar o diagnóstico."
          : `São necessárias pelo menos ${MINIMO_RESPOSTAS_DIAGNOSTICO} respostas visíveis.`,
        qtd_respostas: respostas.length,
        minimo: MINIMO_RESPOSTAS_DIAGNOSTICO,
      }, 422);
    }

    const perguntas = normalizarPerguntas(formulario.perguntas);
    const dicionarioNomes = montarDicionarioNomes(perguntas, respostas);
    const respostasAnonimas = respostas.map((r) => ({ setor: r.setor, itens: r.itens }));
    const agregado = agregarFormulario(String(formulario.titulo ?? ""), setorPedido, perguntas, respostasAnonimas, dicionarioNomes);
    if (!agregadoTemConteudo(agregado)) {
      return respostaJson({ error: "As respostas visíveis não têm conteúdo diagnosticável (só arquivos, imagens ou campos vazios)." }, 422);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return respostaJson({ error: "LOVABLE_API_KEY não configurada" }, 500);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: montarPromptFormulario(agregado) },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "diagnostico_formulario" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      const msg = aiResp.status === 429
        ? "Limite de requisições atingido. Tente novamente em instantes."
        : aiResp.status === 402
        ? "Créditos da IA esgotados. Adicione créditos no workspace."
        : "Falha ao chamar a IA.";
      console.error("AI gateway error", aiResp.status, txt);
      return respostaJson({ error: msg }, status);
    }

    const dadosIa = await aiResp.json();
    const chamada = dadosIa?.choices?.[0]?.message?.tool_calls?.[0];
    if (chamada?.function?.name !== "diagnostico_formulario" || !chamada?.function?.arguments) {
      return respostaJson({ error: "Resposta da IA sem estrutura esperada." }, 502);
    }

    let bruto: unknown;
    try { bruto = JSON.parse(chamada.function.arguments); } catch {
      return respostaJson({ error: "JSON inválido da IA." }, 502);
    }
    const validacao = validarDiagnosticoFormulario(bruto, dicionarioNomes);
    if (!validacao.ok) {
      console.error("diagnostico-formulario-ia formato inválido", validacao.motivo);
      return respostaJson({ error: "Resposta da IA sem estrutura esperada." }, 502);
    }

    // Título, setor e quantidade são fatos do código, não do modelo.
    const diagnostico = {
      ...validacao.diagnostico,
      titulo: agregado.formulario,
      setor: agregado.setor,
      qtd_respostas: agregado.qtd_respostas,
    };
    const meta = userData.user.user_metadata ?? {};
    const geradoPorNome = String(meta.display_name ?? meta.full_name ?? meta.name ?? "").trim() || null;

    const { data: registro, error: erroInsert } = await supa
      .from("CS_FORM_DIAGNOSTICOS")
      .insert({
        formulario_id: formularioId,
        tipo: "formulario",
        setor: agregado.setor,
        setor_norm: setorNorm,
        gerado_por_nome: geradoPorNome,
        qtd_respostas: agregado.qtd_respostas,
        modelo: MODELO,
        conteudo: diagnostico,
      })
      .select("id, formulario_id, tipo, setor, setor_norm, gerado_em, gerado_por_nome, qtd_respostas, modelo")
      .single();
    if (erroInsert) throw erroInsert;

    return respostaJson({ ...diagnostico, ...registro });
  } catch (e) {
    console.error("diagnostico-formulario-ia error", e);
    return respostaJson({ error: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});
