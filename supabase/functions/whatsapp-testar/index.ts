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
  rotearBot, TITULO_MENU_PADRAO, SECRET_DO_PROVEDOR,
  montarVagas, montarPastas, extrairTransferencia, AVISO_TRANSFERIDO_IA,
  type BotConfig, type Msg, type ModoConversa, type PastaBot,
} from "../_shared/whatsapp-bot.ts";
import { conduzirAtendimento, type PortasAtendimento } from "../_shared/whatsapp-atendimento-fluxo.ts";
import type { RegraDado } from "../_shared/whatsapp-atendimento.ts";
import type { CanalInfo } from "../_shared/whatsapp-canal.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// SIS-2026-0929 — simulador do atendimento dos supervisores.
//
// Roda conduzirAtendimento (o MESMO fluxo do webhook) com portas que não
// gravam nada: nenhum protocolo, mensagem ou log de consulta é criado e nada
// vai para o WhatsApp. O que é real: a I.A (provedor/modelo do canal), a base
// de conhecimento, as regras de dados e a decisão de consulta — esta pela RPC
// wa_atd_simular_consulta, que monta a identidade simulada NO SERVIDOR a partir
// do colaborador escolhido e registra o acesso em WA_ATD_ACESSO_LOG.
// O estado da conversa (histórico e status) vive no navegador.
// ---------------------------------------------------------------------------
interface CorpoAtendimento {
  quem: "empregado" | "desconhecido" | "divergente";
  empregado_id?: number | null;
  mensagem?: string;
  tipo?: "text" | "image" | "audio" | "document";
  historico?: Array<{ direcao: "entrada" | "saida"; origem: "contato" | "bot" | "atendente"; texto: string }>;
  status?: "ia" | "aguardando_humano" | "em_atendimento_humano" | "concluido";
  primeira?: boolean;          // primeira mensagem do protocolo: mostra o aviso de abertura
  usar_pendentes?: boolean;    // incluir procedimentos ainda não aprovados (para testar antes de aprovar)
}

async function simularAtendimento(db: ReturnType<typeof createClient>, b: CorpoAtendimento): Promise<Response> {
  const { data: pode } = await db.rpc("wa_atd_simular_pode");
  if (pode !== true) return json({ error: "sem acesso: precisa de WhatsApp › Testes e de Atendimento Supervisores (base e regras)" }, 403);

  const tipo = b.tipo ?? "text";
  const mensagem = (b.mensagem ?? "").trim();
  if (tipo === "text" && !mensagem) return json({ error: "mensagem é obrigatória" }, 400);
  const quem = b.quem === "empregado" || b.quem === "divergente" ? b.quem : "desconhecido";
  const empregadoId = quem === "empregado" ? Number(b.empregado_id) || null : null;
  if (quem === "empregado" && !empregadoId) return json({ error: "escolha o colaborador que está escrevendo" }, 400);

  const { data: canalReal } = await db.from("WA_CANAL")
    .select("codigo, phone_number_id, finalidade, ativo, ia_ativa, pasta_padrao, provedor, modelo, max_tokens, persona, aviso_abertura, msg_encaminhado, msg_negado")
    .eq("codigo", "supervisores").maybeSingle();
  if (!canalReal) return json({ error: "canal dos supervisores não encontrado (migration aplicada?)" }, 404);
  // Simula com o canal e a I.A LIGADOS — é para testar antes de ligar.
  const canal = { ...canalReal, ativo: true, ia_ativa: true } as CanalInfo;

  const status = b.status ?? "ia";
  const respostas: string[] = [];
  const historico = (Array.isArray(b.historico) ? b.historico.slice(-19) : [])
    .map((m) => ({ direcao: m.direcao, origem: m.origem, texto: String(m.texto ?? "") }));
  historico.push({ direcao: "entrada", origem: "contato", texto: tipo === "text" ? mensagem : `[${tipo}]` });

  let baseItens = 0;
  const portas: PortasAtendimento = {
    async preparar() {
      const { data, error } = await db.rpc("wa_atd_simular_identidade", { p_quem: quem, p_empregado: empregadoId });
      if (error) throw new Error(error.message);
      return { protocolo: "ATD-SIMULACAO", status, enviar_aviso: !!b.primeira, identificacao: data };
    },
    botAtivo: async () => status === "ia",
    historico: async () => historico,
    async regras() {
      const { data } = await db.from("WA_ATD_REGRA_DADO")
        .select("categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave").eq("ativo", true).order("ordem");
      return (data ?? null) as RegraDado[] | null;
    },
    async base() {
      let q = db.from("WA_ATD_BASE").select("titulo, conteudo, assunto").eq("ativo", true);
      if (!b.usar_pendentes) q = q.eq("aprovado", true);
      const { data } = await q.order("assunto").limit(200);
      baseItens = (data ?? []).length;
      return data ?? [];
    },
    async cfgIA() {
      const { data } = await db.from("WA_BOT_CONFIG").select("provedor, modelo, max_tokens").limit(1).maybeSingle();
      return data ?? null;
    },
    async consultar(categoria, alvo) {
      const { data, error } = await db.rpc("wa_atd_simular_consulta", {
        p_quem: quem, p_empregado: empregadoId, p_categoria: categoria, p_alvo: alvo,
      });
      if (error) return { autorizada: false, motivo: `erro: ${error.message}` };
      return data;
    },
    encaminhar: async () => {},
    marcar: async () => {},
    concluir: async () => {},
    enviar: async (t) => { respostas.push(t); },
  };

  try {
    const trilha = await conduzirAtendimento(portas, { msgType: tipo, texto: tipo === "text" ? mensagem : null, canal });
    return json({
      respostas, trilha,
      diagnostico: {
        canal_ativo_de_verdade: !!canalReal.ativo, ia_ativa_de_verdade: !!canalReal.ia_ativa,
        numero_configurado: !!canalReal.phone_number_id, base_itens: baseItens, usou_pendentes: !!b.usar_pendentes,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

interface Corpo {
  acao?: "simular" | "ping" | "atendimento";
  mensagem?: string;
  historico?: Msg[];
  reply_id?: string | null;      // clique numa opção do menu simulado
  modo?: ModoConversa;           // modo atual da conversa simulada (menu | ia)
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

  // SIS-2026-0929: simulador do atendimento dos supervisores (canal próprio).
  if (body.acao === "atendimento") return simularAtendimento(db, body as unknown as CorpoAtendimento);

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
  const modoAtual: ModoConversa = body.modo === "ia" ? "ia" : "menu";

  // Mesma decisão do atendimento real: o simulador só roda o reducer e traduz a
  // rota para o formato de bolha da tela — o modo volta para o cliente manter.
  const rota = rotearBot(cfg, {
    modo: modoAtual,
    texto: body.reply_id ? null : mensagem,
    replyId: body.reply_id ?? null,
    dentroHorario: noHorario || !!body.ignorar_horario,
  });

  switch (rota.tipo) {
    case "nada":
      return json({
        tipo: "nada",
        resposta: null,
        nota: "Nenhum menu configurado — o bot não responde nada. A IA só atende quando uma opção do menu leva a ela.",
        modo: rota.modo,
        diagnostico,
      });

    case "silencio":
      return json({
        tipo: "silencio",
        resposta: null,
        nota: "O menu já foi apresentado há pouco nesta conversa — o bot fica quieto em vez de repetir a saudação. Ajustável em 'Não repetir o menu por'.",
        modo: rota.modo,
        diagnostico,
      });

    case "fora_horario":
      return json({ tipo: "fora_horario", resposta: cfg.fora_horario_msg, modo: rota.modo, diagnostico });

    case "menu":
      // rota.menu já é o nível certo da cascata (raiz ou o submenu clicado).
      return json({
        tipo: "menu",
        resposta: (rota.menu.titulo && rota.menu.titulo.trim()) || TITULO_MENU_PADRAO,
        botoes: rota.menu.opcoes.slice(0, 10).map((o) => ({ id: String(o.id), titulo: String(o.titulo) })),
        formato: rota.menu.opcoes.length <= 3 ? "button" : "list",
        modo: rota.modo,
        diagnostico,
      });

    case "texto":
      return json({ tipo: "menu_texto", resposta: rota.texto, modo: rota.modo, diagnostico });

    case "humano":
      return json({
        tipo: "menu_humano",
        resposta: rota.aviso,
        nota: "O bot seria desligado nesta conversa e ela iria para atendimento humano.",
        modo: rota.modo,
        diagnostico,
      });

    case "transferir": {
      // Só consulta o nome da pasta para a nota ficar legível; nada é gravado.
      const { data: p } = await db.from("WA_PASTA").select("nome").eq("codigo", rota.pasta).maybeSingle();
      return json({
        tipo: "menu_transferir",
        resposta: rota.aviso,
        nota: `A conversa iria para a pasta ${p?.nome ?? rota.pasta} e o bot seria desligado — quem tem acesso a essa pasta assume o atendimento.`,
        modo: rota.modo,
        diagnostico,
      });
    }

    case "concluir":
      return json({
        tipo: "menu_concluir",
        resposta: rota.aviso,
        nota: "A conversa iria para a pasta Atendimento Concluído e o histórico registraria que foi o próprio contato quem encerrou.",
        modo: rota.modo,
        diagnostico,
      });

    case "ia_intro":
      return json({
        tipo: "menu_ia",
        resposta: rota.aviso,
        nota: "A partir daqui as mensagens seguem para a IA.",
        modo: rota.modo,
        diagnostico,
      });

    case "ia": {
      const primeiraFala = !historico.some((m) => m.role === "assistant");
      // Mesmas vagas e mesmas pastas que o atendimento real recebe — sem isso o
      // Testes aprovaria um prompt que na prática responde sobre vagas no escuro.
      const { data: vagas } = await db.rpc("wa_vagas_abertas");
      const { data: pastas } = await db.from("WA_PASTA")
        .select("codigo, nome").eq("ativo", true).neq("codigo", "atendimento_concluido").order("ordem");
      const pastasBot = (pastas ?? []) as PastaBot[];
      const system = montarSystem(
        cfg, base, primeiraFala,
        montarVagas((vagas ?? []) as any[]), montarPastas(pastasBot),
      );
      const messages: Msg[] = [...historico, { role: "user", content: mensagem }];
      const r = await gerarResposta(cfg, system, messages);
      // O simulador NÃO move pasta nenhuma (é simulação): só tira a marca do
      // texto e conta, na nota, para onde a conversa real teria ido.
      const { pasta, texto: limpo } = extrairTransferencia(
        r.texto ?? (cfg.fallback as string), pastasBot.map((p) => p.codigo),
      );
      const nomePasta = pastasBot.find((p) => p.codigo === pasta)?.nome ?? pasta;
      return json({
        tipo: r.erro ? "fallback" : "ia",
        resposta: (pasta ? (limpo || AVISO_TRANSFERIDO_IA) : limpo) || cfg.fallback,
        nota: pasta ? `No atendimento real a conversa iria para a pasta "${nomePasta}" e o bot seria desligado.` : undefined,
        system,                                   // prompt final, para inspeção
        modo: rota.modo,
        diagnostico: { ...diagnostico, ms: r.ms, erro: r.erro, vagas: (vagas ?? []).length },
      });
    }
  }
});
