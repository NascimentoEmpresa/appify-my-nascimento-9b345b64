// Arquivo: supabase/functions/whatsapp-webhook/atendimento.ts
//
// SIS-2026-0929 — o que o webhook faz quando a mensagem chega no canal de
// atendimento dos supervisores (WA_CANAL.finalidade = 'atendimento_supervisores').
// O canal principal (recrutamento) continua no processarBot de index.ts,
// intocado.
//
// Ordem de cada mensagem recebida:
//   1. wa_atd_preparar — o protocolo já foi aberto pelo trigger do banco ao
//      gravar a mensagem; aqui identifica quem escreve (número × cadastro
//      atual), liga contrato/responsável e reserva o aviso de abertura.
//   2. aviso de abertura (I.A + LGPD + protocolo), uma vez por protocolo.
//   3. Se o protocolo não está com a I.A (pessoa assumiu, aguardando humano,
//      canal/IA desligados, bot da conversa desligado) → não responde nada.
//   4. Regras determinísticas antes do modelo: arquivo/áudio → humano;
//      pedido de pessoa → humano.
//   5. I.A com a base APROVADA. Ela pode pedir [[CONSULTAR]] (o banco decide
//      e a resposta com o dado é montada pelo código), [[HUMANO]] ou
//      [[RESOLVIDO]]. Erro do provedor → humano. Saída com cara de dado
//      sensível → bloqueada e humano.
//
// Na dúvida, SEMPRE passa para humano: é o único erro barato deste fluxo.

import {
  aplicarProtocolo, detectarSensiveis, extrairAcoes, formatarDadosConsulta,
  montarSystemAtendimento, pareceDadoSensivel, pediuHumano, resumoDeterministico,
  AVISO_ABERTURA_PADRAO, MSG_ENCAMINHADO_PADRAO, MSG_MIDIA_PADRAO, MSG_NEGADO_PADRAO,
  REGRAS_PADRAO, type RegraDado,
} from "../_shared/whatsapp-atendimento.ts";
import { gerarResposta, type BotConfig, type Msg } from "../_shared/whatsapp-bot.ts";
import type { CanalInfo } from "../_shared/whatsapp-canal.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface DepsAtendimento {
  admin: Db;
  // Envia texto pelo número do canal e grava em WA_MENSAGEM (origem 'bot').
  enviar: (texto: string) => Promise<void>;
}

const AVISO_SEM_IA =
  "Olá! Este é o atendimento corporativo dos supervisores do Grupo Nascimento. Recebemos sua mensagem e uma pessoa da equipe vai te responder por aqui. " +
  "As mensagens ficam registradas no sistema da empresa e são usadas apenas para este atendimento, conforme a LGPD. Seu protocolo é {protocolo}.";

export async function processarAtendimento(
  deps: DepsAtendimento,
  args: { conversaId: string; waId: string; msgType: string; texto: string | null; canal: CanalInfo },
): Promise<void> {
  const { admin, enviar } = deps;
  const { conversaId, waId, msgType, texto, canal } = args;

  const { data: prep, error: erroPrep } = await admin.rpc("wa_atd_preparar", { p_conversa: conversaId, p_wa_id: waId });
  if (erroPrep || !prep?.atendimento_id) {
    // Sem protocolo não há como registrar autorização: não responde nada
    // automaticamente. A mensagem já está gravada e aparece na Caixa de Entrada.
    if (erroPrep) console.error("wa_atd_preparar falhou:", erroPrep.message);
    return;
  }
  const atd: string = prep.atendimento_id;
  const protocolo: string = prep.protocolo;
  const comIA = canal.ativo && canal.ia_ativa;

  if (prep.enviar_aviso) {
    const modelo = comIA ? (canal.aviso_abertura || AVISO_ABERTURA_PADRAO) : AVISO_SEM_IA;
    await enviar(aplicarProtocolo(modelo, protocolo));
  }

  // O protocolo e a conversa precisam estar com a I.A.
  if (!comIA || prep.status !== "ia") return;
  const { data: conv } = await admin.from("WA_CONVERSA").select("bot_ativo").eq("id", conversaId).maybeSingle();
  if (!conv?.bot_ativo) return;

  const msgEncaminhado = aplicarProtocolo(canal.msg_encaminhado || MSG_ENCAMINHADO_PADRAO, protocolo);
  const msgNegado = aplicarProtocolo(canal.msg_negado || MSG_NEGADO_PADRAO, protocolo);

  // Histórico DESTE protocolo (o anterior já foi concluído; não entra no contexto).
  const { data: hist } = await admin.from("WA_MENSAGEM")
    .select("direcao, origem, texto, criada_em").eq("atendimento_id", atd)
    .order("criada_em", { ascending: false }).limit(20);
  const mensagens = ((hist ?? []) as Array<{ direcao: string; origem: string; texto: string | null }>).reverse();

  const encaminhar = async (motivo: string, resumo: string, aviso: string, assunto?: string | null, sensivel = false) => {
    const { error } = await admin.rpc("wa_atd_bot_encaminhar", {
      p_atendimento: atd, p_motivo: motivo, p_resumo: resumo, p_assunto: assunto ?? null, p_sensivel: sensivel,
    });
    if (error) console.error("wa_atd_bot_encaminhar falhou:", error.message);
    await enviar(aviso);
  };

  // 4a) Arquivo, imagem, áudio: pode ser um atestado. Não passa por I.A.
  const ehTexto = msgType === "text" || msgType === "button" || msgType === "interactive";
  if (!ehTexto || !texto) {
    await encaminhar("midia_recebida", resumoDeterministico(mensagens, "A pessoa enviou arquivo/áudio/imagem"),
      aplicarProtocolo(MSG_MIDIA_PADRAO, protocolo), "arquivo", true);
    return;
  }

  // 4b) Pediu uma pessoa.
  if (pediuHumano(texto)) {
    await encaminhar("pediu_humano", resumoDeterministico(mensagens, "A pessoa pediu atendimento humano"), msgEncaminhado);
    return;
  }

  // Regras de dado: do banco; sem resposta, o padrão do código (fechado).
  const { data: regrasDb } = await admin.from("WA_ATD_REGRA_DADO")
    .select("categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave").eq("ativo", true).order("ordem");
  const regras: RegraDado[] = (regrasDb && regrasDb.length ? regrasDb : REGRAS_PADRAO) as RegraDado[];

  const sensiveis = detectarSensiveis(texto, regras);
  if (sensiveis.length) {
    await admin.rpc("wa_atd_bot_marcar", { p_atendimento: atd, p_assunto: sensiveis[0], p_sensivel: true });
  }

  // Base aprovada.
  const { data: base } = await admin.from("WA_ATD_BASE")
    .select("titulo, conteudo, assunto").eq("ativo", true).eq("aprovado", true).order("assunto").limit(200);

  // Provedor/modelo: do canal; vazio = o do bot principal (WA_BOT_CONFIG).
  const { data: botCfg } = await admin.from("WA_BOT_CONFIG").select("provedor, modelo, max_tokens").limit(1).maybeSingle();
  const cfg = {
    provedor: canal.provedor || botCfg?.provedor || "groq",
    modelo: canal.modelo || botCfg?.modelo || "",
    max_tokens: canal.max_tokens || 600,
  } as BotConfig;

  const ident = prep.identificacao ?? { papel: "desconhecido", primeiro_nome: null };
  const system = montarSystemAtendimento({
    persona: canal.persona,
    base: (base ?? []) as Array<{ titulo: string; conteudo: string; assunto: string | null }>,
    regras,
    identificacao: { papel: ident.papel, primeiro_nome: ident.primeiro_nome ?? null },
    sensiveisDetectados: sensiveis,
    protocolo,
  });

  const conversa: Msg[] = mensagens
    .filter((m) => m.texto && (m.direcao === "entrada" || m.origem === "bot" || m.origem === "atendente"))
    .map((m) => ({ role: m.direcao === "entrada" ? "user" : "assistant", content: String(m.texto) }));
  if (!conversa.length || conversa[conversa.length - 1].role !== "user") return;

  const r = await gerarResposta(cfg, system, conversa);
  if (r.erro || !r.texto) {
    console.error(`Erro na IA do atendimento (${r.provedor}/${r.modelo}):`, r.erro);
    await encaminhar("falha_ia", resumoDeterministico(mensagens, "A I.A não conseguiu responder"), msgEncaminhado);
    return;
  }

  const acoes = extrairAcoes(r.texto);

  // 5a) Pedido de dado: quem decide é o banco; o texto sai daqui.
  if (acoes.consulta) {
    const { data: res, error } = await admin.rpc("wa_atd_consultar", {
      p_atendimento: atd, p_wa_id: waId, p_categoria: acoes.consulta.categoria, p_alvo: acoes.consulta.alvo,
    });
    if (error || !res?.autorizada) {
      if (error) console.error("wa_atd_consultar falhou:", error.message);
      // MESMA mensagem para qualquer negativa: não confirma se a pessoa existe.
      await encaminhar(`consulta_negada:${res?.motivo ?? "erro"}`,
        resumoDeterministico(mensagens, `Pedido de informação (${acoes.consulta.categoria}) não autorizado automaticamente`),
        msgNegado, acoes.consulta.categoria);
      return;
    }
    await admin.rpc("wa_atd_bot_marcar", { p_atendimento: atd, p_assunto: acoes.consulta.categoria, p_sensivel: false });
    await enviar(formatarDadosConsulta(acoes.consulta.categoria, res.dados, !!res.proprio));
    return;
  }

  // Barreira de saída.
  if (pareceDadoSensivel(acoes.texto)) {
    await encaminhar("saida_bloqueada", resumoDeterministico(mensagens, "Resposta da I.A bloqueada (parecia conter dado sensível)"),
      msgEncaminhado, null, true);
    return;
  }

  if (acoes.humano) {
    await encaminhar("ia_encaminhou",
      acoes.humano.resumo || resumoDeterministico(mensagens, "A I.A encaminhou"),
      acoes.texto || msgEncaminhado);
    return;
  }

  if (acoes.texto) await enviar(acoes.texto);
  if (acoes.resolvido) {
    const { error } = await admin.rpc("wa_atd_bot_concluir", { p_atendimento: atd });
    if (error) console.error("wa_atd_bot_concluir falhou:", error.message);
  }
}
