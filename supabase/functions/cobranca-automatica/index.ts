import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarEmail } from "../_shared/enviar-email.ts";
import {
  TEMPLATE_DA_FAIXA, copiaDoEmail, dentroDaJanela, garantirEnvioPermitido, hojeEmSaoPaulo, montarEmail, planejarCobrancas, somarDias,
  PRAZO_PAGAMENTO_DIAS, type ConfigCobranca, type NotaAberta, type PlanoContrato,
} from "../_shared/cobranca-automatica.ts";

// SIS-2026-0653: cobrança automática a partir do Relatório de Serviços. As regras (faixas, o que é judicial, cadência,
// texto) estão em ../_shared/cobranca-automatica.ts, com testes. Aqui só entram banco, janela de horário e envio.
//
// Duas entradas:
//   • worker (a cada hora, com a chave de serviço): age conforme `cobranca_auto_config.modo`
//       desligado/simulacao → não faz nada;  piloto → envia TUDO para `email_piloto`;  producao → envia aos tomadores.
//   • tela Cobranças > Automação (JWT do usuário): { acao: "simular" } e { acao: "previa", contrato_id } — só leitura,
//     nunca envia e nunca grava.
// Faixa roxa/preta jamais é enviada: `garantirEnvioPermitido` recusa antes do envio e o banco recusa o registro.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Config extends ConfigCobranca {
  modo: "desligado" | "simulacao" | "piloto" | "producao";
  email_piloto: string | null;
  cc_fixo: string[];
  assinatura_html: string;
  somente_dias_uteis: boolean;
  hora_inicio: number;
  hora_fim: number;
  limite_por_execucao: number;
}

// PostgREST devolve no máximo 1000 linhas por chamada: lê em páginas.
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}

async function carregarEntrada(admin: SupabaseClient, config: Config, agora: Date) {
  const hoje = hojeEmSaoPaulo(agora);
  // Só nota que já chegou na janela do aviso pode entrar: emissão até (30 − aviso_dias_antes) dias atrás.
  const limiteEmissao = somarDias(hoje, -(PRAZO_PAGAMENTO_DIAS - config.aviso_dias_antes));

  const nfs = await lerTudo<any>((de, ate) =>
    admin.from("nf_emissao")
      .select("id, contrato_id, numero_nf, competencia, data_emissao, vlr_liquido_total, valor_pago, situacao_site_pmt, situacao_dominio")
      .is("deleted_at", null).eq("status", "concluida").is("data_pagamento", null)
      .not("data_emissao", "is", null).lte("data_emissao", limiteEmissao)
      .order("id").range(de, ate));

  const notas: NotaAberta[] = [];
  for (const n of nfs) {
    const sit = [n.situacao_site_pmt, n.situacao_dominio].map((s: string | null) => (s ?? "").toUpperCase());
    if (sit.includes("CANCELADA") || sit.includes("SUBSTITUIDA")) continue;
    const valor = Math.round(((n.vlr_liquido_total || 0) - (n.valor_pago || 0)) * 100) / 100;
    if (valor <= 0.005) continue;
    notas.push({ id: n.id, numero: n.numero_nf ?? "s/n", contratoId: n.contrato_id, dataEmissao: n.data_emissao, competencia: n.competencia, valor });
  }

  const [contratosRows, empresasRows, emailsRows, manualRows] = await Promise.all([
    lerTudo<any>((de, ate) => admin.from("contratos").select("id, nome, empresa_id").order("id").range(de, ate)),
    lerTudo<any>((de, ate) => admin.from("empresas").select("id, codigo").order("id").range(de, ate)),
    lerTudo<any>((de, ate) => admin.from("contrato_email_cobranca").select("contrato_id, email").order("id").range(de, ate)),
    lerTudo<any>((de, ate) => admin.from("cobranca_auto_contrato_manual").select("contrato_id").order("contrato_id").range(de, ate)),
  ]);

  // A cadência olha só os envios do mesmo modo: o piloto não "gasta" a primeira cobrança de produção.
  const modoHistorico = config.modo === "piloto" ? "piloto" : "producao";
  const desde = new Date(agora.getTime() - 200 * 86_400_000).toISOString();
  const envios = await lerTudo<any>((de, ate) =>
    admin.from("cobranca_auto_envio").select("id, contrato_id, faixa, criado_em")
      .eq("status", "enviado").eq("modo", modoHistorico).gte("criado_em", desde).order("id").range(de, ate));

  const codigoPorEmpresa = new Map(empresasRows.map((e: any) => [e.id, e.codigo as string]));
  const emailsPorContrato = new Map<string, string[]>();
  for (const e of emailsRows) {
    const lista = emailsPorContrato.get(e.contrato_id) ?? [];
    if (e.email && !lista.includes(e.email)) lista.push(e.email);
    emailsPorContrato.set(e.contrato_id, lista);
  }

  return {
    notas,
    contratos: new Map(contratosRows.map((c: any) => [c.id, { id: c.id, nome: c.nome, empresaCodigo: codigoPorEmpresa.get(c.empresa_id) ?? "" }])),
    emailsPorContrato,
    contratosSoManual: new Set<string>(manualRows.map((m: any) => m.contrato_id)),
    enviosAnteriores: envios.map((e: any) => ({ contratoId: e.contrato_id, faixa: e.faixa, enviadoEm: e.criado_em })),
    config: { intervalo_dias: config.intervalo_dias, aviso_dias_antes: config.aviso_dias_antes },
    agora,
  };
}

async function lerConfig(admin: SupabaseClient): Promise<Config> {
  const { data, error } = await admin.from("cobranca_auto_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Configuração da cobrança automática não encontrada.");
  return data as Config;
}

async function modelo(admin: SupabaseClient, faixa: string) {
  const codigo = TEMPLATE_DA_FAIXA[faixa];
  if (!codigo) throw new Error(`Faixa "${faixa}" não tem modelo de envio automático.`);
  const { data, error } = await admin.from("template_mensagem").select("assunto, corpo").eq("codigo", codigo).eq("ativo", true).is("empresa_id", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Modelo "${codigo}" não encontrado ou inativo.`);
  return data as { assunto: string | null; corpo: string };
}

// ── Envio de e-mail ───────────────────────────────────────────────────────────────────────────────────────────────
// A UOL recusa entregar mensagem vinda dos IPs do cluster (554 por política), então o envio saiu dela: com
// RESEND_API_KEY cadastrada, quem entrega é a API do Resend. Os COBRANCA_SMTP_* seguem valendo como caminho de volta,
// e COBRANCA_SMTP_FROM (ou, na falta dele, COBRANCA_SMTP_USER) é sempre quem assina. Ver _shared/enviar-email.ts.

function remetente(): string {
  return Deno.env.get("COBRANCA_SMTP_FROM") || Deno.env.get("COBRANCA_SMTP_USER") || "";
}

function envioConfigurado(): boolean {
  if (!remetente()) return false;
  if (Deno.env.get("RESEND_API_KEY")) return true;
  return !!(Deno.env.get("COBRANCA_SMTP_HOST") && Deno.env.get("COBRANCA_SMTP_USER") && Deno.env.get("COBRANCA_SMTP_PASS"));
}

async function enviarEmailCobranca(para: string[], cc: string[], assunto: string, corpoHtml: string) {
  await enviarEmail(
    { de: remetente(), para, cc, assunto, html: corpoHtml },
    {
      host: Deno.env.get("COBRANCA_SMTP_HOST") ?? "",
      porta: Number(Deno.env.get("COBRANCA_SMTP_PORT") ?? 465),
      usuario: Deno.env.get("COBRANCA_SMTP_USER") ?? "",
      senha: Deno.env.get("COBRANCA_SMTP_PASS") ?? "",
    },
  );
}

// ── Saídas ────────────────────────────────────────────────────────────────────────────────────────────────────────

function resumoDoPlano(p: PlanoContrato) {
  return {
    contrato_id: p.contratoId, contrato: p.contrato, empresa: p.empresaCodigo, faixa: p.faixa, dias_max: p.diasMax,
    qtd_notas: p.notas.length, valor_total: p.valorTotal, decisao: p.decisao, motivo: p.motivo, destinatarios: p.destinatarios,
    ultimo_envio: p.ultimoEnvio, proximo_envio: p.proximoEnvio,
    notas: p.notas.map((n) => ({ numero: n.numero, data_emissao: n.dataEmissao, competencia: n.competencia, valor: n.valor })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const ehWorker = token !== "" && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const corpo = await req.json().catch(() => ({}));
    const agora = new Date();
    const hoje = hojeEmSaoPaulo(agora);

    // ── Tela (JWT do usuário): só leitura ──
    if (!ehWorker) {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data: u, error: eu } = await userClient.auth.getUser();
      if (eu || !u?.user) return json({ ok: false, error: "Não autenticado." }, 401);
      const checks = await Promise.all(["alterar", "aprovar", "visualizar"].map((a) => admin.rpc("can_access", { _user: u.user.id, _menu: "cobrancas", _acao: a })));
      if (!checks.some((c) => c.data === true)) return json({ ok: false, error: "Sem permissão em Cobranças." }, 403);

      const config = await lerConfig(admin);
      const entrada = await carregarEntrada(admin, config, agora);
      const planos = planejarCobrancas(entrada);

      if (corpo.acao === "previa") {
        const plano = planos.find((p) => p.contratoId === corpo.contrato_id);
        if (!plano) return json({ ok: false, error: "Contrato sem nota na janela de cobrança." }, 404);
        if (plano.decisao === "judicial") return json({ ok: false, error: "Faixa judicial: não há modelo automático; envio exclusivo do Jurídico." }, 409);
        const email = montarEmail(plano, await modelo(admin, plano.faixa), hoje, config.assinatura_html);
        return json({ ok: true, assunto: email.assunto, corpo: email.corpo, para: plano.destinatarios, cc: copiaDoEmail(plano.faixa, config.cc_fixo) });
      }
      if (corpo.acao !== "simular") return json({ ok: false, error: "Ação inválida (simular | previa)." }, 400);

      const contagem: Record<string, number> = {};
      for (const p of planos) contagem[p.decisao] = (contagem[p.decisao] ?? 0) + 1;
      return json({
        ok: true, modo: config.modo, janela_aberta: dentroDaJanela(agora, config), envio_configurado: envioConfigurado(),
        gerado_em: agora.toISOString(), contagem, planos: planos.map(resumoDoPlano),
      });
    }

    // ── Worker (a cada hora): executa conforme o modo ──
    const config = await lerConfig(admin);
    if (config.modo === "desligado" || config.modo === "simulacao") return json({ ok: true, modo: config.modo, enviados: 0, observacao: "Modo sem envio." });
    if (!dentroDaJanela(agora, config)) return json({ ok: true, modo: config.modo, enviados: 0, observacao: "Fora da janela de envio." });
    if (!envioConfigurado()) return json({ ok: false, modo: config.modo, error: "Envio de e-mail não configurado (RESEND_API_KEY ou COBRANCA_SMTP_HOST/USER/PASS, e um remetente)." }, 500);
    if (config.modo === "piloto" && !config.email_piloto) return json({ ok: false, modo: config.modo, error: "Modo piloto sem e-mail de teste configurado." }, 400);

    const entrada = await carregarEntrada(admin, config, agora);
    const aEnviar = planejarCobrancas(entrada).filter((p) => p.decisao === "enviar").slice(0, config.limite_por_execucao);

    let enviados = 0, falhas = 0, falhasSeguidas = 0;
    for (const p of aEnviar) {
      // Barreira final: nunca envia faixa judicial, mesmo que o plano venha errado.
      garantirEnvioPermitido(p.faixa);
      const piloto = config.modo === "piloto";
      const email = montarEmail(p, await modelo(admin, p.faixa), hoje, config.assinatura_html);
      const para = piloto ? [config.email_piloto as string] : p.destinatarios;
      const cc = piloto ? [] : copiaDoEmail(p.faixa, config.cc_fixo);
      const assunto = piloto ? `[PILOTO — destino real: ${p.destinatarios.join("; ")}] ${email.assunto}` : email.assunto;
      const registro = {
        contrato_id: p.contratoId, contrato_nome: p.contrato, empresa_codigo: p.empresaCodigo, faixa: p.faixa, modo: config.modo,
        notas: p.notas.map((n) => ({ id: n.id, numero: n.numero, data_emissao: n.dataEmissao, valor: n.valor })), qtd_notas: p.notas.length,
        valor_total: p.valorTotal, destinatarios: para, cc, assunto, corpo: email.corpo,
      };
      try {
        await enviarEmailCobranca(para, cc, assunto, email.corpo);
        await admin.from("cobranca_auto_envio").insert({ ...registro, status: "enviado" });
        enviados++; falhasSeguidas = 0;
      } catch (e) {
        falhas++; falhasSeguidas++;
        await admin.from("cobranca_auto_envio").insert({ ...registro, status: "falhou", erro: String((e as Error).message ?? e).slice(0, 500) });
        // Três falhas seguidas = problema de credencial/rede: para por aqui e tenta de novo na próxima hora.
        if (falhasSeguidas >= 3) break;
      }
    }
    return json({ ok: true, modo: config.modo, candidatos: aEnviar.length, enviados, falhas });
  } catch (err) {
    console.error("cobranca-automatica error", err);
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500);
  }
});
