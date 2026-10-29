import env from '@next/env';
import {writeFileSync} from 'node:fs';
import {backendClient} from '../src/lib/blocks-runtime';
import {provisionUser} from '../src/lib/live-users';

env.loadEnvConfig(process.cwd());
try {
  const client=backendClient();
  const token=await client.auth.accessToken();
  if(!token)throw new Error();
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  const required='blocks-iam::iam::mutate-users';
  const permissionInServiceToken=JSON.stringify(claims.permissions||claims.permission||[]).includes(required);
  const countryId='b00ac762-4b4d-4568-896e-ecdddb1e312c';
  // Confirm this account already belongs to the country before using the provisioning path.
  // This check deliberately performs no account creation or country grant.
  const directory=await client.iam.users.list({page:0,pageSize:100,filter:{email:'pro.nipu@gmail.com',organizationId:countryId}});
  const existing=directory.data?.find(u=>u.email==='pro.nipu@gmail.com');
  if(directory.isSuccess===false||!existing?.itemId)throw new Error();
  const user=await provisionUser(countryId,{email:'pro.nipu@gmail.com',accountMode:'existing'});
  if(user.id!==existing.itemId)throw new Error();
  const report={checkedAt:new Date().toISOString(),permissionInServiceToken,permissionClaimNote:"IAM tokens may omit permission resources; CLI permission read-back confirms the assigned role. This is not proof of write-endpoint access.",existingCountryMemberResolved:true,liveAccountsCreated:0,liveCountryGrantsPerformed:0,remainingVerification:['new-account activation','country membership without IAM roles or permissions']};
  writeFileSync('docs/user-provisioning-evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch {
  console.error('Live user-provisioning verification failed. Sensitive API output suppressed.');
  process.exitCode=1;
}
