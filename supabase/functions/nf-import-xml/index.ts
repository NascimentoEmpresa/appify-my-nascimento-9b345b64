/* eslint-disable @typescript-eslint/no-explicit-any */
// Edge function: importa XML de NFe e cria nf_entrada + itens
// Política para produtos novos: cria automaticamente como pendente_revisao (decisão do usuário: 1-C)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ImportPayload {
  xml: string;
  destino?: "estoque" | "contrato" | "consumo_imediato";
  almoxarifado_id?: string;
  contrato_id?: string;
  centro_custo_id?: string;
  sup_compra_pedido_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    // Cliente para validar usuário
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: podeImportar } = await userClient.rpc("has_screen_access", {
      _user: user.id,
      _menu: "nf-entrada",
      _acao: "incluir",
      _empresa: null,
    });
    if (!podeImportar) {
      return json({ error: "Sem permissão para importar NF" }, 403);
    }

    // Cliente admin para escrever ignorando RLS quando necessário (mantemos empresa_id correto)
    const admin = createClient(supabaseUrl, serviceKey);

    // Empresa do usuário
    const { data: profile } = await admin
      .from("profiles")
      .select("empresa_id")
      .eq("id", user.id)
      .maybeSingle();
    let empresa_id = profile?.empresa_id;
    const body: ImportPayload = await req.json();
    if (!body.xml || typeof body.xml !== "string") {
      return json({ error: "Campo 'xml' obrigatório" }, 400);
    }

    if (body.sup_compra_pedido_id) {
      const { data: pedido } = await admin
        .from("sup_compra_pedido")
        .select("empresa_id,status")
        .eq("id", body.sup_compra_pedido_id)
        .maybeSingle();
      if (!pedido || !["enviado", "aguardando_entrega", "entrega_parcial"].includes(pedido.status)) {
        return json({ error: "Pedido de compra inválido para esta NF" }, 400);
      }
      empresa_id = pedido.empresa_id;
    }
    if (!empresa_id) {
      return json({ error: "Selecione um pedido de compra para definir a empresa da NF" }, 400);
    }

    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
    });

    let parsed: any;
    try {
      parsed = parser.parse(body.xml);
    } catch (e) {
      return json({ error: "XML inválido", detail: String(e) }, 400);
    }

    // Estruturas: nfeProc > NFe > infNFe  (ou direto NFe > infNFe)
    const infNFe = parsed?.nfeProc?.NFe?.infNFe ?? parsed?.NFe?.infNFe;
    if (!infNFe) {
      return json({ error: "Estrutura NFe não encontrada (esperado nfeProc/NFe/infNFe)" }, 400);
    }

    const chave = (infNFe["@_Id"] ?? "").toString().replace(/^NFe/, "");
    if (chave.length !== 44) {
      return json({ error: "Chave de acesso inválida (esperado 44 dígitos)" }, 400);
    }

    const ide = infNFe.ide ?? {};
    const emit = infNFe.emit ?? {};
    const total = infNFe.total?.ICMSTot ?? {};
    const protocolo = parsed?.nfeProc?.protNFe?.infProt?.nProt?.toString();

    // Verifica duplicidade
    const { data: existente } = await admin
      .from("nf_entrada")
      .select("id, status")
      .eq("empresa_id", empresa_id)
      .eq("chave_acesso", chave)
      .maybeSingle();
    if (existente) {
      return json({ error: "NF já importada", nf_id: existente.id, status: existente.status }, 409);
    }

    // Localiza/cria fornecedor
    const fornecedor_cnpj = (emit.CNPJ ?? "").toString();
    let fornecedor_id: string | null = null;
    if (fornecedor_cnpj) {
      const { data: fornExist } = await admin
        .from("fornecedor")
        .select("id")
        .eq("empresa_id", empresa_id)
        .eq("cnpj_cpf", fornecedor_cnpj)
        .maybeSingle();
      if (fornExist) {
        fornecedor_id = fornExist.id;
      } else {
        const { data: fornNew, error: fornErr } = await admin
          .from("fornecedor")
          .insert({
            empresa_id,
            cnpj_cpf: fornecedor_cnpj,
            razao_social: emit.xNome ?? "Fornecedor importado",
            nome_fantasia: emit.xFant ?? null,
            tipo: "pj",
            ativo: true,
          })
          .select("id")
          .single();
        if (!fornErr && fornNew) fornecedor_id = fornNew.id;
      }
    }

    // Upload do XML para storage
    const dEmi = (ide.dhEmi ?? ide.dEmi ?? "").toString().slice(0, 10);
    const ano = dEmi.slice(0, 4) || new Date().getFullYear().toString();
    const mes = dEmi.slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, "0");
    const xml_path = `${empresa_id}/${ano}/${mes}/${chave}.xml`;

    const { error: storageErr } = await admin.storage
      .from("nfe-xml")
      .upload(xml_path, new Blob([body.xml], { type: "application/xml" }), {
        contentType: "application/xml",
        upsert: true,
      });
    if (storageErr) {
      console.error("Storage upload error:", storageErr);
    }

    // Cria NF
    const { data: nfRow, error: nfErr } = await admin
      .from("nf_entrada")
      .insert({
        empresa_id,
        chave_acesso: chave,
        numero: ide.nNF?.toString() ?? "0",
        serie: ide.serie?.toString() ?? null,
        modelo: ide.mod?.toString() ?? "55",
        data_emissao: dEmi || new Date().toISOString().slice(0, 10),
        data_entrada: new Date().toISOString().slice(0, 10),
        fornecedor_id,
        fornecedor_cnpj,
        fornecedor_razao: emit.xNome ?? null,
        natureza_operacao: ide.natOp ?? null,
        cfop: null,
        valor_produtos: parseFloat(total.vProd ?? "0"),
        valor_frete: parseFloat(total.vFrete ?? "0"),
        valor_seguro: parseFloat(total.vSeg ?? "0"),
        valor_desconto: parseFloat(total.vDesc ?? "0"),
        valor_outras_despesas: parseFloat(total.vOutro ?? "0"),
        valor_icms: parseFloat(total.vICMS ?? "0"),
        valor_ipi: parseFloat(total.vIPI ?? "0"),
        valor_pis: parseFloat(total.vPIS ?? "0"),
        valor_cofins: parseFloat(total.vCOFINS ?? "0"),
        valor_total: parseFloat(total.vNF ?? "0"),
        status: "importada",
        destino: body.destino ?? "estoque",
        almoxarifado_id: body.almoxarifado_id ?? null,
        contrato_id: body.contrato_id ?? null,
        centro_custo_id: body.centro_custo_id ?? null,
        sup_compra_pedido_id: body.sup_compra_pedido_id ?? null,
        xml_storage_path: xml_path,
        xml_protocolo: protocolo,
        importado_por: user.id,
      })
      .select("id")
      .single();

    if (nfErr || !nfRow) {
      console.error("Insert NF error:", nfErr);
      return json({ error: "Falha ao gravar NF", detail: nfErr?.message }, 500);
    }
    const nf_id = nfRow.id;

    // Itens (det pode ser array ou objeto único)
    const dets = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);
    let itens_pendentes = 0;
    let produtos_criados = 0;

    for (const det of dets) {
      const prod = det.prod ?? {};
      const numero = parseInt(det["@_nItem"] ?? "0");
      const cFornecedor = prod.cProd?.toString() ?? null;
      const ean = prod.cEAN && prod.cEAN !== "SEM GTIN" ? prod.cEAN.toString() : null;
      const xProd = prod.xProd?.toString() ?? "Item sem descrição";

      // Primeiro resolve o catálogo Supply. O de-para do fornecedor é a fonte
      // principal; o EAN/GTIN é fallback quando aquele vínculo ainda não foi
      // cadastrado. A empresa aqui não é filtro de acesso: é a empresa da
      // própria NF e impede gravar nela um material de outro catálogo.
      let sup_item_id: string | null = null;
      if (fornecedor_id && cFornecedor) {
        const { data: vinculos } = await admin
          .from("sup_fornecedor_item")
          .select("sup_item_id")
          .eq("fornecedor_id", fornecedor_id)
          .eq("codigo_fornecedor", cFornecedor)
          .limit(20);
        const idsVinculados = (vinculos ?? []).map((v: any) => v.sup_item_id);
        if (idsVinculados.length > 0) {
          const { data: itemDaEmpresa } = await admin
            .from("sup_item")
            .select("id")
            .in("id", idsVinculados)
            .eq("empresa_id", empresa_id)
            .limit(1)
            .maybeSingle();
          if (itemDaEmpresa) sup_item_id = itemDaEmpresa.id;
        }
      }
      if (!sup_item_id && ean) {
        const { data: itemEan } = await admin
          .from("sup_item")
          .select("id")
          .eq("codigo_barras", ean)
          .eq("empresa_id", empresa_id)
          .limit(1)
          .maybeSingle();
        if (itemEan) sup_item_id = itemEan.id;
      }

      // Mantém também o vínculo com `produto`, consumido pelo módulo legado.
      let produto_id: string | null = null;
      if (cFornecedor) {
        const { data: pExist } = await admin
          .from("produto")
          .select("id")
          .eq("empresa_id", empresa_id)
          .eq("codigo_externo", cFornecedor)
          .maybeSingle();
        if (pExist) produto_id = pExist.id;
      }

      const item_status: "ok" | "pendente_revisao" | "produto_novo" = sup_item_id
        ? "ok"
        : "pendente_revisao";
      let produto_criado_auto = false;

      // Cria produto automaticamente se não existir (decisão 1-C)
      if (!produto_id) {
        const { data: pNew, error: pErr } = await admin
          .from("produto")
          .insert({
            empresa_id,
            codigo_externo: cFornecedor,
            descricao: xProd,
            unidade: prod.uCom?.toString() ?? "UN",
            metodo_custeio: "medio",
            preco_referencia: parseFloat(prod.vUnCom ?? "0"),
            ativo: true,
            observacoes: `Criado automaticamente via NF ${ide.nNF} em ${new Date().toLocaleDateString("pt-BR")}. EAN: ${ean ?? "—"}. Revisar.`,
          })
          .select("id")
          .single();
        if (!pErr && pNew) {
          produto_id = pNew.id;
          produto_criado_auto = true;
          produtos_criados++;
        }
      }

      if (item_status === "pendente_revisao") itens_pendentes++;

      await admin.from("nf_entrada_item").insert({
        nf_id,
        empresa_id,
        numero_item: numero,
        produto_id,
        sup_item_id,
        codigo_fornecedor: cFornecedor,
        ean,
        descricao_original: xProd,
        ncm: prod.NCM?.toString() ?? null,
        cfop: prod.CFOP?.toString() ?? null,
        unidade: prod.uCom?.toString() ?? "UN",
        quantidade: parseFloat(prod.qCom ?? "0"),
        valor_unitario: parseFloat(prod.vUnCom ?? "0"),
        valor_total: parseFloat(prod.vProd ?? "0"),
        valor_desconto: parseFloat(prod.vDesc ?? "0"),
        valor_frete: parseFloat(prod.vFrete ?? "0"),
        valor_icms: parseFloat(det.imposto?.ICMS?.[Object.keys(det.imposto?.ICMS ?? {})[0]]?.vICMS ?? "0"),
        valor_ipi: parseFloat(det.imposto?.IPI?.IPITrib?.vIPI ?? "0"),
        status: item_status,
        produto_criado_auto,
      });
    }

    // Log
    await admin.from("nf_entrada_log").insert({
      nf_id,
      empresa_id,
      evento: "importada",
      detalhes: {
        itens: dets.length,
        produtos_criados_auto: produtos_criados,
        itens_pendentes,
        protocolo,
      },
      user_id: user.id,
    });

    return json({
      ok: true,
      nf_id,
      itens: dets.length,
      produtos_criados_auto: produtos_criados,
      itens_pendentes,
    });
  } catch (e) {
    console.error("Erro:", e);
    return json({ error: "Erro interno", detail: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
