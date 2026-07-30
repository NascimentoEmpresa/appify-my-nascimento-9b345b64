// Arquivo: supabase/functions/whatsapp-testar/index.ts
//
// Simulador do chatbot para o submódulo WhatsApp > Testes. Roda exatamente a
// mesma lógica do atendimento real (importada de _shared/whatsapp-bot.ts) com a
// configuração real — persona, provedor, modelo, base de conhecimento, menu e
// horário — porém SEM nenhum efeito colateral:
//   - não chama a Graph API, então nada é enviado a ninguém;
//   - não grava em WA_CONTATO / WA_CONVERSA / WA_MENSAGEM, então a Caixa de
//     Entrada não é poluída com conversa de teste.
// O histórico da simulação vive no navegador e volta a cada chamada.
//
// Exige a capacidade 'whatsapp_testes' do usuário autenticado.
// Secrets: a chave do provedor ativo (GROQ_API_KEY etc).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  dentroDoHorario, menuAtivo, montarBase, montarSystem, gerarResposta,
  SECRET_DO_PROVEDOR, type BotConfig, type Msg,
} from "../_shared/whatsapp-bot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Corpo {
  acao?: "simular" | "ping";
  mensagem?: string;
  historico?: Msg[];
  reply_id?: string | null;      // clique numa opção do menu simulado
  ignorar_horario?: boolean;     // testar o bot fora da janela de atendimento
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);

  const { data: permitido } = await db.rpc("tem_acesso_menu", { _menu_codigo: "whatsapp_testes" });
  if (permitido !== true) return json({ error: "sem acesso ao módulo de Testes do WhatsApp" }, 403);

  let body: Corpo;
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  // Configuração real do bot (RLS da sessão do usuário autoriza a leitura).
  const { data: cfgRow } = await db.from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
  if (!cfgRow) return json({ error: "configuração do bot não encontrada" }, 404);
  const cfg = cfgRow as unknown as BotConfig;
  const provedor = cfg.provedor || "groq";

  const { data: conh } = await db.from("WA_BOT_CONHECIMENTO")
    .select("titulo, conteudo").eq("ativo", true).order("ordem");
  const base = montarBase(conh ?? []);

  const noHorario = dentroDoHorario(cfg);
  const menu = menuAtivo(cfg);

  // Diagnóstico devolvido em toda resposta — é o que o Testes mostra no painel
  // lateral para explicar POR QUE o bot respondeu daquele jeito.
  const diagnostico = {
    bot_ativo: !!cfg.ativo,
    provedor,
    modelo: cfg.modelo,
    secret_esperado: SECRET_DO_PROVEDOR[provedor] ?? "?",
    atende_24h: !!cfg.atende_24h,
    dentro_horario: noHorario,
    menu_ativo: !!menu,
    base_itens: (conh ?? []).length,
    ms: 0,
    erro: null as string | null,
  };

  // Teste de conexão: chamada mínima só para validar chave + modelo.
  if (body.acao === "ping") {
    const r = await gerarResposta(
      { ...cfg, max_tokens: 32 },
      "Responda apenas: ok",
      [{ role: "user", content: "ok" }],
    );
    return json({
      tipo: "ping",
      ok: !r.erro,
      resposta: r.texto,
      diagnostico: { ...diagnostico, ms: r.ms, erro: r.erro },
    });
  }

  const mensagem = (body.mensagem ?? "").trim();
  if (!mensagem && !body.reply_id) return json({ error: "mensagem é obrigatória" }, 400);

  const historico = Array.isArray(body.historico) ? body.historico.slice(-20) : [];
  const primeiroContato = !historico.some((m) => m.role === "assistant");

  // ---- mesma ordem de decisão do webhook ----

  // 1) Fora do horário: o bot manda o aviso e para. ignorar_horario permite
  //    testar o restante do fluxo fora da janela de atendimento.
  if (!noHorario && !body.ignorar_horario) {
    return json({
      tipo: "fora_horario",
      resposta: cfg.fora_horario_msg,
      diagnostico,
    });
  }

  // 2) Clique numa opção do menu → executa a ação configurada.
  if (body.reply_id && menu) {
    const opt = menu.opcoes.find((o) => String(o.id) === body.reply_id);
    if (opt) {
      const valor = typeof opt.valor === "string" ? opt.valor.trim() : "";
      if (opt.acao === "humano") {
        return json({
          tipo: "menu_humano",
          resposta: valor || null,
          nota: "O bot seria desligado nesta conversa e ela iria para atendimento humano.",
          diagnostico,
        });
      }
      if (opt.acao === "texto") {
        return json({ tipo: "menu_texto", resposta: valor || String(opt.titulo), diagnostico });
      }
      // acao "ia": aviso opcional; as próximas mensagens caem na IA.
      return json({
        tipo: "menu_ia",
        resposta: valor || null,
        nota: "A partir daqui as mensagens seguem para a IA.",
        diagnostico,
      });
    }
  }

  // 3) Primeira mensagem da conversa → apresenta o menu.
  if (menu && primeiroContato) {
    return json({
      tipo: "menu",
      resposta: (menu.titulo && menu.titulo.trim()) || "Como posso te ajudar?",
      botoes: menu.opcoes.slice(0, 10).map((o) => ({ id: String(o.id), titulo: String(o.titulo) })),
      formato: menu.opcoes.length <= 3 ? "button" : "list",
      diagnostico,
    });
  }

  // 4) Conversa livre → IA.
  const system = montarSystem(cfg, base, primeiroContato);
  const messages: Msg[] = [...historico, { role: "user", content: mensagem }];
  const r = await gerarResposta(cfg, system, messages);

  return json({
    tipo: r.erro ? "fallback" : "ia",
    resposta: r.texto ?? cfg.fallback,
    system,                                   // prompt final, para inspeção
    diagnostico: { ...diagnostico, ms: r.ms, erro: r.erro },
  });
});
