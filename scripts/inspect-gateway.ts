import env from '@next/env';
import {writeFileSync} from 'node:fs';
import {backendClient} from '../src/lib/blocks-runtime';
env.loadEnvConfig(process.cwd());
const client=backendClient();
const result=await client.data.graphql({operationName:'InspectAtlasSchema',query:'query InspectAtlasSchema { __schema { queryType { name fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { name kind ofType { kind name } } } } mutationType { name fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { name kind ofType { kind name } } } } types { kind name fields { name type { kind name ofType { kind name ofType { kind name } } } } inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } } }'}) as {errors?:unknown;data?:unknown};
if(result.errors||!result.data)throw new Error('Gateway introspection failed. No credentials or raw response printed.');
writeFileSync('blocks/data/runtime-schema.json',JSON.stringify(result.data,null,2)+'\n');console.log('Authenticated runtime GraphQL schema saved. No records or tokens printed.');
