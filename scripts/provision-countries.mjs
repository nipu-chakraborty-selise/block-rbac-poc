import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cli=(process.env.BLOCKS_CLI||'blocks');const common=['--account','default','--project','Daeef3775f1414219a348639860aa66f0','--json'];
function call(args){const data=JSON.parse(execFileSync(cli,[...args,...common],{encoding:'utf8',maxBuffer:4*1024*1024}));if(data.isSuccess===false||data.code)throw new Error('Blocks country provisioning failed.');return data;}
const countries=[['BD','Bangladesh'],['DE','Germany'],['NP','Nepal']];
for(const [code,name] of countries){writeFileSync(`blocks/plans/country-${code}.json`,JSON.stringify({name,description:`Atlas country organization (${code})`,attributes:{countryCode:code}},null,2)+'\n');}
if(!process.argv.includes('--apply')){console.log(call(['iam','organizations','config','save','--allow-org-creation-from-cloud','--dry-run']));for(const [code]of countries)console.log(call(['iam','organizations','create','--file',`blocks/plans/country-${code}.json`,'--dry-run']));process.exit(0)}
call(['iam','organizations','config','save','--allow-org-creation-from-cloud','--yes']);
let list=call(['iam','organizations','list','--page','0','--page-size','100']);
for(const [code,name]of countries){if(!(list.organizations||[]).some(o=>o.name===name)){call(['iam','organizations','create','--file',`blocks/plans/country-${code}.json`,'--yes']);list=call(['iam','organizations','list','--page','0','--page-size','100']);}}
const mapping=countries.map(([code,name])=>{const org=list.organizations.find(o=>o.name===name);if(!org?.itemId)throw new Error('Created country ID not found.');return {code,name,id:org.itemId,isDisabled:org.isDisabled}});writeFileSync('blocks/plans/country-mapping.json',JSON.stringify(mapping,null,2)+'\n');console.log('IAM country organizations ready:',mapping.map(c=>({code:c.code,id:c.id})));
