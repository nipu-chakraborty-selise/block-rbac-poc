// Administrative CLI orchestration. Runtime credentials are freshly generated service credentials,
// never copied from the CLI token store. Secrets are only written to ignored .env.local.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const cli=process.env.BLOCKS_CLI||'blocks';
const common=['--account','default','--project','Daeef3775f1414219a348639860aa66f0','--json'];
function call(args){let text;try{text=execFileSync(cli,[...args,...common],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024})}catch{throw new Error(`Blocks CLI failed during ${args.slice(0,3).join(' ')}. No credential output printed.`)}const data=JSON.parse(text);if(data.code||data.isSuccess===false)throw new Error(`Blocks CLI rejected ${args.slice(0,3).join(' ')}.`);return data;}
const roleArgs=['iam','roles','create','--name','Atlas Data Backend','--slug','atlas-data-backend'];
const backendArgs=['auth','client-credentials','save','--name','Atlas RBAC Backend','--active','--roles','atlas-data-backend','--access-token-valid-minutes','5'];
const browserArgs=['auth','oidc-clients','save','--client-display-name','Atlas RBAC Portal','--client-type','public','--active','--require-pkce','--use-tokens-cookie=false','--redirect-uris','https://dbzxpj.slsblx.com:3000/login/callback,https://dbzxpj.slsblx.com/login/callback','--post-logout-redirect-uris','https://dbzxpj.slsblx.com:3000,https://dbzxpj.slsblx.com','--allowed-response-types','code','--allowed-scopes','openid,profile,email','--register-as-identity-provider','--oidc-url','https://iam.seliseblocks.com'];
if(!process.argv.includes('--apply')){for(const args of [roleArgs,backendArgs,browserArgs])console.log(JSON.stringify(call([...args,'--dry-run']),null,2));process.exit(0)}
const roles=call(['iam','roles','list']);if(!(roles.data||[]).some(r=>r.slug==='atlas-data-backend'))call([...roleArgs,'--yes']);
let credentials=call(['auth','client-credentials','list']);let backend=(Array.isArray(credentials)?credentials:credentials.data||credentials.clientCredentials||[]).find(c=>c.name==='Atlas RBAC Backend');
if(!backend){call([...backendArgs,'--yes']);credentials=call(['auth','client-credentials','list']);backend=(Array.isArray(credentials)?credentials:credentials.data||credentials.clientCredentials||[]).find(c=>c.name==='Atlas RBAC Backend')}
if(!backend)throw new Error('Backend credential not found after creation.');
const backendId=backend.clientId||backend.client_id||backend.itemId;const backendSecret=backend.clientSecret||backend.client_secret;
if(!backendId||!backendSecret){console.log('Credential field names:',Object.keys(backend));throw new Error('Unexpected backend credential contract. Nothing printed.');}
let clients=call(['auth','oidc-clients','list']);let browser=(clients.oIDCClientCredentials||[]).find(c=>c.clientDisplayName==='Atlas RBAC Portal');
if(!browser){call([...browserArgs,'--yes']);clients=call(['auth','oidc-clients','list']);browser=(clients.oIDCClientCredentials||[]).find(c=>c.clientDisplayName==='Atlas RBAC Portal')}
const browserId=browser?.clientId||browser?.client_id;
if(!browserId){console.log('Public client field names:',Object.keys(browser||{}));throw new Error('Unexpected public client contract.');}
call(['auth','config','save','--oidc-enabled','--account-action-base-url','https://dbzxpj.slsblx.com','--dry-run']);call(['auth','config','save','--oidc-enabled','--account-action-base-url','https://dbzxpj.slsblx.com','--yes']);
let env=existsSync('.env.local')?readFileSync('.env.local','utf8'):'';
const values={BLOCKS_PROJECT_KEY:'Daeef3775f1414219a348639860aa66f0',BLOCKS_API_URL:'https://api.seliseblocks.com',BLOCKS_APP_DOMAIN:'https://dbzxpj.slsblx.com',BLOCKS_OIDC_URL:'https://iam.seliseblocks.com',BLOCKS_PUBLIC_CLIENT_ID:browserId,BLOCKS_BACKEND_CLIENT_ID:backendId,BLOCKS_BACKEND_CLIENT_SECRET:backendSecret};
if(!/^SESSION_SECRET=/m.test(env))values.SESSION_SECRET=randomBytes(32).toString('hex');
for(const [key,value]of Object.entries(values)){const line=`${key}=${JSON.stringify(String(value).replace(/\$/g,'\\$'))}`;env=new RegExp(`^${key}=.*$`,'m').test(env)?env.replace(new RegExp(`^${key}=.*$`,'m'),()=>line):`${env.trimEnd()}\n${line}\n`;}
writeFileSync('.env.local',env,{mode:0o600});console.log('Runtime login and backend credentials configured. Values stored in ignored .env.local; no CLI tokens copied.');console.log({publicClientId:browserId,backendRole:'atlas-data-backend',credentialFields:Object.keys(backend)});
