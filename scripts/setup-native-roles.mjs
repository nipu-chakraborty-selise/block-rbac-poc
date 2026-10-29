import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cli=process.env.BLOCKS_CLI||'blocks';
const common=['--account','default','--project','Daeef3775f1414219a348639860aa66f0','--json'];
const resources=['blocks-iam::iam::roles','blocks-iam::iam::mutate-roles'];
function call(args){try{const response=JSON.parse(execFileSync(cli,[...args,...common],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(response.isSuccess===false||response.code)throw new Error();return response;}catch{throw new Error('Blocks role setup failed; sensitive output suppressed.');}}
const args=['iam','roles','assign-permissions','atlas-data-backend','--add-permissions',resources.join(','),'--organization-id','default'];
call([...args,'--dry-run']);console.log('Dry run passed: View Roles and Manage Roles for atlas-data-backend only.');
if(process.argv.includes('--apply')){
 // Requires approval for this exact grant; never creates roles or assigns business users.
 call([...args,'--yes']);
 const readback=call(['iam','permissions','list','--search','Role','--page','1']);
 if(readback.totalCount>readback.data?.length||!resources.every(resource=>readback.data?.some(p=>p.resource===resource&&p.roles?.includes('atlas-data-backend'))))throw new Error('Native role permission readback failed.');
 writeFileSync('docs/native-role-setup-evidence.json',JSON.stringify({verifiedAt:new Date().toISOString(),cliVersion:execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),backendRole:'atlas-data-backend',permissions:resources,existingRolesChanged:false,businessUserAssignmentsChanged:false},null,2)+'\n');
 console.log('Native role backend permissions applied and read back.');
}
