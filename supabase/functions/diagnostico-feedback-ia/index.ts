// Diagnóstico por IA dos feedbacks de um setor (sob demanda).
// A RLS do usuário escolhe as respostas; a lógica compartilhada calcula os
// agregados e remove identificadores antes de qualquer chamada ao gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  agregarSetor,
  elegivel,
  montarDicionarioNomes,
  montarPrompt,
  normalizaSetor,
  validarDiagnostico,
  MINIMO_RESPOSTAS_DIAGNOSTICO,
  type PerguntaDiagnostico,
  type RespostaDiagnostico,
} from "../_shared/diagnostico-feedback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELO = "google/gemini-3-flash-preview";
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: jsonHeaders });

const SYSTEM_PROMPT = `Você é um analista sênior de gestão de pessoas do Grupo Nascimento.
Sua tarefa é diagnosticar, em português do Brasil, o conjunto ANÔNIMO de feedbacks de um setor.

REGRAS ABSOLUTAS:
1. Nunca nomeie, identifique ou tente inferir uma pessoa. Fale apenas do setor e da equipe como coletivo.
2. Nunca calcule números. Toda contagem e percentual confiável já chega pronto no agregado; apenas cite esses valores quando sustentarem a leitura.
3. Não invente fatos, causas, consensos ou prazos observados. O prazo do plano é uma sugestão futura, não um dado histórico.
4. Cruze os dois eixos: o que os liderados dizem precisar da liderança e o que a liderança aponta sobre os liderados.
5. Produza temas objetivos, evidências curtas e ações executáveis. Não escreva nada além de chamar a tool "diagnostico_setor".`;

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
    name: "diagnostico_setor",
    description: "Retorna o diagnóstico anônimo e estruturado dos feedbacks do setor.",
    parameters: {
      type: "object",
      properties: {
        setor: { type: "string" },
        qtd_respostas: { type: "integer", minimum: 0 },
        liderados_para_lider: { type: "array", maxItems: 5, items: itemTema },
        lider_para_liderados: { type: "array", maxItems: 5, items: itemTema },
        convergencias: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: { tema: { type: "string" }, leitura: { type: "string" } },
            required: ["tema", "leitura"],
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
      required: ["setor", "qtd_respostas", "liderados_para_lider", "lider_para_liderados", "convergencias", "plano_de_acao"],
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

    // Evita consumir crédito para alguém que até pode ler respostas pela RLS,
    // mas não recebeu a função adicional de gerar/ler diagnósticos.
    const { data: temCap, error: erroCap } = await supa.rpc("cs_form_cap", { _cap: "diagnostico_feedback" });
    if (erroCap) throw erroCap;
    if (!temCap) return respostaJson({ error: "Sem permissão para gerar diagnóstico." }, 403);

    const body = await req.json().catch(() => ({}));
    const formularioId = typeof body?.formulario_id === "string" ? body.formulario_id.trim() : "";
    const setorPedido = typeof body?.setor === "string" ? body.setor.trim() : "";
    const setorNorm = normalizaSetor(setorPedido);
    if (!formularioId || !setorNorm) {
      return respostaJson({ error: "Informe formulario_id e setor." }, 400);
    }

    const { data: formulario, error: erroFormulario } = await supa
      .from("CS_FORMULARIOS")
      .select("id, perguntas")
      .eq("id", formularioId)
      .maybeSingle();
    if (erroFormulario) throw erroFormulario;
    if (!formulario) return respostaJson({ error: "Formulário não encontrado ou sem acesso." }, 404);

    // Pagina para o diagnóstico continuar sendo "todos de uma vez" quando o
    // formulário ultrapassar o limite padrão do PostgREST. respondente_nome é
    // lido exclusivamente para compor o dicionário local de anonimização; ele
    // não integra o agregado nem o payload enviado ao gateway. E-mail, cadastro
    // e criado_por nem saem do banco.
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

    const respostasSetor = respostasVisiveis.filter((r) => normalizaSetor(r.setor) === setorNorm);
    if (!elegivel(respostasSetor.length)) {
      return respostaJson({
        error: MINIMO_RESPOSTAS_DIAGNOSTICO === 1
          ? "É necessária pelo menos 1 resposta visível no setor para gerar o diagnóstico."
          : `São necessárias pelo menos ${MINIMO_RESPOSTAS_DIAGNOSTICO} respostas visíveis no setor.`,
        qtd_respostas: respostasSetor.length,
        minimo: MINIMO_RESPOSTAS_DIAGNOSTICO,
      }, 422);
    }

    const perguntas = normalizarPerguntas(formulario.perguntas);
    const dicionarioNomes = montarDicionarioNomes(perguntas, respostasSetor);
    const respostasAnonimas = respostasSetor.map((resposta) => ({
      setor: resposta.setor,
      itens: resposta.itens,
    }));
    const agregado = agregarSetor(perguntas, respostasAnonimas, dicionarioNomes);
    // Mantém o rótulo escolhido na tela, mas a seleção acima foi feita pela
    // chave sem acento/caixa para LICITAÇÃO e LICITACAO formarem um só grupo.
    agregado.setor = setorPedido;

    const qtdPerguntas = agregado.liderados_para_lider.fechadas.length
      + agregado.liderados_para_lider.abertas.length
      + agregado.lider_para_liderados.fechadas.length
      + agregado.lider_para_liderados.abertas.length;
    if (!qtdPerguntas) {
      return respostaJson({ error: "As perguntas deste formulário não correspondem ao feedback guiado." }, 422);
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
          { role: "user", content: montarPrompt(agregado) },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "diagnostico_setor" } },
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
    if (chamada?.function?.name !== "diagnostico_setor" || !chamada?.function?.arguments) {
      return respostaJson({ error: "Resposta da IA sem estrutura esperada." }, 502);
    }

    let bruto: unknown;
    try { bruto = JSON.parse(chamada.function.arguments); } catch {
      return respostaJson({ error: "JSON inválido da IA." }, 502);
    }
    const validacao = validarDiagnostico(bruto, dicionarioNomes);
    if (!validacao.ok) {
      console.error("diagnostico-feedback-ia formato inválido", validacao.motivo);
      return respostaJson({ error: "Resposta da IA sem estrutura esperada." }, 502);
    }

    // setor e quantidade são fatos calculados pelo código, não valores em que
    // confiamos por terem voltado do modelo.
    const diagnostico = {
      ...validacao.diagnostico,
      setor: agregado.setor,
      qtd_respostas: agregado.qtd_respostas,
    };
    const meta = userData.user.user_metadata ?? {};
    const geradoPorNome = String(meta.display_name ?? meta.full_name ?? meta.name ?? "").trim() || null;

    const { data: registro, error: erroInsert } = await supa
      .from("CS_FORM_DIAGNOSTICOS")
      .insert({
        formulario_id: formularioId,
        setor: agregado.setor,
        setor_norm: setorNorm,
        gerado_por_nome: geradoPorNome,
        qtd_respostas: agregado.qtd_respostas,
        modelo: MODELO,
        conteudo: diagnostico,
      })
      .select("id, formulario_id, setor, setor_norm, gerado_em, gerado_por_nome, qtd_respostas, modelo")
      .single();
    if (erroInsert) throw erroInsert;

    return respostaJson({ ...diagnostico, ...registro });
  } catch (e) {
    console.error("diagnostico-feedback-ia error", e);
    return respostaJson({ error: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});
