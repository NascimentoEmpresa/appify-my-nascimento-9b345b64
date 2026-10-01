// ============================================================================
//  Gera o .env da replica: JWT_SECRET + as chaves anon e service_role
// ============================================================================
//
//  POR QUE ISSO EXISTE
//  Na Supabase gerenciada, essas tres coisas vem prontas no painel. Na replica
//  self-hosted, voce gera. E elas precisam ser COERENTES entre si: as chaves
//  anon e service_role sao JWTs ASSINADOS com o JWT_SECRET. Se nao baterem,
//  nada funciona - o PostgREST recusa todo token e a aplicacao abre em branco.
//
//  Usa so o crypto nativo do Node, sem dependencia externa.
//
//  USO:  node gerar-chaves.mjs
//        (nao sobrescreve um .env existente sem --forcar)
// ============================================================================

import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, '.env');
const forcar = process.argv.includes('--forcar');

if (existsSync(destino) && !forcar) {
  console.error('.env ja existe. Use --forcar para sobrescrever.');
  console.error('ATENCAO: sobrescrever gera chaves NOVAS e invalida os tokens antigos.');
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function assinarJwt(payload, segredo) {
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify(payload));
  const assinatura = b64url(createHmac('sha256', segredo).update(`${cabecalho}.${corpo}`).digest());
  return `${cabecalho}.${corpo}.${assinatura}`;
}

// O segredo tem que ter no minimo 32 caracteres; uso 48 por folga.
const jwtSecret = randomBytes(36).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 48);
const senhaPostgres = randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

const agora = Math.floor(Date.now() / 1000);
const dezAnos = agora + 60 * 60 * 24 * 365 * 10;

const anonKey = assinarJwt({ role: 'anon', iss: 'supabase', iat: agora, exp: dezAnos }, jwtSecret);
const serviceKey = assinarJwt({ role: 'service_role', iss: 'supabase', iat: agora, exp: dezAnos }, jwtSecret);

const env = `# Gerado por gerar-chaves.mjs em ${new Date().toISOString()}
# NAO COMMITAR ESTE ARQUIVO. Ele esta no .gitignore.

# Senha do Postgres da replica
POSTGRES_PASSWORD=${senhaPostgres}

# Segredo que assina os tokens. As duas chaves abaixo derivam dele.
JWT_SECRET=${jwtSecret}

# A chave publica, que vai no frontend (equivale a VITE_SUPABASE_ANON_KEY)
ANON_KEY=${anonKey}

# A chave administrativa. IGNORA TODA A RLS - tratar como senha de root.
SERVICE_ROLE_KEY=${serviceKey}

# Endereco pelo qual o navegador alcanca a replica.
# Local:   http://localhost:8000
# Tunel:   https://<algo>.trycloudflare.com  (para testar de fora, ex. Vercel)
URL_EXTERNA=http://localhost:8000
URL_SITE=http://localhost:8080

# Portas expostas no host
PORTA_API=8000
PORTA_POSTGRES=55432
`;

writeFileSync(destino, env, 'utf8');

console.log('.env gerado em', destino);
console.log('');
console.log('Para o frontend apontar para a replica, use:');
console.log('  VITE_SUPABASE_URL=http://localhost:8000');
console.log('  VITE_SUPABASE_ANON_KEY=' + anonKey);
console.log('');
console.log('A SERVICE_ROLE_KEY ignora toda a RLS. Nunca vai para o frontend.');
