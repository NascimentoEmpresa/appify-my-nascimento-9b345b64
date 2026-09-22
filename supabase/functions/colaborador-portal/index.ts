// supabase/functions/colaborador-portal/index.ts
// Portal do Colaborador (/colaborador) — a única porta do navegador para os
// dados do colaborador. Login por CPF, sessão própria, sem conta no ERP.
//
// POR QUE EXISTE (ver 20260930000196_portal_colaborador.sql)
//   O colaborador de campo não tem conta no Supabase Auth e não vai ter: uma
//   sessão do Auth entra no banco como `authenticated`, papel que dezenas de
//   tabelas deste ERP liberam com `USING (true)`. Aqui o navegador manda JSON
//   puro (sem header de autenticação, sem chave anon — verify_jwt = false no
//   config.toml, como o Canal de Ética) e a função, rodando com service_role,
//   chama SÓ as RPCs `col_*`. Elas têm EXECUTE revogado de anon e
//   authenticated: não existe caminho pelo PostgREST.
//
// PROTOCOLO
//   POST { acao, token?, ...parametros }
//   • `login`  → { cpf, senha } → { ok, token, nome, expira_em }
//   • demais   → exigem `token`; a função resolve o empregado com
//                col_sessao(token) e passa o `empregado_id` para a RPC. O
//                navegador nunca informa de quem são os dados: é sempre da
//                sessão. Token inválido/vencido → 401 { error, sessao: false }
//                e o front volta para o login.
//   Erro de regra (RAISE EXCEPTION na RPC) → 400 { error: <mensagem> }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Corpo = Record<string, unknown> & { acao?: string; token?: string };

const str = (v: unknown, max = 2000): string | null =>
  typeof v === "string" ? v.slice(0, max) : v == null ? null : String(v).slice(0, max);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => (num(v) == null ? null : Math.trunc(num(v)!));
const uuid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Corpo;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }
  const acao = str(body.acao, 40) ?? "";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = req.headers.get("user-agent");

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || "Falha ao consultar.");
    return data;
  };

  try {
    // ── Sem sessão ──────────────────────────────────────────────────────
    if (acao === "login") {
      const r = await rpc("col_login", {
        p_cpf: str(body.cpf, 20) ?? "",
        p_senha: str(body.senha, 200) ?? "",
        p_user_agent: ua,
        p_ip: ip,
      });
      // Erro de credencial sai como 200 { ok:false, error } — a tela mostra a
      // mensagem sem tratar como falha de rede.
      return json(r);
    }

    // ── Com sessão ──────────────────────────────────────────────────────
    const token = str(body.token, 200) ?? "";
    const emp = (await rpc("col_sessao", { p_token: token })) as number | null;
    if (!emp) return json({ error: "Sessão expirada. Entre de novo.", sessao: false }, 401);

    switch (acao) {
      case "logout":
        await rpc("col_logout", { p_token: token });
        return json({ ok: true });
      case "sessao":
      case "perfil":
        return json(await rpc("col_perfil", { p_emp: emp }));
      case "salario":
        return json(await rpc("col_salario", { p_emp: emp }));
      case "ponto":
        return json(await rpc("col_ponto", { p_emp: emp, p_mes: str(body.mes, 7) }));
      case "bater_ponto":
        return json(await rpc("col_bater_ponto", {
          p_emp: emp,
          p_tipo: str(body.tipo, 30) ?? "",
          p_lat: num(body.latitude),
          p_lng: num(body.longitude),
          p_precisao: num(body.precisao),
          p_obs: str(body.observacao, 300),
        }));
      case "historico":
        return json(await rpc("col_historico", { p_emp: emp }));
      case "cursos":
        return json(await rpc("col_cursos", { p_emp: emp }));
      case "curso":
        return json(await rpc("col_curso", { p_emp: emp, p_curso: uuid(body.curso_id) }));
      case "concluir_aula":
        return json(await rpc("col_concluir_aula", {
          p_emp: emp, p_aula: uuid(body.aula_id), p_tempo_seg: int(body.tempo_seg) ?? 0, p_avaliacao: int(body.avaliacao),
        }));
      case "registrar_tempo":
        await rpc("col_registrar_tempo", { p_emp: emp, p_aula: uuid(body.aula_id), p_tempo_seg: int(body.tempo_seg) ?? 0 });
        return json({ ok: true });
      case "responder_quiz": {
        const respostas = Array.isArray(body.respostas) ? body.respostas.map((r) => int(r)) : [];
        return json(await rpc("col_responder_quiz", { p_emp: emp, p_aula: uuid(body.aula_id), p_respostas: respostas }));
      }
      // Provas (22/09/2026): estado/início/resposta com tentativas limitadas
      // e o aviso do player de que o vídeo chegou ao fim (libera a prova).
      case "prova":
        return json(await rpc("col_prova", { p_emp: emp, p_aula: uuid(body.aula_id) }));
      case "prova_iniciar":
        return json(await rpc("col_prova_iniciar", { p_emp: emp, p_aula: uuid(body.aula_id) }));
      case "prova_responder": {
        // {"<id da pergunta>": [índices]} — só números inteiros passam.
        const bruto = body.respostas && typeof body.respostas === "object" && !Array.isArray(body.respostas)
          ? body.respostas as Record<string, unknown> : {};
        const respostas: Record<string, number[]> = {};
        for (const [k, v] of Object.entries(bruto).slice(0, 500)) {
          const lista = (Array.isArray(v) ? v : [v]).map((x) => int(x)).filter((x): x is number => x != null);
          respostas[String(k).slice(0, 100)] = lista.slice(0, 50);
        }
        return json(await rpc("col_prova_responder", { p_emp: emp, p_tentativa: uuid(body.tentativa_id), p_respostas: respostas }));
      }
      case "video_assistido":
        await rpc("col_video_assistido", { p_emp: emp, p_aula: uuid(body.aula_id) });
        return json({ ok: true });
      case "comentarios":
        return json(await rpc("col_comentarios", { p_emp: emp, p_aula: uuid(body.aula_id) }));
      case "comentar":
        return json(await rpc("col_comentar", { p_emp: emp, p_aula: uuid(body.aula_id), p_texto: str(body.texto, 1000) ?? "" }));
      case "certificado":
        return json(await rpc("col_certificado", { p_emp: emp, p_curso: uuid(body.curso_id) }));
      case "notificacoes_lidas":
        await rpc("col_notificacoes_lidas", { p_emp: emp });
        return json({ ok: true });
      case "alterar_senha":
        return json(await rpc("col_alterar_senha", {
          p_emp: emp, p_atual: str(body.atual, 200) ?? "", p_nova: str(body.nova, 200) ?? "",
        }));
      default:
        return json({ error: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Não foi possível concluir agora.";
    return json({ error: msg }, 400);
  }
});
