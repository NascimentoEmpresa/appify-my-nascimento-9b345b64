import { describe, expect, it } from "vitest";
import { conferirPessoa, conferirValor, juntarLeituras, lerTextoRecibo, paraNumero, valorPorExtenso } from "@/lib/rh/reciboFerias";

// Saída REAL do OCR (tesseract, por) sobre um recibo escaneado da Senior —
// inclusive os erros: a linha "Totais" virou lixo e o salário base
// "3.371,30" saiu "3:37 1:30". Nome, CPF e CTPS trocados por fictícios.
const OCR = `0005 - NH PRESTACAO DE SERVICOS LTDA Pág.: 1
Recibo de Férias
Empresa: NH PRESTACAO DE SERVICOS LTDA CNPJ: 18.615.832/0001-88
Cadastro: 000000100 - MARIA TESTE DA SILVA CPF: 123.456.789-09
Cargo: 0200 - SUPERVISOR DE DEPARTAMENTO PESSOAL

Depend. IR: o
Período Aquisitivo........: 29/01/2025 a 28/01/2026 Número CTPS: 000000000
Período das Férias......: 19/01/2026 a 23/01/2026 Série CTPS...: 9005 -RS
Retorno ao Trabalho...: 26/01/2026 Dias Férias....: 5,00
Pagamento do Recibo: 16/01/2026 Dias Abono....: 0,00
Salário Base.................. 3:37 1:30 Dias Licença..: 0,00
Evento Descrição Referência Proventos Descontos

0005 Horas Férias Diurnas 36,67 561,88

0558 1/3 Férias 187,29

2002 INSS Férias 7,50 56,18

| (e E] | apa 749,17 56,18
Líquido.........: 692,99
Recebi a importância de R$ 692,99 (seiscentos e noventa e dois reais e noventa e nove centavos ) referente
a quitação das férias.
TRIUNFO, 16 de Janeiro de 2026.`;

const ESPERADO = { cpf: "123.456.789-09", matricula: "100", nome: "MARIA TESTE DA SILVA", dataSaida: "2026-01-19", diasFerias: 5 };

describe("Recibo de férias da Senior — leitura", () => {
  it("lê o recibo real do OCR", () => {
    const l = lerTextoRecibo(OCR);
    expect(l.liquido).toBe(692.99);
    expect(l.importancia).toBe(692.99);
    expect(l.extenso).toBe(692.99);
    expect(l.proventos).toBe(749.17);
    expect(l.descontos).toBe(56.18);
    expect(l.cadastro).toBe("100");
    expect(l.cpf).toBe("12345678909");
    expect(l.empresaCodigo).toBe("5");
    expect(l.periodoInicio).toBe("2026-01-19");
    expect(l.periodoFim).toBe("2026-01-23");
    expect(l.pagamento).toBe("2026-01-16");
    expect(l.diasFerias).toBe(5);
  });

  it("valor confiável: líquido + 3 provas", () => {
    const c = conferirValor(lerTextoRecibo(OCR));
    expect(c.valor).toBe(692.99);
    expect(c.confiavel).toBe(true);
    expect(c.provas).toHaveLength(4);
    expect(c.problemas).toEqual([]);
  });

  it("um dígito trocado pelo OCR derruba a confiança (nunca puxa errado)", () => {
    const c = conferirValor(lerTextoRecibo(OCR.replace("Líquido.........: 692,99", "Líquido.........: 892,99")));
    expect(c.confiavel).toBe(false);
    expect(c.problemas.length).toBeGreaterThanOrEqual(2);
  });

  it("importância divergente também derruba, mesmo com extenso e totais certos", () => {
    const c = conferirValor(lerTextoRecibo(OCR.replace("importância de R$ 692,99", "importância de R$ 682,99")));
    expect(c.confiavel).toBe(false);
  });

  it("só o líquido lido (sem provas) não é confiável", () => {
    const c = conferirValor(lerTextoRecibo("Líquido.........: 692,99"));
    expect(c.valor).toBe(692.99);
    expect(c.confiavel).toBe(false);
  });

  it("sem líquido: nada", () => {
    const c = conferirValor(lerTextoRecibo("Recibo de Férias\nilegível"));
    expect(c.valor).toBeNull();
    expect(c.confiavel).toBe(false);
  });

  it("dois recibos no mesmo arquivo: recusa", () => {
    const dois = OCR + "\n" + OCR.replace(/692,99/g, "1.234,56").replace("749,17 56,18", "1.300,00 65,44");
    const c = conferirValor(lerTextoRecibo(dois));
    expect(c.confiavel).toBe(false);
    expect(c.problemas[0]).toMatch(/mais de um recibo/);
  });

  it("valor por extenso", () => {
    expect(valorPorExtenso("seiscentos e noventa e dois reais e noventa e nove centavos")).toBe(692.99);
    expect(valorPorExtenso("dois mil, trezentos e quarenta e dois reais e vinte centavos")).toBe(2342.2);
    expect(valorPorExtenso("um mil reais")).toBe(1000);
    expect(valorPorExtenso("cem reais")).toBe(100);
    expect(valorPorExtenso("doze mil oitocentos e quarenta e sete reais e trinta e três centavos")).toBe(12847.33);
    expect(valorPorExtenso("noventa centavos")).toBe(0.9);
    expect(valorPorExtenso("seiscentos e novxnta reais")).toBeNull(); // OCR comeu letra: não prova nada
  });

  it("paraNumero só aceita dinheiro com centavos", () => {
    expect(paraNumero("1.234,56")).toBe(1234.56);
    expect(paraNumero("692,99")).toBe(692.99);
    expect(paraNumero("3:37 1:30")).toBeNull();
    expect(paraNumero("692")).toBeNull();
  });

  it("junta texto do PDF com o OCR sem sobrescrever o que já foi lido", () => {
    const vazio = lerTextoRecibo("");
    const j = juntarLeituras(vazio, lerTextoRecibo(OCR));
    expect(j.liquido).toBe(692.99);
    expect(j.liquidos).toEqual([692.99]);
  });
});

describe("Recibo de férias — de quem é", () => {
  it("CPF e período batem", () => {
    const p = conferirPessoa(lerTextoRecibo(OCR), ESPERADO);
    expect(p.bloqueios).toEqual([]);
    expect(p.avisos).toEqual([]);
    expect(p.ok.length).toBe(2);
  });

  it("CPF de outra pessoa bloqueia", () => {
    const p = conferirPessoa(lerTextoRecibo(OCR), { ...ESPERADO, cpf: "987.654.321-00" });
    expect(p.bloqueios[0]).toMatch(/CPF/);
  });

  it("sem CPF legível, matrícula e nome diferentes bloqueiam", () => {
    const semCpf = OCR.replace(/CPF: [\d.-]+/, "CPF: ilegivel");
    const p = conferirPessoa(lerTextoRecibo(semCpf), { ...ESPERADO, matricula: "555", nome: "JOAO OUTRO NOME" });
    expect(p.bloqueios.length).toBe(1);
  });

  it("período diferente é aviso (o RH confirma), não bloqueio", () => {
    const p = conferirPessoa(lerTextoRecibo(OCR), { ...ESPERADO, dataSaida: "2026-02-02", diasFerias: 10 });
    expect(p.bloqueios).toEqual([]);
    expect(p.avisos.length).toBe(2);
  });
});
