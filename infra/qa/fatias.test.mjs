import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { consolidarOrcamentos, descobrirRotas, selecionarFatia } from "./fatias.mjs";

const rotas = descobrirRotas(fs.readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8"));
const total = 6;
const relatorios = () => Array.from({ length: total }, (_, i) => i + 1).map((indice) => ({
  base: "http://127.0.0.1:4173",
  fatia: { indice, total },
  resultados: selecionarFatia(rotas, `${indice}/${total}`).rotas.map((rota) => ({ rota, abertura: 40, parada: 0, problemas: [] })),
}));

test("as fatias cobrem todas as rotas reais uma única vez e têm tamanho equilibrado", () => {
  const partes = relatorios();
  const tamanhos = partes.map((p) => p.resultados.length);
  assert.ok(rotas.length > 300);
  assert.ok(Math.max(...tamanhos) - Math.min(...tamanhos) <= 1);
  assert.deepEqual(consolidarOrcamentos(partes.reverse(), rotas).resultados.map((r) => r.rota).sort(), rotas);
});

test("a descoberta preserva rotas estáticas, remove duplicadas e respeita --so", () => {
  const app = '<Route path="/login"/><Route path="/app"><Route path="b"/><Route path="a"/><Route path="a"/><Route path="a/:id"/><Route path="*"/></Route>';
  assert.deepEqual(descobrirRotas(app), ["/app/a", "/app/b"]);
  assert.deepEqual(descobrirRotas(app, "/app/b"), ["/app/b"]);
});

test("execução local sem --fatia continua cobrindo todas as telas", () => {
  assert.deepEqual(selecionarFatia(rotas).rotas, rotas);
});

test("fatia inválida ou seleção vazia falha em vez de passar sem testar", () => {
  for (const fatia of ["0/3", "4/3", "1/0", "1/9999", "1.5/3", "x", "1/3x"]) {
    assert.throws(() => selecionarFatia(rotas, fatia), /Fatia inválida/);
  }
  assert.throws(() => selecionarFatia([]), /Fatia inválida/);
});

test("fatia ausente, repetida, incompatível ou rota omitida reprova a consolidação", () => {
  assert.throws(() => consolidarOrcamentos(relatorios().slice(1), rotas), /incompletos/);
  const repetidas = relatorios();
  repetidas[1] = repetidas[0];
  assert.throws(() => consolidarOrcamentos(repetidas, rotas), /repetidas/);
  const incompletas = relatorios();
  incompletas[1].resultados.pop();
  assert.throws(() => consolidarOrcamentos(incompletas, rotas), /incompleta/);
  const bases = relatorios();
  bases[2].base = "http://outra-build";
  assert.throws(() => consolidarOrcamentos(bases, rotas), /incompatíveis/);
});

test("rota duplicada, extra ou na fatia errada não compensa uma rota que faltou", () => {
  for (const substituta of [rotas[0], "/app/inventada", rotas[1]]) {
    const partes = relatorios();
    partes[0].resultados[1].rota = substituta;
    assert.throws(() => consolidarOrcamentos(partes, rotas), /repetida ou fora da fatia/);
  }
});

test("resultado corrompido reprova e problemas reais continuam presentes no consolidado", () => {
  const invalidos = relatorios();
  invalidos[0].resultados[0].abertura = undefined;
  assert.throws(() => consolidarOrcamentos(invalidos, rotas), /Resultado inválido/);
  const comProblema = relatorios();
  comProblema[0].resultados[0].problemas.push("polling");
  comProblema[0].resultados[0].parada = 3;
  const resultado = consolidarOrcamentos(comProblema, rotas).resultados.find((r) => r.rota === rotas[0]);
  assert.deepEqual(resultado.problemas, ["polling"]);
  assert.equal(resultado.parada, 3);
});
