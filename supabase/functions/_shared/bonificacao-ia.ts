// Arquivo: supabase/functions/_shared/bonificacao-ia.ts
//
// Chat de I.A do Comparativo individual da Bonificação Coletiva (12/11/2026,
// Pablo: "adiciona uma I.A pra fazer perguntas pra ela sobre esse comparativo
// individual e valores"). Lógica pura (prompt e saneamento das mensagens),
// testada pelo Vitest em src/test/bonificacao-ia.test.ts — a Edge
// bonificacao-ia só autentica, confere o acesso e chama o provedor.
//
// O CONTEXTO vem da tela: é exatamente o que o usuário está vendo no mês
// filtrado (notas, critérios, valores e cada entrega com a origem do valor e
// a observação do gestor). A Edge não amplia nada: quem não tem
// sistemas_bonificacao/visualizar nem chega a chamar o modelo.

export const MAX_PERGUNTA_CHARS = 2000;
export const MAX_MENSAGENS_HISTORICO = 12;
export const MAX_CONTEXTO_CHARS = 80000;

export interface MensagemChat { role: "user" | "assistant"; content: string }

export const SYSTEM_PROMPT_BONIFICACAO = `Você é o assistente da tela Bonificação Coletiva da Equipe (Sistemas) do Grupo Nascimento.
Responde em português do Brasil, direto e com números exatos do CONTEXTO.

COMO A TELA FUNCIONA (use para explicar, nunca contradiga):
- O período é um mês: entram só os chamados CONCLUÍDOS naquele mês.
- "Mercado IA" de um desenvolvedor é a SOMA do valor de mercado (software house) das entregas dele no mês; "Freelancer IA" é a soma do valor freelancer; "Média por entrega" é Mercado ÷ número de entregas.
- O valor de cada entrega vem da avaliação do gestor (origem "gestor", com a observação explicando o porte) ou, sem avaliação, do parecer da I.A do chamado (origem "ia"). Sem nenhum dos dois, vale R$ 0 (origem "sem valor").
- "Lucro" de uma entrega = valor de mercado − custo real conosco (horas da equipe interna × hora do salário, R$ 3.138,65 ÷ 220 h); "lucro_total" soma o do mês. Mostra quanto a empresa economizou fazendo dentro de casa.
- Esses valores são ESTIMATIVAS do que custaria contratar fora; não são economia comprovada e NÃO mudam o pagamento: a bonificação é igual para todos os participantes.
- A nota individual (0 a 100) pondera os critérios Qualidade, Satisfação, Prazo, Dificuldade e Valor da tarefa pelos pesos do mês; ela é só acompanhamento e não altera a cota.

REGRAS:
1. Use SOMENTE os dados do CONTEXTO. Nunca invente chamado, valor, nota ou pessoa.
2. Ao explicar um valor, cite os chamados que o compõem (número e assunto) e some certo. Mostre a conta quando ajudar.
3. Se perguntarem algo que o contexto não tem, diga que a tela não traz essa informação.
4. Comparações entre pessoas: seja neutro e factual (quantidade de entregas, porte, média), sem julgar ninguém.
5. Valores em reais no formato R$ 1.234,56. Sem markdown pesado: frases curtas e listas simples.`;

const texto = (v: unknown, max: number) => String(v ?? "").slice(0, max);

/** Histórico vindo da tela → só papéis válidos, sem vazio, tamanho limitado. */
export function normalizarMensagens(valor: unknown): MensagemChat[] {
  return (Array.isArray(valor) ? valor : [])
    .map((item: unknown) => {
      const m = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const role: MensagemChat["role"] = m.role === "assistant" ? "assistant" : "user";
      return { role, content: texto(m.content, MAX_PERGUNTA_CHARS).trim() };
    })
    .filter((m) => m.content.length > 0)
    .slice(-MAX_MENSAGENS_HISTORICO);
}

/** Mensagens para o provedor: system + histórico, com o contexto na última pergunta. */
export function montarMensagensBonificacao(
  contexto: string,
  rotuloMes: string,
  mensagens: MensagemChat[],
): { role: string; content: string }[] {
  const ultima = mensagens[mensagens.length - 1];
  const anteriores = mensagens.slice(0, -1);
  return [
    { role: "system", content: SYSTEM_PROMPT_BONIFICACAO },
    ...anteriores,
    {
      role: "user",
      content: `CONTEXTO — Comparativo individual de ${rotuloMes} (JSON, valores em R$):\n${texto(contexto, MAX_CONTEXTO_CHARS)}\n\nPERGUNTA: ${ultima?.content ?? ""}`,
    },
  ];
}
