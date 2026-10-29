import env from '@next/env';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backendClient, runtimeConfig, tokens} from '../src/lib/blocks-runtime';
import {createBlocksClient} from '@seliseblocks/client';
import {liveStateRepository} from '../src/lib/rbac/repository';
import {emptyState, type Identity} from '../src/lib/rbac/model';
import {Rbac} from '../src/lib/rbac/service';
env.loadEnvConfig(process.cwd());
const password=process.env.DEMO_USER_PASSWORD;
if(!password || password.length<8) throw new Error('Set DEMO_USER_PASSWORD before running.');
const apply=process.argv.includes('--apply');
const emailDomain=process.env.DEMO_EMAIL_DOMAIN||'yopmail.com';
if(!['example.com','yopmail.com'].includes(emailDomain))throw new Error('Unsupported demo email domain.');
const replaceExample=process.argv.includes('--replace-example');
if(replaceExample&&emailDomain!=='yopmail.com')throw new Error('Replacement requires yopmail.com.');
const directory=mkdtempSync(join(tmpdir(),'atlas-demo-users-'));
const countries=[
  {id:'b00ac762-4b4d-4568-896e-ecdddb1e312c',name:'Bangladesh',code:'bd',names:['Amina Rahman','Karim Hasan','Farhana Akter','Rafi Ahmed']},
  {id:'b0cd4b93-dd9b-4038-a031-5f3ad928a7f5',name:'Nepal',code:'np',names:['Sita Sharma','Arjun Thapa','Maya Gurung','Bikash Rai']},
  {id:'3fc0710f-85bf-4478-8cf5-6be2d7586fc1',name:'Germany',code:'de',names:['Anna Weber','Lukas Fischer','Mia Schneider','Jonas Becker']},
];
const kinds=['organization-admin','unit-admin','unit-user','member'] as const;
const client=backendClient();
const report: Record<string,unknown>[]=[];
let stage='start';
function cli(args:string[]) {
  const result=JSON.parse(execFileSync((process.env.BLOCKS_CLI||'blocks'),
    [...args,'--account','default','--project',runtimeConfig().projectKey,'--json'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,BLOCKS_STRICT_FLAGS:'1'}}));
  if(result.isSuccess===false || result.code) throw new Error('CLI operation failed');
  return result;
}
async function find(email:string,organizationId?:string) {
  const result=await client.iam.users.list({page:0,pageSize:100,filter:{email,...(organizationId?{organizationId}:{})}});
  if(result.isSuccess===false || !Array.isArray(result.data) || Number(result.totalCount)>100) throw new Error('Lookup failed');
  const matches=result.data.filter(u=>u.email?.toLowerCase()===email);
  if(matches.length>1) throw new Error('Duplicate account');
  return matches[0];
}
try {
  const root=await find('pro.nipu@gmail.com');
  if(!root?.itemId || !root.active || !root.isVerified) throw new Error('Root identity unavailable');
  const actor:Identity={id:root.itemId,email:root.email!,name:'Application Super Admin',active:true,verified:true,superAdmin:true,organizationIds:[]};
  const repository=liveStateRepository();
  for(const country of countries) {
    const users:Identity[]=[];
    for(const [index,kind] of kinds.entries()) {
      const email=`atlas.${country.code}.${kind}@${emailDomain}`;
      stage=`${country.name}: ${kind}`;
      let user=await find(email);
      if(!user) {
        const file=join(directory,`${country.code}-${kind}.json`);
        writeFileSync(file,JSON.stringify({email,userName:email,firstName:country.names[index],password,organizationId:country.id,roles:[],permissions:[],sendMail:false,notifyUser:false}),{mode:0o600});
        const args=['iam','users','create','--file',file];
        cli([...args,'--dry-run']);
        if(apply) {cli([...args,'--yes']); user=await find(email);}
        rmSync(file);
      }
      if(!apply) {console.log(`Reviewed ${email} (${kind}, ${country.name})`);continue;}
      if(!user?.itemId) throw new Error('Created user not found');
      if(!user.active || !user.isVerified) {
        const args=['iam','users','activate',user.itemId,'--reason','User-approved development RBAC test account'];
        cli([...args,'--dry-run']);
        cli([...args,'--yes']);
        user=await find(email);
      }
      if(!user?.itemId || !user.active || !user.isVerified) throw new Error('Account is not active and verified');
      if(!(await find(email,country.id))) {
        const args=['iam','users','access','grant',user.itemId,'--organization-id',country.id,'--roles','[]','--permissions','[]'];
        cli([...args,'--dry-run']);cli([...args,'--yes']);
      }
      if(!(await find(email,country.id))) throw new Error('Country membership missing');
      users.push({id:user.itemId!,email,name:country.names[index],active:true,verified:true,superAdmin:false,organizationIds:[country.id]});
      report.push({name:country.names[index],email,organization:country.name,role:kind,unit:kind.startsWith('unit-')?'Demo Team':null});
      console.log(`Account ready: ${email}`);
    }
    if(!apply)continue;
    stage=`${country.name}: RBAC assignments`;
    const saved=await repository.load(country.id);
    const state=saved?.state||emptyState({...country,status:'active'});
    const service=new Rbac(state,actor);
    users.forEach((user,index)=>service.addOrganizationMember(user,index===0?'organization-admin':'member'));
    let unit=state.units.find(u=>u.name==='Demo Team');
    if(unit?.status==='archived') throw new Error('Existing Demo Team is archived');
    if(!unit) {const created=service.saveUnit(undefined,{name:'Demo Team'});unit=state.units.find(u=>u.id===created.id)!;}
    service.assign(users[1],unit.id,'unit-admin');
    service.assign(users[2],unit.id,'unit-user');
    if(!saved)service.event('organization.initialized',country.id);
    await repository.commit(state,saved);
    const readback=await repository.load(country.id);
    if(!readback || users.some((user,index)=>!readback.state.members.some(m=>m.userId===user.id && m.status==='active' && m.role===(index===0?'organization-admin':'member'))))throw new Error('Role readback failed');
    for(const [index,role] of [[1,'unit-admin'],[2,'unit-user']] as const) {
      if(!readback.state.assignments.some(a=>a.userId===users[index].id && a.unitId===unit!.id && a.role===role && a.status==='active'))throw new Error('Unit assignment missing');
    }
    for(const user of users) {
      stage=`${country.name}: password login for ${user.email}`;
      const config=runtimeConfig();
      const loginClient=createBlocksClient({apiUrl:config.apiUrl,xBlocksKey:config.projectKey,appDomain:config.appDomain});
      const session=tokens(await loginClient.auth.login({username:user.email,password,rememberMe:false}));
      await createBlocksClient({apiUrl:config.apiUrl,xBlocksKey:config.projectKey,accessToken:session.access}).auth.logout({refreshToken:session.refresh});
    }
    if(replaceExample) {
      stage=`${country.name}: transfer old test assignments`;
      const oldUsers=[];
      for(const kind of kinds) {
        const old=await find(`atlas.${country.code}.${kind}@example.com`);
        if(!old?.itemId)throw new Error('Original test account not found');
        oldUsers.push(old);
      }
      const current=await repository.load(country.id);
      if(!current)throw new Error('Organization state missing');
      const replacement=new Rbac(current.state,actor);
      // Preserve any later assignments added to these test identities, not only Demo Team.
      for(const [index,old] of oldUsers.entries()) {
        const oldMember=current.state.members.find(m=>m.userId===old.itemId&&m.status==='active');
        if(oldMember)replacement.addOrganizationMember(users[index],oldMember.role);
        for(const assignment of [...current.state.assignments].filter(a=>a.userId===old.itemId&&a.status==='active')) {
          const unit=current.state.units.find(u=>u.id===assignment.unitId);
          if(unit?.status==='archived')throw new Error('Archived unit transfer requires manual review');
          replacement.assign(users[index],assignment.unitId,assignment.role);
        }
        if(oldMember)replacement.removeOrganizationMember(old.itemId!);
      }
      await repository.commit(current.state,current);
      const confirmed=await repository.load(country.id);
      if(!confirmed||oldUsers.some(old=>confirmed.state.members.some(m=>m.userId===old.itemId&&m.status==='active')||confirmed.state.assignments.some(a=>a.userId===old.itemId&&a.status==='active')))throw new Error('Old access removal not confirmed');
      stage=`${country.name}: deactivate original test accounts`;
      for(const old of oldUsers) {
        if(old.active) {
          const args=['iam','users','deactivate',old.itemId!];
          cli([...args,'--dry-run']);cli([...args,'--yes']);
        }
        if((await find(old.email!))?.active!==false)throw new Error('Old test account deactivation not confirmed');
      }
      console.log(`${country.name}: old test accounts deactivated after verified role transfer.`);
    }
    console.log(`${country.name}: four live roles and password logins verified.`);
  }
  if(apply)writeFileSync('docs/demo-users.json',JSON.stringify({createdAt:new Date().toISOString(),storage:'Blocks OS IAM + Data Gateway',passwordLoginsVerified:true,replacedExampleAccounts:replaceExample,users:report},null,2)+'\n');
}catch { console.error(`Demo user setup stopped at ${stage}. Sensitive response suppressed. Already created accounts are retained; rerun safely after resolving the failure.`);process.exitCode=1; }
finally {rmSync(directory,{recursive:true,force:true});}
