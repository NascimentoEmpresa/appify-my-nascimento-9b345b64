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
// POR QUE TEM LITERAL DE FALLBACK
// O build de produção roda no Lovable, que neste projeto não injeta VITE_* —
// é do formato antigo, em que o `client.ts` gerado já vinha com os valores
// escritos no código. Sem o fallback, o bundle sairia com `undefined` e o app
// subiria quebrado. Quem tem `.env` (dev, ou um build fora do Lovable) usa o
// `.env`; quem não tem, usa o literal e o build passa do mesmo jeito.
//
// Não é perda de segurança: a chave anon é publicável e vai para o navegador
// nos dois caminhos. O que se ganha aqui é um lugar só para trocá-la.
// =====================================================================
const url = import.meta.env.VITE_SUPABASE_URL || "https://fwmzeaztjxrxxzxzxmgc.supabase.co";
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI";

export const SUPABASE_URL: string = url;
export const SUPABASE_ANON_KEY: string = anonKey;

/**
 * Base das Edge Functions. As páginas públicas usam só isto — endereço, sem
 * credencial nenhuma. É o que permite ao Canal de Ética falar com o servidor
 * sem carregar token algum no navegador.
 */
export const SUPABASE_FUNCTIONS_URL = `${url}/functions/v1`;
