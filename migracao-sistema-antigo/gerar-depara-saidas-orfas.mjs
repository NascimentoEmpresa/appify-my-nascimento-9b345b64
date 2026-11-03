// =====================================================================
// SIS-2026-0769 — de-para `protocolo do pedido legado` -> `contrato`.
//
// Contexto: 1.447 linhas de sup_estoque_consumo (3.318 unidades, mar-ago/2026)
// apontam para pedidos que NÃO existem em sup_pedido. A causa está provada:
// os pedidos foram apagados DENTRO do sistema antigo antes da carga — dos
// ids 253..4535 do legado só 1.872 chegaram, 2.411 nunca existiram para ser
// migrados. Sem o pedido, a saída não sabe para qual contrato foi, e a análise
// de lucratividade de mar-jun/2026 fica cega.
//
// O banco antigo (Render) foi fechado em 30/10/2026 — não há mais origem.
// O que sobrou são exports em Excel feitos enquanto o sistema antigo rodava,
// que guardam `Pedido ID` + `Contrato` lado a lado. Este script lê esses
// exports e emite o de-para para a migration 20261103001000.
//
// Os .xlsx têm nome de colaborador: NÃO vão para o git (ver .gitignore).
//
// Emite SÓ os protocolos que a produção tem como órfãos — o arquivo de órfãos
// sai do próprio banco, via PostgREST:
//   sup_estoque_consumo?select=pedido_id_legado&pedido_id=is.null
//
// Uso (da raiz do repositório):
//   node migracao-sistema-antigo/gerar-depara-saidas-orfas.mjs <orfaos.json> > depara.sql
// =====================================================================
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HOME = "C:/Users/Eduardo Monteiro/Desktop";

// Ordem importa: o primeiro export que conhece o protocolo vence. Os de abril
// vêm antes porque são os mais próximos do período com mais buraco.
const EXPORTS = [
  ["ATÉ 23-04-2026.xlsx", `${HOME}/Projeto_ERP_LOVABLE/ATÉ 23-04-2026.xlsx`, "Pedido ID", "Contrato"],
  ["ATÉ 27-04-2026.xlsx", `${HOME}/Projeto_ERP_LOVABLE/ATÉ 27-04-2026.xlsx`, "Pedido ID", "Contrato"],
  ["pedidos_site_externo.xlsx (23/06)", `${HOME}/Projeto_ERP/pedidos_site_externo.xlsx`, "pedido_id", "contrato"],
  ["Pedidos_Todos (25/08)", `${HOME}/CASSIO/2026-0201/Pedidos_Todos_2026-08-25T14-13-33.xlsx`, "Pedido ID", "Contrato"],
  ["pedidos-materiais (25/08)", `${HOME}/CASSIO/2026-0201/pedidos-materiais-2026-08-25.xlsx`, "Protocolo", "Contrato"],
];

// Nomes que o casamento automático (sem acento/pontuação) não resolve, mas que
// a conferência de 30/10/2026 fechou com segurança. `CANOINHAS - EMBRAPA` ficou
// DE FORA de propósito: pode ser `EMBRAPA - CANOINHA - 47/2024` (ativo) ou
// `EMBRAPA - 2021/93` (encerrado), e o nome não traz número de contrato —
// chutar jogaria 30 unidades no contrato errado dentro de uma análise de
// lucratividade. Essas linhas ficam como "sem contrato identificado".
const DEPARA_MANUAL = new Map([
  ["UFRGS - ASB - 033 2021", "UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021"],
  ["EMBRAPA - 93 2021", "EMBRAPA - 2021/93"],
  ["TRIUNFO COLETA DE LIXO - 89.2026", "TRIUNFO COLETA DE LIXO - 089.2026"],
  ["CAXIAS DO SUL TELEFONISTAS - 2026/95", "CAXIAS DO SUL - 2026/95"],
]);

const aspas = (s) => `'${String(s).replace(/'/g, "''")}'`;

const arquivoOrfaos = process.argv[2];
if (!arquivoOrfaos || !existsSync(arquivoOrfaos)) {
  console.error("Uso: node gerar-depara-saidas-orfas.mjs <orfaos.json>");
  process.exit(1);
}
// Só interessam os protocolos que a produção ainda tem sem pedido: emitir o
// resto encheria a migration com pedidos que já estão ligados.
const orfaos = new Set(
  JSON.parse(readFileSync(arquivoOrfaos, "utf8"))
    .map((r) => String(r.pedido_id_legado ?? "").trim())
    .filter((p) => p && !p.startsWith("TESTE")),
);

const mapa = new Map(); // protocolo -> { contrato, fonte }
let lidos = 0;
for (const [nome, caminho, colProt, colContrato] of EXPORTS) {
  if (!existsSync(caminho)) {
    console.error(`-- AUSENTE: ${nome} (${caminho})`);
    continue;
  }
  const wb = XLSX.readFile(caminho);
  for (const aba of wb.SheetNames) {
    for (const linha of XLSX.utils.sheet_to_json(wb.Sheets[aba])) {
      const prot = String(linha[colProt] ?? "").trim();
      const contrato = String(linha[colContrato] ?? "").trim();
      lidos++;
      if (!prot || !contrato || !orfaos.has(prot)) continue;
      if (!mapa.has(prot)) mapa.set(prot, { contrato, fonte: nome });
    }
  }
}

const linhas = [...mapa.entries()]
  .map(([prot, { contrato, fonte }]) => ({
    prot,
    contrato: DEPARA_MANUAL.get(contrato) ?? contrato,
    fonte,
  }))
  .filter((l) => l.contrato !== "CANOINHAS - EMBRAPA")
  .sort((a, b) => a.prot.localeCompare(b.prot));

console.error(
  `-- ${lidos} linhas lidas dos exports · ${orfaos.size} protocolos órfãos na produção · ` +
    `${mapa.size} encontrados · ${linhas.length} emitidos (o resto não tem fonte)`,
);

console.log("-- Gerado por migracao-sistema-antigo/gerar-depara-saidas-orfas.mjs");
console.log("-- (protocolo, contrato_nome, fonte)");
for (const l of linhas) {
  console.log(`  (${aspas(l.prot)}, ${aspas(l.contrato)}, ${aspas(l.fonte)}),`);
}
