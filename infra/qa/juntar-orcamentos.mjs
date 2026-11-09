import fs from "node:fs";
import { consolidarOrcamentos, descobrirRotas } from "./fatias.mjs";

const arquivos = process.argv.slice(2);
if (!arquivos.length) throw new Error("Informe os relatórios das fatias do QA.");
const rotas = descobrirRotas(fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8"));
const consolidado = consolidarOrcamentos(arquivos.map((arquivo) => JSON.parse(fs.readFileSync(arquivo, "utf8"))), rotas);
fs.writeFileSync("orcamento.json", JSON.stringify(consolidado, null, 1));
const ruins = consolidado.resultados.filter((r) => r.problemas.length || r.parada > 0);
const resumo = `## QA de requisições consolidado\n${consolidado.resultados.length} telas conferidas em ${arquivos.length} fatias; ${ruins.length} reprovação(ões).\n`;
console.log(resumo);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumo);
process.exitCode = ruins.length ? 1 : 0;
