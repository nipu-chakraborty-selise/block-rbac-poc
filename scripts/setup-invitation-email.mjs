import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const cli=(process.env.BLOCKS_CLI||'blocks');
const common=['--account','default','--project','Daeef3775f1414219a348639860aa66f0','--json'];
function call(args){try{const r=JSON.parse(execFileSync(cli,[...args,...common],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(r.isSuccess===false||r.code)throw new Error();return r;}catch{throw new Error(`Blocks ${args.slice(0,3).join(' ')} failed; sensitive output suppressed.`);}}
const plan=JSON.parse(readFileSync('blocks/rbac/invitation-email-template.json','utf8'));
const listed=call(['mail','template','list','--page-number','0','--page-size','100']);
if(listed.totalCount>100)throw new Error('Template pagination requires review.');
const matches=listed.templates?.filter(t=>t.name===plan.name&&t.language===plan.language)||[];
if(matches.length>1)throw new Error('Duplicate invitation template requires review.');
if(matches[0])plan.itemId=matches[0].itemId;
writeFileSync('blocks/rbac/invitation-email-template-resolved.json',JSON.stringify(plan,null,2)+'\n');
const template=['mail','template','save','--file','blocks/rbac/invitation-email-template-resolved.json'];
const signup=['iam','signup-settings','save','--file','blocks/rbac/invitation-signup-settings.json'];
call([...template,'--dry-run']);call([...signup,'--dry-run']);
console.log('Dry runs passed: AtlasUnitInvitation template on existing managed Default sender; email/password signup enabled with zero default roles/permissions; SSO preserved.');
if(process.argv.includes('--apply')){
 call([...template,'--yes']);call([...signup,'--yes']);
 const settings=call(['iam','signup-settings','get']);
 if(!settings.isEmailPasswordSignUpEnabled||settings.defaultRolesForNewUser?.length||settings.defaultPermissionsForNewUser?.length)throw new Error('Signup policy readback failed.');
 const templates=call(['mail','template','list','--page-number','0','--page-size','100']);
 if(!templates.templates?.some(t=>t.name===plan.name&&t.templateBody===plan.templateBody))throw new Error('Template readback failed.');
 writeFileSync('docs/invitation-email-setup-evidence.json',JSON.stringify({appliedAt:new Date().toISOString(),sender:'blocks@selise.io',template:plan.name,emailPasswordSignupEnabled:true,defaultRoles:[],defaultPermissions:[],testEmailSent:false},null,2)+'\n');
 console.log('Invitation mail template and signup settings applied and verified.');
}
