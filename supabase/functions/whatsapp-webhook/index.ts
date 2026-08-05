// Arquivo: supabase/functions/whatsapp-webhook/index.ts
// Webhook da Meta WhatsApp Cloud API.
//   GET  → verificação do webhook (hub.challenge).
//   POST → recebe mensagens/status. Valida a assinatura X-Hub-Signature-256,
//          grava contato/conversa/mensagem (dedupe por wa_message_id) e, quando
//          o bot está ativo, gera a resposta com a IA (Claude) e envia de volta
//          pela Graph API. Responde 200 rápido; a resposta do bot roda em
//          segundo plano (EdgeRuntime.waitUntil).
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN,
//   WHATSAPP_PHONE_NUMBER_ID
//   + a chave do provedor de IA escolhido em WA_BOT_CONFIG.provedor:
//     groq → GROQ_API_KEY | gemini → GEMINI_API_KEY
//     openrouter → OPENROUTER_API_KEY | anthropic → ANTHROPIC_API_KEY
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  dentroDoHorario, montarBase, montarSystem, gerarResposta,
  rotearBot, inferirModo, acharOpcao, menuAtivo, retomadaDe, montarVagas,
  montarPastas, extrairTransferencia, AVISO_TRANSFERIDO_IA,
  type Msg, type MenuOpcao, type PastaBot,
} from "../_shared/whatsapp-bot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const GRAPH = "https://graph.facebook.com/v21.0";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---------- assinatura ----------
async function assinaturaValida(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true; // sem secret configurado → não bloqueia (dev)
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const esperado = header.slice("sha256=".length);
  // comparação em tempo ~constante
  if (hex.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

// ---------- envio ----------
async function enviarTexto(to: string, body: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Falha ao enviar WhatsApp:", JSON.stringify(data)); return null; }
  return data?.messages?.[0]?.id ?? null;
}

// ---------- resposta do bot (IA) ----------
// Recebe o cfg e o histórico já carregados por processarBot.
async function responderComBot(
  conversaId: string, contatoId: string, to: string, cfg: any,
  mensagens: Array<{ direcao: string; texto: string | null }>,
) {
  // Base de conhecimento.
  const { data: conh } = await admin.from("WA_BOT_CONHECIMENTO")
    .select("titulo, conteudo").eq("ativo", true).order("ordem");

  // Vagas abertas, lidas AGORA. Ficar na base de conhecimento não serviria:
  // aquilo é texto que alguém escreve à mão e envelhece; vaga fechada ontem
  // seria oferecida hoje.
  // O erro NÃO pode ser engolido: sem a lista a IA responde sobre vagas no
  // escuro e inventa cargo e salário — foi exatamente o que aconteceu quando
  // esta função rodou numa versão que ainda não buscava as vagas.
  const { data: vagas, error: erroVagas } = await admin.rpc("wa_vagas_abertas");
  if (erroVagas) console.error("Falha ao ler as vagas abertas:", erroVagas.message);

  // Pastas para onde a IA pode encaminhar. "atendimento_concluido" fica de fora
  // de propósito: encerrar não é transferir, e quem encerra é a pessoa pelo menu.
  const { data: pastas, error: erroPastas } = await admin.from("WA_PASTA")
    .select("codigo, nome").eq("ativo", true).neq("codigo", "atendimento_concluido").order("ordem");
  if (erroPastas) console.error("Falha ao ler as pastas:", erroPastas.message);
  const pastasBot = (pastas ?? []) as PastaBot[];

  const historico = mensagens.filter((m) => m.texto);
  // No fluxo normal a IA entra numa conversa que o menu já abriu, então não
  // cumprimenta de novo. `primeiraFala` só vale no caso de borda de menu vazio.
  const primeiraFala = !historico.some((m) => m.direcao === "saida");
  const system = montarSystem(
    cfg, montarBase(conh ?? []), primeiraFala,
    montarVagas((vagas ?? []) as any[]), montarPastas(pastasBot),
  );

  const messages: Msg[] = historico.map((m) => ({
    role: m.direcao === "entrada" ? "user" : "assistant",
    content: m.texto as string,
  }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return;

  const r = await gerarResposta(cfg, system, messages);
  if (r.erro) console.error(`Erro na IA (${r.provedor}/${r.modelo}):`, r.erro);

  // A IA pediu transferência? A marca sai do texto SEMPRE (mesmo com código
  // inválido, para a pessoa nunca lê-la) e a pasta só vem preenchida se existir.
  const { pasta, texto: limpo } = extrairTransferencia(
    r.texto ?? (cfg.fallback as string),
    pastasBot.map((p) => p.codigo),
  );

  if (!pasta) {
    await registrarSaida(conversaId, contatoId, to, limpo || (cfg.fallback as string), "bot");
    return;
  }

  // Move a conversa e desliga o bot: daqui em diante quem responde é gente.
  // Grava ANTES de avisar — se a mensagem falhar, a conversa já está na fila
  // certa; o contrário deixaria a pessoa achando que foi transferida sem ter ido.
  const { error: erroMover } = await admin.from("WA_CONVERSA")
    .update({ bot_ativo: false, pasta_codigo: pasta }).eq("id", conversaId);
  if (erroMover) {
    console.error("Falha ao mover a conversa de pasta:", erroMover.message);
    await registrarSaida(conversaId, contatoId, to, limpo || (cfg.fallback as string), "bot");
    return;
  }
  await registrarSaida(conversaId, contatoId, to, limpo || AVISO_TRANSFERIDO_IA, "bot");
}

// Envia e registra uma mensagem de saída (bot/atendente).
async function registrarSaida(conversaId: string, contatoId: string, to: string, texto: string, origem: string) {
  const waId = await enviarTexto(to, texto);
  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: contatoId, direcao: "saida", tipo: "text",
    texto, wa_message_id: waId, status: waId ? "enviada" : "erro", origem,
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: texto.slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversaId);
}

// Tenta RESERVAR o direito de apresentar o menu agora.
//
// Não pergunta "já mandei?" — carimba. O UPDATE só altera a linha se o último
// menu for antigo (ou inexistente), e um UPDATE é atômico: entre mensagens
// simultâneas, exatamente uma consegue atualizar e as outras voltam vazias.
// Perguntar antes e decidir depois é o que fazia o menu sair duas vezes
// quando alguém mandava três frases seguidas.
//
// Devolve true = pode enviar; false = alguém acabou de enviar (ou está
// enviando), então esta execução fica quieta.
async function reservarEnvioDoMenu(
  conversaId: string, cfg: { nao_repetir_menu_min?: number | null },
): Promise<boolean> {
  const min = Number(cfg.nao_repetir_menu_min ?? 0);
  const agora = new Date().toISOString();
  if (!Number.isFinite(min) || min <= 0) {
    // Anti-repetição desligado: sempre envia, mas mantém o carimbo em dia.
    await admin.from("WA_CONVERSA").update({ menu_enviado_em: agora }).eq("id", conversaId);
    return true;
  }
  const limite = new Date(Date.now() - min * 60_000).toISOString();
  const { data, error } = await admin.from("WA_CONVERSA")
    .update({ menu_enviado_em: agora })
    .eq("id", conversaId)
    .or(`menu_enviado_em.is.null,menu_enviado_em.lt.${limite}`)
    .select("id");
  // FALHA ABERTA. Quando a coluna menu_enviado_em não existia no banco, este
  // UPDATE dava erro, a função devolvia false e o bot ficava MUDO: 11 pessoas
  // escreveram e ninguém foi respondido. Repetir uma mensagem incomoda; não
  // responder um candidato é perder o candidato.
  if (error) { console.error("Reserva do menu falhou, enviando assim mesmo:", error.message); return true; }
  return (data ?? []).length > 0;
}

// Janela em que o MESMO botão clicado de novo é tratado como repetição. Dois
// toques acidentais acontecem em menos de 2 s; 10 s dá folga sem impedir quem
// realmente quer a resposta outra vez.
const JANELA_CLIQUE_S = 10;

// Mesma ideia da reserva do menu, para clique em opção. Sem isso, dois toques
// no mesmo botão viram duas mensagens distintas da Meta (wa_message_id
// diferente, então o dedupe por id não pega) e o bot responde duas vezes —
// inclusive executando duas vezes ações com efeito colateral, como transferir
// de pasta ou concluir o atendimento.
async function reservarCliqueDaOpcao(conversaId: string, replyId: string): Promise<boolean> {
  // O id vai cru num filtro do PostgREST; se vier fora do formato dos nossos
  // ids de menu, não arrisca a sintaxe do filtro — responde e segue.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(replyId)) return true;
  const agora = new Date().toISOString();
  const limite = new Date(Date.now() - JANELA_CLIQUE_S * 1000).toISOString();
  const { data, error } = await admin.from("WA_CONVERSA")
    .update({ ultima_opcao_id: replyId, ultima_opcao_em: agora })
    .eq("id", conversaId)
    .or(`ultima_opcao_id.is.null,ultima_opcao_id.neq.${replyId},ultima_opcao_em.is.null,ultima_opcao_em.lt.${limite}`)
    .select("id");
  if (error) { console.error("Reserva do clique falhou, respondendo assim mesmo:", error.message); return true; }
  return (data ?? []).length > 0;
}

// Agenda a cutucada da opção clicada. Uma pendente por conversa: a mais nova
// substitui a anterior, senão o fluxo em cascata empilharia várias.
async function agendarRetomada(
  conversaId: string, contatoId: string, opcao: MenuOpcao | null | undefined,
) {
  const r = retomadaDe(opcao);
  if (!r) return;
  const agora = new Date().toISOString();
  await admin.from("WA_RETOMADA")
    .update({ status: "cancelada", detalhe: "substituída por retomada mais nova", processada_em: agora })
    .eq("conversa_id", conversaId).eq("status", "pendente");
  await admin.from("WA_RETOMADA").insert({
    conversa_id: conversaId, contato_id: contatoId,
    opcao_id: opcao?.id ?? null, mensagem: r.mensagem,
    enviar_em: new Date(Date.now() + r.minutos * 60_000).toISOString(),
  });
}

// ---------- roteamento do bot (fluxo único guiado por menu) ----------
// Um único ponto de decisão por mensagem, via rotearBot: o menu abre toda
// conversa; a IA só assume depois que a pessoa clica na opção de atendimento por
// IA. O modo da conversa é reconstruído do histórico (inferirModo), então não
// precisa de coluna nova no banco.
async function processarBot(
  conversaId: string, contatoId: string, to: string,
  msgType: string, texto: string | null, replyId: string | null,
) {
  const { data: cfg } = await admin.from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
  if (!cfg || !cfg.ativo) return;

  // A pessoa respondeu: qualquer cutucada agendada perde o sentido.
  await admin.from("WA_RETOMADA")
    .update({ status: "cancelada", detalhe: "contato respondeu", processada_em: new Date().toISOString() })
    .eq("conversa_id", conversaId).eq("status", "pendente");

  // Histórico recente com payload — o payload guarda o reply_id de cada clique,
  // que é o que inferirModo usa para saber se a conversa já está na IA.
  const { data: hist } = await admin.from("WA_MENSAGEM")
    .select("direcao, texto, payload, tipo, criada_em").eq("conversa_id", conversaId)
    .order("criada_em", { ascending: false }).limit(20);
  const mensagens = (hist ?? []).reverse();

  const modo = inferirModo(cfg as any, mensagens as any);
  const rota = rotearBot(cfg as any, {
    modo,
    texto: msgType === "text" ? texto : null,
    replyId,
    dentroHorario: dentroDoHorario(cfg as any),
    // Sempre false aqui: quem decide se o menu se repete é a RESERVA atômica
    // no banco, logo abaixo. Este campo continua existindo para o simulador,
    // que roda sem concorrência e não tem banco para disputar.
    menuRecente: false,
  });

  // Opção que a pessoa acabou de clicar — é dela que sai a cutucada. Só faz
  // sentido enquanto o bot conduz: em "humano"/"transferir" um atendente
  // assume, e aí quem responde é gente.
  const menuCfg = menuAtivo(cfg as any);
  const opcaoClicada = replyId && menuCfg ? acharOpcao(menuCfg, replyId) : null;

  // Clique repetido no mesmo botão: uma execução atende, as outras calam.
  // Fica ANTES do switch para valer também para "humano", "transferir" e
  // "concluir" — repetir esses não é só uma mensagem a mais, é executar a
  // ação duas vezes.
  if (replyId && !(await reservarCliqueDaOpcao(conversaId, replyId))) return;

  switch (rota.tipo) {
    case "nada":
      // Sem menu configurado o bot não responde nada — nem IA, nem fallback.
      return;
    case "silencio":
      // Menu já apresentado há pouco: não repete a saudação.
      return;
    case "fora_horario":
      if (cfg.fora_horario_msg) await registrarSaida(conversaId, contatoId, to, cfg.fora_horario_msg, "bot");
      return;
    case "menu":
      // Menu vindo de TEXTO SOLTO passa pela reserva: se a pessoa mandou
      // várias frases seguidas, só a primeira execução envia. Clique em botão
      // é pedido explícito e sempre responde — inclusive submenu.
      if (!replyId && !(await reservarEnvioDoMenu(conversaId, cfg as any))) return;
      // rota.menu já é o nível certo da cascata (raiz ou submenu clicado).
      await enviarMenu(conversaId, contatoId, to, rota.menu, rota.imagem);
      await agendarRetomada(conversaId, contatoId, opcaoClicada);
      return;
    case "texto": {
      // Com imagem configurada, vira mensagem de mídia com o texto na legenda
      // (é assim que um passo a passo aparece no WhatsApp). Se o envio da
      // imagem falhar, cai no texto puro em vez de perder a resposta.
      const comImagem = rota.imagem
        ? await enviarImagemComLegenda(conversaId, contatoId, to, rota.texto, rota.imagem)
        : false;
      if (!comImagem) await registrarSaida(conversaId, contatoId, to, rota.texto, "bot");
      await agendarRetomada(conversaId, contatoId, opcaoClicada);
      return;
    }
    case "humano":
      // Passa a conversa para atendimento humano (desliga o bot) e avisa.
      await admin.from("WA_CONVERSA").update({ bot_ativo: false }).eq("id", conversaId);
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    case "transferir": {
      // Direciona para a fila do setor e passa para humano. A pasta é validada
      // contra WA_PASTA: config apontando para pasta apagada não pode largar a
      // conversa num limbo (fila inexistente + bot desligado = ninguém atende).
      const { data: pasta } = await admin.from("WA_PASTA")
        .select("codigo").eq("codigo", rota.pasta).eq("ativo", true).maybeSingle();
      await admin.from("WA_CONVERSA")
        .update({ bot_ativo: false, pasta_codigo: pasta?.codigo ?? null })
        .eq("id", conversaId);
      if (!pasta) console.error("Opção do menu aponta para pasta inexistente:", rota.pasta);
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    }
    case "concluir": {
      // A própria pessoa encerrou. `concluida_por_contato` é o que diz ao
      // trigger que NÃO foi atendente: aqui roda com service_role, então
      // auth.uid() é null e sozinho isso não distinguiria de um UPDATE manual.
      await admin.from("WA_CONVERSA")
        .update({ pasta_codigo: "atendimento_concluido", concluida_por_contato: true, bot_ativo: true })
        .eq("id", conversaId);
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    }
    case "ia_intro":
      // Entrou na IA: manda o aviso; as próximas mensagens caem na IA.
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    case "ia":
      await responderComBot(conversaId, contatoId, to, cfg, mensagens);
      return;
  }
}

// Envia uma mensagem interativa (botões/lista) pela Graph API.
async function enviarInterativo(to: string, interactive: any): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "interactive", interactive }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Falha ao enviar interativo:", JSON.stringify(data)); return null; }
  return data?.messages?.[0]?.id ?? null;
}

// Monta e envia o menu: até 3 opções viram botões; 4–10 viram lista.
// URL temporária da imagem configurada no menu. A Meta busca o arquivo na
// hora do envio, então não precisa subir mídia a cada mensagem — e o bucket
// continua privado, porque a URL assinada expira sozinha.
async function urlDaImagem(imagem: any): Promise<string | null> {
  const caminho = String(imagem?.storage_path ?? "").trim();
  if (!caminho) return null;
  const { data } = await admin.storage.from("whatsapp-midia").createSignedUrl(caminho, 600);
  return data?.signedUrl ?? null;
}

// Resposta de texto com imagem: a imagem vai como mensagem de mídia e o texto
// como legenda, numa mensagem só (é como o WhatsApp mostra um passo a passo).
async function enviarImagemComLegenda(
  conversaId: string, contatoId: string, to: string, legenda: string, imagem: any,
): Promise<boolean> {
  const link = await urlDaImagem(imagem);
  if (!link) return false;
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "image",
      image: { link, ...(legenda ? { caption: legenda.slice(0, 1024) } : {}) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Falha ao enviar imagem do menu:", JSON.stringify(data)); return false; }
  const waId = data?.messages?.[0]?.id ?? null;

  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: contatoId, direcao: "saida", tipo: "image",
    texto: legenda, wa_message_id: waId, status: waId ? "enviada" : "erro", origem: "bot",
    payload: { midia: { tipo: "image", storage_path: imagem.storage_path, mime_type: imagem.mime_type ?? "image/jpeg", status: "pronto" } },
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: (legenda || "[imagem]").slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversaId);
  return true;
}

async function enviarMenu(conversaId: string, contatoId: string, to: string, menu: any, imagem?: any) {
  const opcoes = (menu.opcoes as any[]).slice(0, 10);
  // O corpo pode ser a RESPOSTA de uma opção (resposta com botões), não só o
  // título de um menu — e resposta é texto livre. A Cloud API recusa body acima
  // de 1024 caracteres, e a recusa derrubaria a mensagem inteira.
  const corpo: string = ((menu.titulo && String(menu.titulo).trim()) || "Como posso te ajudar?").slice(0, 1024);
  // Imagem só cabe como cabeçalho no formato de BOTÕES; a lista não aceita
  // header de mídia. Com lista, a imagem vai antes, em mensagem separada.
  const linkImagem = imagem ? await urlDaImagem(imagem) : null;
  if (linkImagem && opcoes.length > 3) {
    await enviarImagemComLegenda(conversaId, contatoId, to, "", imagem);
  }

  const interactive = opcoes.length <= 3
    ? {
        type: "button",
        ...(linkImagem ? { header: { type: "image", image: { link: linkImagem } } } : {}),
        body: { text: corpo },
        action: { buttons: opcoes.map((o) => ({ type: "reply", reply: { id: String(o.id), title: String(o.titulo).slice(0, 20) } })) },
      }
    : {
        type: "list",
        body: { text: corpo },
        action: {
          button: "Ver opções",
          sections: [{ title: "Opções", rows: opcoes.map((o) => ({ id: String(o.id), title: String(o.titulo).slice(0, 24) })) }],
        },
      };
  const waId = await enviarInterativo(to, interactive);
  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: contatoId, direcao: "saida", tipo: "interactive",
    texto: corpo, wa_message_id: waId, status: waId ? "enviada" : "erro", origem: "bot",
    payload: { tipo: opcoes.length <= 3 ? "button" : "list", botoes: opcoes.map((o) => ({ id: String(o.id), titulo: String(o.titulo) })) },
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: corpo.slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversaId);
}

// ---------- mídia recebida ----------
// Baixa uma mídia da Cloud API (via media id) e sobe pro bucket privado
// 'whatsapp-midia'. Retorna o caminho salvo + mime + tamanho.
async function salvarMidiaWhatsApp(
  mediaId: string, mimeHint: string | null,
): Promise<{ storage_path: string; mime_type: string; tamanho: number | null } | null> {
  // 1) URL temporária da mídia.
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  const meta: any = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta?.url) { console.error("Falha ao obter URL da mídia:", JSON.stringify(meta)); return null; }
  // 2) baixa o binário (a URL da Graph exige o token).
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  if (!fileRes.ok) { console.error("Falha ao baixar mídia:", fileRes.status); return null; }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  const mime = meta.mime_type || mimeHint || "application/octet-stream";
  const path = `wa/${mediaId}`;
  // 3) sobe pro Storage (service_role bypassa RLS).
  const { error } = await admin.storage.from("whatsapp-midia").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) { console.error("Falha ao subir mídia:", error.message); return null; }
  return { storage_path: path, mime_type: mime, tamanho: meta.file_size ? Number(meta.file_size) : bytes.length };
}

// Baixa a mídia e atualiza o payload da mensagem (status pronto/erro),
// preservando o que já estava no payload.
async function processarMidia(mensagemId: string, midia: any) {
  const salvo = await salvarMidiaWhatsApp(midia.media_id, midia.mime_type);
  const midiaAtualizada = salvo
    ? { ...midia, storage_path: salvo.storage_path, mime_type: salvo.mime_type, tamanho: salvo.tamanho, status: "pronto" }
    : { ...midia, status: "erro" };
  const { data: atual } = await admin.from("WA_MENSAGEM").select("payload").eq("id", mensagemId).maybeSingle();
  const merged = { ...((atual?.payload as Record<string, unknown>) ?? {}), midia: midiaAtualizada };
  await admin.from("WA_MENSAGEM").update({ payload: merged }).eq("id", mensagemId);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook (configuração na Meta).
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await assinaturaValida(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const tarefas: Promise<unknown>[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const nomeContato = value.contacts?.[0]?.profile?.name ?? null;
      // Número do próprio negócio (vem no metadata do webhook). Usado para
      // ignorar "echo": mensagem enviada pelo próprio número que a Meta
      // devolve no webhook — sem este filtro ela seria gravada como se fosse
      // o CONTATO falando (mensagem duplicada na caixa de entrada).
      const numeroProprio = String(value.metadata?.display_phone_number ?? "").replace(/\D/g, "");

      // Mensagens recebidas.
      for (const msg of value.messages ?? []) {
        const from: string = msg.from;
        if (numeroProprio && String(from ?? "").replace(/\D/g, "") === numeroProprio) continue;

        // Reação: não é mensagem nova, é um adorno na mensagem existente. Sem
        // este desvio ela cairia no insert genérico como bolha sem texto.
        // Emoji vazio = a pessoa removeu a reação.
        if (msg.type === "reaction") {
          const alvo = String(msg.reaction?.message_id ?? "");
          const emoji = String(msg.reaction?.emoji ?? "").trim();
          if (alvo) {
            const { data: alvoMsg } = await admin.from("WA_MENSAGEM")
              .select("id, payload").eq("wa_message_id", alvo).maybeSingle();
            if (alvoMsg) {
              await admin.from("WA_MENSAGEM").update({
                payload: {
                  ...(alvoMsg.payload ?? {}),
                  reacoes: { ...(alvoMsg.payload?.reacoes ?? {}), deles: emoji || null },
                },
              }).eq("id", alvoMsg.id);
            } else {
              console.error("Reação para mensagem desconhecida:", alvo);
            }
          }
          continue;
        }
        const texto: string | null =
          msg.type === "text" ? msg.text?.body ?? null
          : msg.type === "button" ? msg.button?.text ?? null
          : msg.type === "interactive" ? (msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null)
          : null;
        // id do botão/opção clicado (payload da resposta interativa).
        const replyId: string | null = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? null;

        // Mídia recebida (documento/imagem/áudio/vídeo/sticker): guarda os
        // metadados; o arquivo é baixado em segundo plano e salvo no Storage.
        const MIDIA_TIPOS = ["image", "document", "audio", "video", "sticker"];
        const midiaMsg = MIDIA_TIPOS.includes(msg.type) ? (msg[msg.type] ?? {}) : null;
        const midia = midiaMsg && midiaMsg.id ? {
          tipo: String(msg.type),
          media_id: String(midiaMsg.id),
          filename: midiaMsg.filename ?? null,
          mime_type: midiaMsg.mime_type ?? null,
          caption: midiaMsg.caption ?? null,
          status: "baixando",
        } : null;

        // contato (upsert por wa_id). Só grava o nome quando a Meta mandou o
        // profile.name; se vier sem contacts (comum em mensagens seguintes),
        // preserva o nome já salvo em vez de sobrescrever com null.
        const contatoUpsert: Record<string, unknown> = { wa_id: from, telefone: from };
        if (nomeContato) contatoUpsert.nome = nomeContato;
        await admin.from("WA_CONTATO").upsert(
          contatoUpsert,
          { onConflict: "wa_id", ignoreDuplicates: false },
        );
        const { data: contato } = await admin.from("WA_CONTATO").select("id").eq("wa_id", from).maybeSingle();
        if (!contato) continue;

        // conversa (upsert por contato)
        await admin.from("WA_CONVERSA").upsert(
          { contato_id: contato.id }, { onConflict: "contato_id", ignoreDuplicates: true },
        );
        const { data: conversa } = await admin.from("WA_CONVERSA").select("id, bot_ativo").eq("contato_id", contato.id).maybeSingle();
        if (!conversa) continue;

        // dedupe: só processa se a mensagem é nova. Só inclui `payload` quando
        // há clique de botão, para não depender da coluna antes da migration.
        const textoFinal = texto ?? midia?.caption ?? `[${msg.type}]`;
        const payloadEntrada: Record<string, unknown> = {};
        if (replyId) payloadEntrada.reply_id = replyId;
        if (midia) payloadEntrada.midia = midia;
        const entradaRow: Record<string, unknown> = {
          conversa_id: conversa.id, contato_id: contato.id, direcao: "entrada",
          tipo: msg.type ?? "text", texto: textoFinal,
          wa_message_id: msg.id, status: "recebida", origem: "contato",
        };
        if (Object.keys(payloadEntrada).length) entradaRow.payload = payloadEntrada;
        const { data: nova, error: insErr } = await admin.from("WA_MENSAGEM").insert(entradaRow).select("id").maybeSingle();
        if (!nova) {
          // 23505 = wa_message_id repetido (reentrega da Meta) → ignorar é certo.
          // Qualquer OUTRO erro era engolido aqui e a mensagem sumia sem rastro
          // (sintoma: "mandei um PDF e não chegou"). Agora fica no log.
          if (insErr && insErr.code !== "23505") {
            console.error("Mensagem recebida NÃO gravada:", JSON.stringify(insErr), "| tipo:", msg.type, "| wa_message_id:", msg.id);
          }
          continue;
        }

        // Baixa o arquivo em segundo plano e atualiza a mensagem com o caminho.
        if (midia) tarefas.push(processarMidia(nova.id, midia));

        try { await admin.rpc("wa_incrementar_nao_lidas", { p_conversa: conversa.id }); } catch { /* best-effort */ }
        await admin.from("WA_CONVERSA").update({
          ultima_mensagem_em: new Date().toISOString(),
          ultima_mensagem_preview: textoFinal.slice(0, 120),
          ultima_direcao: "entrada",
        }).eq("id", conversa.id);

        // resposta do bot em segundo plano (não segura o 200). Trata texto livre
        // e clique em botão/lista (menu automático).
        if (conversa.bot_ativo && ((msg.type === "text" && texto) || (msg.type === "interactive" && replyId))) {
          tarefas.push(processarBot(conversa.id, contato.id, from, msg.type, texto, replyId));
        }
      }

      // Status de mensagens enviadas. Em `failed` a Meta diz POR QUE falhou em
      // st.errors — quase sempre a janela de 24h (código 131047: só template
      // fora dela). Guardar isso no payload é o que separa um "erro" mudo de
      // uma explicação acionável na Caixa de Entrada.
      for (const st of value.statuses ?? []) {
        const mapa: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "erro" };
        const novo = mapa[st.status];
        if (!novo || !st.id) continue;

        const patch: Record<string, unknown> = { status: novo };
        const err = Array.isArray(st.errors) ? st.errors[0] : null;
        if (novo === "erro" && err) {
          const { data: atual } = await admin.from("WA_MENSAGEM")
            .select("payload").eq("wa_message_id", st.id).maybeSingle();
          patch.payload = {
            ...(atual?.payload ?? {}),
            erro: {
              codigo: err.code ?? null,
              titulo: err.title ?? null,
              detalhe: err.error_data?.details ?? err.message ?? null,
            },
          };
        }
        await admin.from("WA_MENSAGEM").update(patch).eq("wa_message_id", st.id);
      }
    }
  }

  // processa o bot depois de responder 200 (best-effort)
  // @ts-ignore EdgeRuntime existe no runtime da Supabase
  if (typeof EdgeRuntime !== "undefined" && tarefas.length) {
    // @ts-ignore
    EdgeRuntime.waitUntil(Promise.allSettled(tarefas));
  } else {
    await Promise.allSettled(tarefas);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
