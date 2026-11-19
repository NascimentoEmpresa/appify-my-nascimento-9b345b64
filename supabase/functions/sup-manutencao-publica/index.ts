import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const bucket = "sup-solicitacoes-manutencao";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const tipos = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
type AnexoBanco = { id: string; categoria: string; nome_arquivo: string; caminho: string; tipo_mime: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const token = String(form.get("token") ?? "").trim();
      const empresa = String(form.get("empresa") ?? "").trim();
      const responsavel = String(form.get("responsavel") ?? "").trim();
      const arquivo = form.get("arquivo");
      if (!token || !empresa || !responsavel || !(arquivo instanceof File)) return json({ error: "Preencha empresa, responsável e orçamento." }, 400);
      if (!tipos.has(arquivo.type) || arquivo.size > 5 * 1024 * 1024) return json({ error: "Envie JPG, PNG, WEBP ou PDF de até 5 MB." }, 400);

      const { data: patrimonio } = await sb.from("sup_patrimonio").select("id").eq("manutencao_qr_token", token)
        .eq("manutencao_qr_ativo", true).maybeSingle();
      if (!patrimonio) return json({ error: "QR inválido ou revogado." }, 404);
      const { data: solicitacao } = await sb.from("SUP_SOLICITACAO_MANUTENCAO").select("id")
        .eq("patrimonio_id", patrimonio.id).eq("tipo", "manutencao").neq("status", "encerrada").maybeSingle();
      if (!solicitacao) return json({ error: "Não há manutenção ativa para esta máquina." }, 404);

      const ext = arquivo.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || (arquivo.type === "application/pdf" ? "pdf" : "jpg");
      const caminho = `prestadora/${solicitacao.id}/${crypto.randomUUID()}.${ext}`;
      const { error: erroUpload } = await sb.storage.from(bucket).upload(caminho, arquivo, { contentType: arquivo.type });
      if (erroUpload) return json({ error: "Não foi possível enviar o orçamento." }, 500);
      const { data: antigo, error } = await sb.rpc("sup_manutencao_publica_registrar_orcamento", {
        p_token: token, p_empresa: empresa, p_responsavel: responsavel, p_nome: arquivo.name,
        p_caminho: caminho, p_mime: arquivo.type, p_tamanho: arquivo.size,
      });
      if (error) {
        await sb.storage.from(bucket).remove([caminho]);
        return json({ error: error.message }, 400);
      }
      if (antigo) await sb.storage.from(bucket).remove([antigo]);
      return json({ ok: true });
    }

    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return json({ error: "QR inválido." }, 400);
    if (body?.acao === "iniciar" || body?.acao === "concluir") {
      const { error } = await sb.rpc("sup_manutencao_publica_transicionar", {
        p_token: token, p_acao: body.acao,
        p_empresa: typeof body?.empresa === "string" ? body.empresa : null,
        p_responsavel: typeof body?.responsavel === "string" ? body.responsavel : null,
      });
      if (error) return json({ error: error.message }, 400);
    } else if (body?.acao !== "consultar") {
      return json({ error: "Ação desconhecida." }, 400);
    }

    const { data: patrimonio } = await sb.from("sup_patrimonio")
      .select("id,nome,numero_serie,placa_patrimonial").eq("manutencao_qr_token", token)
      .eq("manutencao_qr_ativo", true).maybeSingle();
    if (!patrimonio) return json({ error: "QR inválido ou revogado." }, 404);
    const { data: solicitacao } = await sb.from("SUP_SOLICITACAO_MANUTENCAO")
      .select("id,maquinario,numero_serie,placa_patrimonial,descricao,status,decisao_motivo,prestadora_empresa,prestadora_responsavel,created_at")
      .eq("patrimonio_id", patrimonio.id).eq("tipo", "manutencao").neq("status", "encerrada").maybeSingle();
    if (!solicitacao) return json({ equipamento: patrimonio, solicitacao: null, anexos: [], historico: [] });
    const [{ data: anexos = [] }, { data: historico = [] }] = await Promise.all([
      sb.from("SUP_SOLICITACAO_MANUTENCAO_ANEXO").select("id,categoria,nome_arquivo,caminho,tipo_mime").eq("solicitacao_id", solicitacao.id),
      sb.from("SUP_SOLICITACAO_MANUTENCAO_HISTORICO").select("id,status,motivo,origem,autor_nome,created_at").eq("solicitacao_id", solicitacao.id).order("created_at"),
    ]);
    const anexosBanco = anexos as AnexoBanco[];
    const { data: assinados = [] } = await sb.storage.from(bucket)
      .createSignedUrls(anexosBanco.map((a) => a.caminho), 600);
    const anexosPublicos = anexosBanco.map((a, indice) => ({
      id: a.id, categoria: a.categoria, nome_arquivo: a.nome_arquivo,
      tipo_mime: a.tipo_mime, url: assinados[indice]?.signedUrl ?? null,
    }));
    return json({ equipamento: patrimonio, solicitacao, anexos: anexosPublicos, historico });
  } catch {
    return json({ error: "Não foi possível processar a manutenção." }, 500);
  }
});
