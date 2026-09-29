// supabase/functions/colaborador-ia/index.ts
// Portal do Colaborador — assistente de IA do botão "Tirar dúvida".
//
// CONSUMIDOR
//   src/pages/colaborador/AssistenteIA.tsx, na tela de entrar
//   (/colaborador/entrar) e dentro do portal (/colaborador/*).
//
// AUTENTICAÇÃO
//   Igual à colaborador-portal: verify_jwt = false (o colaborador de campo não
//   tem conta no Supabase Auth). O token do portal é OPCIONAL:
//   • sem token  → só responde sobre acesso e uso do portal, sem dado pessoal.
//   • com token  → resolve o empregado por col_sessao e passa ao modelo um
//                  contexto básico (nome, cargo, escala, admissão…). NUNCA
//                  CPF, PIS, salário ou dados bancários.
//   Token enviado mas vencido → 401 { sessao: false }, mesmo contrato do portal.
//
// CUSTO
//   A tela de entrar é pública; col_ia_consumir limita perguntas por IP (sem
//   sessão) e por empregado (com sessão). Ver 20260930000258_colaborador_ia.sql.
//
// PROTOCOLO
//   POST { token?, mensagens: [{ role: "user"|"assistant", content }] }
//   → 200 { resposta }  |  429 { error } (cota)  |  4xx/5xx { error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODELO = Deno.env.get("IA_COLABORADOR_MODELO") ?? "google/gemini-3-flash-preview";

const LIMITE_SEM_SESSAO = 15; // perguntas por hora por IP
const LIMITE_COM_SESSAO = 60; // perguntas por hora por colaborador
const MAX_MENSAGENS = 12;     // histórico enviado ao modelo
const MAX_CARACTERES = 1000;  // por mensagem

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PROMPT_BASE = `Você é o Assistente do Portal do Colaborador do Grupo Nascimento (empresa brasileira de serviços terceirizados).
Seu papel é tirar dúvidas de colaboradores de campo, muitas vezes com pouca familiaridade com tecnologia, usando o celular.

Como responder:
- Português do Brasil, linguagem simples e acolhedora, frases curtas. Nada de juridiquês.
- Respostas curtas (até ~8 linhas). Use passo a passo numerado quando for explicar como fazer algo no portal.
- Texto puro: sem markdown (nada de asteriscos, #, tabelas ou links formatados); no máximo listas simples com "1." ou "-".
- Se não souber, ou se a dúvida depender de dado que você não tem (valor de salário, saldo de férias, desconto específico, holerite, situação de um pedido), diga com honestidade e oriente a procurar o RH da unidade ou o líder/encarregado.
- Nunca invente regras internas, valores, prazos ou datas da empresa. Sobre direitos trabalhistas (CLT, férias, 13º, horas extras, atestado), pode explicar a regra geral, sempre avisando que o RH confirma o caso dele.
- Nunca peça CPF, senha ou dados bancários na conversa. Se a pessoa mandar, avise para não compartilhar senha com ninguém.
- Fique no assunto trabalho/portal. Recuse com educação pedidos fora disso.
- Em caso de assédio, acidente de trabalho, discriminação ou situação grave, oriente a falar com o RH e mencione que existe o Canal de Ética (denúncia pode ser anônima).

O que existe no Portal do Colaborador:
- Entrar: login com o CPF. A senha inicial também é o CPF. Quem já trocou a senha usa a nova. Depois de 5 senhas erradas, é preciso esperar 15 minutos. Só entra quem está ativo no cadastro do RH; desligado não entra. Se o CPF não for aceito, procurar o RH da unidade. A sessão fica salva no celular e só expira depois de 30 dias sem entrar.
- Trocar senha: menu Perfil › Segurança. A nova senha precisa ter pelo menos 6 caracteres e não pode ser o CPF. Esqueceu a senha que criou: o RH precisa redefinir.
- Início: resumo com avisos, notificações e eventos.
- Ponto: registrar as batidas do dia na ordem — Entrada, Saída p/ intervalo, Retorno do intervalo e Saída. O celular pede a localização (GPS): é preciso permitir. Mostra o espelho do mês, total de horas, horas extras e se o fechamento do mês foi aprovado/pago. Batida errada ou esquecida: falar com o líder/encarregado ou o RH para ajustar.
- Cursos: treinamentos com aulas em vídeo, texto e provas. Algumas aulas liberam por data; a prova libera depois de assistir o vídeo; há nota mínima e número limitado de tentativas. Concluindo o curso, o certificado fica disponível para baixar.
- Salário: mostra salário cadastrado, adicionais, forma de pagamento e conta bancária/PIX cadastrados. Para mudar conta ou PIX, procurar o RH.
- Histórico: pedidos de férias, trocas de função e advertências, com o status de cada um.
- Perfil: dados pessoais e do contrato (cargo, escala, posto, admissão). Dado errado: pedir correção ao RH.
- Menu: no celular fica embaixo da tela; no computador, no topo. O botão de sair fica no canto superior direito.`;

type Mensagem = { role: "user" | "assistant"; content: string };

function limparMensagens(bruto: unknown): Mensagem[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((m): m is { role: string; content: unknown } => !!m && typeof m === "object" && "role" in m)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role as Mensagem["role"], content: (m.content as string).slice(0, MAX_CARACTERES) }))
    .slice(-MAX_MENSAGENS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const mensagens = limparMensagens(body.mensagens);
  if (!mensagens.length || mensagens[mensagens.length - 1].role !== "user") {
    return json({ error: "Escreva a sua dúvida." }, 400);
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "Assistente indisponível no momento." }, 503);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || "Falha ao consultar.");
    return data;
  };

  try {
    // ── Quem pergunta ────────────────────────────────────────────────────
    const token = typeof body.token === "string" ? body.token.slice(0, 200) : "";
    let emp: number | null = null;
    let contexto = "O colaborador AINDA NÃO ENTROU no portal (está na tela de login). Você não sabe quem ele é. Foque em ajudar a entrar e em dúvidas gerais.";

    if (token) {
      emp = (await rpc("col_sessao", { p_token: token })) as number | null;
      if (!emp) return json({ error: "Sessão expirada. Entre de novo.", sessao: false }, 401);
      const p = (await rpc("col_perfil", { p_emp: emp })) as Record<string, unknown> | null;
      if (p) {
        // Só campos sem risco — nada de CPF/PIS/CTPS/e-mail/salário/banco.
        const seguro = {
          primeiro_nome: String(p.nome ?? "").split(" ")[0],
          cargo: p.cargo, setor: p.setor, posto: p.posto, empresa: p.empresa, filial: p.filial,
          situacao: p.situacao, admissao: p.admissao, escala: p.escala,
          tipo_contrato: p.tipo_contrato, lider: p.lider, trocou_senha: p.senha_propria,
        };
        contexto = `O colaborador JÁ ESTÁ LOGADO no portal. Dados básicos dele (use só se ajudar a responder; chame-o pelo primeiro nome):\n${JSON.stringify(seguro)}`;
      }
    }

    // ── Cota ─────────────────────────────────────────────────────────────
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";
    const permitido = await rpc("col_ia_consumir", {
      p_chave: emp ? `emp:${emp}` : `ip:${ip}`,
      p_limite: emp ? LIMITE_COM_SESSAO : LIMITE_SEM_SESSAO,
      p_janela_min: 60,
      p_emp: emp,
    });
    if (!permitido) {
      return json({ error: "Você fez muitas perguntas seguidas. Aguarde um pouco e tente de novo, ou procure o RH da sua unidade." }, 429);
    }

    // ── Modelo ───────────────────────────────────────────────────────────
    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 700,
        messages: [
          { role: "system", content: `${PROMPT_BASE}\n\nData de hoje: ${hoje}\n\n${contexto}` },
          ...mensagens,
        ],
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("colaborador-ia gateway:", aiResp.status, t.slice(0, 500));
      if (aiResp.status === 429) return json({ error: "O assistente está muito requisitado agora. Tente de novo em instantes." }, 429);
      return json({ error: "Assistente indisponível no momento. Tente mais tarde ou procure o RH." }, 502);
    }

    const dados = await aiResp.json();
    const resposta = String(dados?.choices?.[0]?.message?.content ?? "").trim();
    if (!resposta) return json({ error: "Não consegui responder agora. Tente reformular a pergunta." }, 502);
    return json({ resposta });
  } catch (e) {
    console.error("colaborador-ia:", e);
    return json({ error: "Não foi possível responder agora." }, 500);
  }
});
