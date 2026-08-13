// =====================================================================
// CREDENCIAIS DO SUPABASE — um lugar só, vindo do .env
//
// URL e chave anon saem de VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em vez
// de literal no código. Ganho real: credencial fora do versionamento e
// rotação num arquivo só, em vez de caçar a string em cada cliente.
//
// O QUE ISSO NÃO FAZ — para não gerar falsa sensação de segurança:
// o Vite embute qualquer VITE_* no JavaScript final. A chave anon continua
// indo para o navegador de quem abre o ERP, porque é assim que um cliente
// Supabase funciona. Quem protege os dados é a RLS e os grants (o
// CANAL_DENUNCIA, por exemplo, tem o grant revogado do anon), nunca o sigilo
// desta chave. Se a intenção for tirar de circulação uma chave que já rodou,
// o caminho é rotacionar no painel do Supabase — trocar de lugar não basta.
//
// SEM LITERAL DE FALLBACK — e o que isso exige
// Nenhuma credencial escrita aqui: os valores vêm exclusivamente do `.env`,
// que NÃO é versionado. Consequência: toda máquina que rode `npm run build`
// precisa ter o arquivo (ou as variáveis no ambiente). Se o build de produção
// rodar sem elas, ele PARA — ver a guarda no vite.config.ts. É de propósito:
// sem a guarda o Vite embutiria `undefined` e o app subiria quebrado só no
// primeiro request, que foi como a produção ficou num bundle velho em
// 12/08/2026 sem ninguém perceber.
// =====================================================================
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não estão definidas. " +
      "Copie o .env.example para .env e preencha antes de rodar o build.",
  );
}

export const SUPABASE_URL: string = url;
export const SUPABASE_ANON_KEY: string = anonKey;

/**
 * Base das Edge Functions. As páginas públicas usam só isto — endereço, sem
 * credencial nenhuma. É o que permite ao Canal de Ética falar com o servidor
 * sem carregar token algum no navegador.
 */
export const SUPABASE_FUNCTIONS_URL = `${url}/functions/v1`;
