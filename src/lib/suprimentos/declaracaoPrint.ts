import type { DeclaracaoCorreio } from "@/hooks/useCorreioDeclaracao";

function escapar(valor: unknown) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dinheiro(valor: number | null | undefined) {
  return valor == null ? "" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function enderecoCompleto(prefixo: "rem" | "dest", d: DeclaracaoCorreio) {
  const endereco = prefixo === "rem" ? d.rem_endereco : d.dest_endereco;
  const complemento = prefixo === "rem" ? d.rem_complemento : d.dest_complemento;
  const bairro = prefixo === "rem" ? d.rem_bairro : d.dest_bairro;
  const cidade = prefixo === "rem" ? d.rem_cidade : d.dest_cidade;
  const uf = prefixo === "rem" ? d.rem_uf : d.dest_uf;
  const cep = prefixo === "rem" ? d.rem_cep : d.dest_cep;
  return [endereco, complemento, bairro, [cidade, uf].filter(Boolean).join(" - "), cep]
    .filter(Boolean)
    .join(", ");
}

export function gerarHtmlDeclaracao(d: DeclaracaoCorreio) {
  const itens = [...d.sup_correio_declaracao_item].sort((a, b) => a.ordem - b.ordem);
  const quantidadeTotal = itens.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  const valorTotal = itens.reduce((total, item) => total + Number(item.valor || 0) * Number(item.quantidade || 0), 0);
  const linhas = [...itens];
  while (linhas.length < 6) linhas.push({ conteudo: "", quantidade: 0, valor: null, ordem: linhas.length });
  const data = d.assinatura_data
    ? new Date(`${d.assinatura_data}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    : "____ de __________ de _____";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapar(d.numero ?? "Declaração de Conteúdo")}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #000; font-family: Arial, Helvetica, sans-serif; }
    .pagina { min-height: 277mm; }
    .titulo { border: 1.5px solid #000; border-bottom: 0; padding: 6px; text-align: center; font-size: 15px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    .secao { background: #eee; text-align: center; font-size: 11px; letter-spacing: .4px; }
    .dados td { height: 7mm; font-size: 10px; }
    .dados .cab { height: auto; font-weight: 700; text-align: center; }
    .bens th { font-size: 9px; text-align: center; }
    .bens td { height: 8mm; font-size: 10px; vertical-align: middle; }
    .legal { border: 1px solid #000; border-top: 0; padding: 8px; font-size: 9px; line-height: 1.35; text-align: justify; }
    .assinatura { display: flex; justify-content: space-between; gap: 20mm; align-items: end; margin-top: 9mm; text-align: center; }
    .linha-assinatura { min-width: 75mm; border-top: 1px solid #000; padding-top: 2px; }
    .observacao { border: 1px solid #000; border-top: 0; padding: 7px; font-size: 9px; line-height: 1.35; }
    .etiquetas { page-break-before: always; padding-top: 10mm; }
    .etiqueta { border: 2px solid #000; margin-bottom: 18mm; padding: 12mm; font-size: 20px; line-height: 1.45; overflow-wrap: anywhere; }
    .etiqueta strong { display: block; margin-bottom: 5mm; font-size: 24px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <main class="pagina">
    <div class="titulo">DECLARAÇÃO DE CONTEÚDO</div>
    <table class="dados">
      <tr><td class="cab">REMETENTE</td><td class="cab">DESTINATÁRIO</td></tr>
      <tr><td><strong>NOME:</strong> ${escapar(d.rem_nome)}</td><td><strong>NOME:</strong> ${escapar(d.dest_nome)}</td></tr>
      <tr><td><strong>ENDEREÇO:</strong> ${escapar(d.rem_endereco)}</td><td><strong>ENDEREÇO:</strong> ${escapar(d.dest_endereco)}</td></tr>
      <tr><td>${escapar([d.rem_complemento, d.rem_bairro].filter(Boolean).join(" · "))}</td><td>${escapar([d.dest_complemento, d.dest_bairro].filter(Boolean).join(" · "))}</td></tr>
      <tr><td><strong>CIDADE:</strong> ${escapar(d.rem_cidade)} &nbsp; <strong>UF:</strong> ${escapar(d.rem_uf)}</td><td><strong>CIDADE:</strong> ${escapar(d.dest_cidade)} &nbsp; <strong>UF:</strong> ${escapar(d.dest_uf)}</td></tr>
      <tr><td><strong>CEP:</strong> ${escapar(d.rem_cep)} &nbsp; <strong>CPF/CNPJ:</strong> ${escapar(d.rem_cnpj)}</td><td><strong>CEP:</strong> ${escapar(d.dest_cep)} &nbsp; <strong>CNPJ:</strong> ${escapar(d.dest_cnpj)}</td></tr>
    </table>
    <table class="bens">
      <tr><th class="secao" colspan="4">IDENTIFICAÇÃO DOS BENS</th></tr>
      <tr><th style="width:10%">ITEM</th><th>CONTEÚDO</th><th style="width:14%">QUANT.</th><th style="width:22%">VALOR</th></tr>
      ${linhas.map((item, indice) => `<tr><td style="text-align:center">${indice + 1}</td><td>${escapar(item.conteudo)}</td><td style="text-align:center">${item.quantidade || ""}</td><td style="text-align:right">${dinheiro(item.valor)}</td></tr>`).join("")}
      <tr><td colspan="2" style="text-align:right;font-weight:700">TOTAIS</td><td style="text-align:center;font-weight:700">${quantidadeTotal}</td><td style="text-align:right;font-weight:700">${dinheiro(valorTotal || null)}</td></tr>
      <tr><td colspan="3" style="text-align:right;font-weight:700">PESO TOTAL (kg)</td><td style="text-align:right">${escapar(d.peso_total_kg)}</td></tr>
      <tr><th class="secao" colspan="4">DECLARAÇÃO</th></tr>
    </table>
    <section class="legal">
      <p>Declaro que não me enquadro no conceito de contribuinte previsto no art. 4º da Lei Complementar nº 87/1996, uma vez que não realizo, com habitualidade ou em volume que caracterize intuito comercial, operações de circulação de mercadoria, ainda que se iniciem no exterior, ou estou dispensado da emissão da nota fiscal por força da legislação tributária vigente, responsabilizando-me, nos termos da lei e a quem de direito, por informações inverídicas.</p>
      <p>Declaro ainda que não estou postando conteúdo inflamável, explosivo, causador de combustão espontânea, tóxico, corrosivo, gás ou qualquer outro conteúdo que conste na lista de proibições e restrições, disponível no site dos Correios: https://www.correios.com.br/enviar/proibicoes-e-restricoes/proibicoes-e-restricoes.</p>
      <div class="assinatura"><span>${escapar(d.assinatura_cidade || "________")}, ${escapar(data)}</span><span class="linha-assinatura">Assinatura do Declarante/Remetente</span></div>
    </section>
    <section class="observacao"><strong>OBSERVAÇÃO:</strong> Constitui crime contra a ordem tributária suprimir ou reduzir tributo, ou contribuição social e qualquer acessório (Lei 8.137/90 Art. 1º, V).</section>
  </main>
  <section class="pagina etiquetas">
    <div class="etiqueta"><strong>DESTINATÁRIO:</strong>${escapar(d.dest_nome)}<br>${escapar(enderecoCompleto("dest", d))}<br>CNPJ: ${escapar(d.dest_cnpj)}</div>
    <div class="etiqueta"><strong>REMETENTE:</strong>${escapar(d.rem_nome)}<br>${escapar(enderecoCompleto("rem", d))}<br>Caixa Postal: ${escapar(d.rem_caixa_postal)} / CEP: ${escapar(d.rem_cep)}</div>
  </section>
  <script>setTimeout(() => window.print(), 300);</script>
</body>
</html>`;
}

export function imprimirDeclaracao(d: DeclaracaoCorreio) {
  const janela = window.open("", "_blank", "width=900,height=700");
  if (!janela) throw new Error("O navegador bloqueou a janela de impressão.");
  janela.document.write(gerarHtmlDeclaracao(d));
  janela.document.close();
}
