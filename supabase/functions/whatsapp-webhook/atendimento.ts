// Arquivo: supabase/functions/whatsapp-webhook/atendimento.ts
//
// SIS-2026-0929 — portas REAIS do atendimento dos supervisores: banco com
// service_role e envio pelo WhatsApp. O fluxo em si (conduzirAtendimento) mora
// em _shared/whatsapp-atendimento-fluxo.ts e é o mesmo que o simulador de
// WhatsApp › Testes (whatsapp-testar) roda com portas que não gravam nada.

import type { RegraDado } from "../_shared/whatsapp-atendimento.ts";
import type { CanalInfo } from "../_shared/whatsapp-canal.ts";
import {
  conduzirAtendimento, type PortasAtendimento, type Preparo, type ResultadoConsulta, type Trilha,
} from "../_shared/whatsapp-atendimento-fluxo.ts";

export { conduzirAtendimento };

// deno-lint-ignore no-explicit-any
type Db = any;

export interface DepsAtendimento {
  admin: Db;
  // Envia texto pelo número do canal e grava em WA_MENSAGEM (origem 'bot').
  enviar: (texto: string) => Promise<void>;
}

export async function processarAtendimento(
  deps: DepsAtendimento,
  args: { conversaId: string; waId: string; msgType: string; texto: string | null; canal: CanalInfo },
): Promise<Trilha> {
  const { admin, enviar } = deps;
  const { conversaId, waId } = args;
  let atd: string | null = null;
  const loga = (oq: string) => ({ error }: { error: { message: string } | null }) => { if (error) console.error(`${oq} falhou:`, error.message); };

  const portas: PortasAtendimento = {
    async preparar() {
      const { data, error } = await admin.rpc("wa_atd_preparar", { p_conversa: conversaId, p_wa_id: waId });
      if (error) console.error("wa_atd_preparar falhou:", error.message);
      if (error || !data?.atendimento_id) return null;
      atd = data.atendimento_id;
      return data as Preparo;
    },
    async botAtivo() {
      const { data } = await admin.from("WA_CONVERSA").select("bot_ativo").eq("id", conversaId).maybeSingle();
      return !!data?.bot_ativo;
    },
    async historico() {
      // Só DESTE protocolo (o anterior já foi concluído; não entra no contexto).
      const { data } = await admin.from("WA_MENSAGEM")
        .select("direcao, origem, texto, criada_em").eq("atendimento_id", atd)
        .order("criada_em", { ascending: false }).limit(20);
      return ((data ?? []) as Array<{ direcao: string; origem: string; texto: string | null }>).reverse();
    },
    async regras() {
      const { data } = await admin.from("WA_ATD_REGRA_DADO")
        .select("categoria, nome, sensivel, proprio, encarregado, supervisor, palavras_chave").eq("ativo", true).order("ordem");
      return (data ?? null) as RegraDado[] | null;
    },
    async base() {
      const { data } = await admin.from("WA_ATD_BASE")
        .select("titulo, conteudo, assunto").eq("ativo", true).eq("aprovado", true).order("assunto").limit(200);
      return (data ?? []) as Array<{ titulo: string; conteudo: string; assunto: string | null }>;
    },
    async cfgIA() {
      const { data } = await admin.from("WA_BOT_CONFIG").select("provedor, modelo, max_tokens").limit(1).maybeSingle();
      return data ?? null;
    },
    async consultar(categoria, alvo) {
      const { data, error } = await admin.rpc("wa_atd_consultar", {
        p_atendimento: atd, p_wa_id: waId, p_categoria: categoria, p_alvo: alvo,
      });
      if (error) { console.error("wa_atd_consultar falhou:", error.message); return null; }
      return data as ResultadoConsulta;
    },
    async encaminhar(motivo, resumo, assunto, sensivel) {
      loga("wa_atd_bot_encaminhar")(await admin.rpc("wa_atd_bot_encaminhar", {
        p_atendimento: atd, p_motivo: motivo, p_resumo: resumo, p_assunto: assunto, p_sensivel: sensivel,
      }));
    },
    async marcar(assunto, sensivel) {
      loga("wa_atd_bot_marcar")(await admin.rpc("wa_atd_bot_marcar", { p_atendimento: atd, p_assunto: assunto, p_sensivel: sensivel }));
    },
    async concluir() {
      loga("wa_atd_bot_concluir")(await admin.rpc("wa_atd_bot_concluir", { p_atendimento: atd }));
    },
    enviar,
  };
  return conduzirAtendimento(portas, args);
}
