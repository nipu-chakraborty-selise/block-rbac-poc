import env from '@next/env';
import {backendClient,runtimeConfig} from '../src/lib/blocks-runtime';
import {BlocksDataRepository,type GatewayContracts} from '../src/lib/blocks-data';
import contracts from '../blocks/data/contracts.json';
env.loadEnvConfig(process.cwd());
const backend=backendClient(),config=runtimeConfig();
const repo=new BlocksDataRepository({apiUrl:config.apiUrl,xBlocksKey:config.projectKey,accessToken:()=>backend.auth.accessToken()},contracts as GatewayContracts);
const rows=await repo.list('departments');console.log('Live Department read succeeded:',{total:rows.total});
const me=await backend.auth.userInfo();console.log('Service claim field names:',Object.keys(me));
const token=await backend.auth.accessToken();if(token){const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());console.log('Validated service token context:',{fields:Object.keys(claims),roles:claims.roles,tenant_id:claims.tenant_id,tenantId:claims.tenantId,projectKey:claims.projectKey});}
