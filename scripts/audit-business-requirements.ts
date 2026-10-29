import {writeFileSync} from 'node:fs';
import {MemoryStore} from '../src/lib/store';
import {seed} from '../src/lib/seed';
import {Application} from '../src/lib/service';
const setup=()=>{const store=new MemoryStore();seed(store);return {store,app:new Application(store)};};
const checks:{requirement:string;expected:string;actual:string;conforms:boolean}[]=[];
{
 const {app,store}=setup(),admin=app.auth.identity('super');
 app.hierarchySave(admin,'bd','department',undefined,{name:'HRM'});
 const count=store.all('departments').filter(d=>d.countryOrganizationId==='bd'&&d.name==='HRM').length;
 checks.push({requirement:'Unit names unique within organization',expected:'Reject duplicate HRM',actual:`${count} HRM departments accepted`,conforms:count===1});
}
{
 const {app}=setup();let allowed=true;try{app.hierarchySave(app.auth.identity('hr-admin'),'bd','department','hrm',{name:'Changed by unit admin'});}catch{allowed=false;}
 checks.push({requirement:'Only Organization Admin renames units',expected:'Unit Admin denied',actual:allowed?'Department admin rename accepted':'Denied',conforms:!allowed});
}
{
 const {app}=setup();let allowed=true;try{app.archive(app.auth.identity('hr-admin'),'bd','department','hrm');}catch{allowed=false;}
 checks.push({requirement:'Only Organization Admin archives units',expected:'Unit Admin denied',actual:allowed?'Department admin archive accepted':'Denied',conforms:!allowed});
}
{
 const {app}=setup();let allowed=true;try{app.membershipChange(app.auth.identity('hr-admin'),'bd','m-recruit-member',{roleId:'bd-dept'});}catch{allowed=false;}
 checks.push({requirement:'Only Organization Admin appoints admins',expected:'Unit Admin cannot assign an admin role',actual:allowed?'Department admin assigned Department admin role to group member':'Denied',conforms:!allowed});
}
{
 const {app,store}=setup();const original=store.get('memberships','m-recruit-admin')!;
 store.put('memberships',{...original,id:'second-admin',userId:'unassigned'});
 let allowed=true;try{app.membershipChange(app.auth.identity('recruit-admin'),'bd','second-admin',{},true);}catch{allowed=false;}
 checks.push({requirement:'Unit Admin removes regular users only',expected:'Removing another Unit Admin denied',actual:allowed?'Group admin removed another group admin':'Denied',conforms:!allowed});
}
{
 const {app}=setup();app.archive(app.auth.identity('super'),'bd','department','hrm');let restored=true;
 try{app.hierarchySave(app.auth.identity('super'),'bd','department','hrm',{name:'HRM'});}catch{restored=false;}
 checks.push({requirement:'Organization Admin restores archived units',expected:'Restore available',actual:restored?'PATCH restores unit':'Archived target rejected; no separate restore endpoint',conforms:restored});
}
{
 const {app}=setup();const snapshot=app.snapshot(app.auth.identity('unassigned'),'bd');
 checks.push({requirement:'Unassigned organization member gets no private content',expected:'Zero visible resources',actual:`${snapshot.resources.length} resources`,conforms:snapshot.resources.length===0});
}
{
 const {app}=setup();let denied=false;try{app.snapshot(app.auth.identity('recruit-member'),'de');}catch{denied=true;}
 checks.push({requirement:'Organization separation',expected:'Bangladesh member denied Germany',actual:denied?'Denied':'Allowed',conforms:denied});
}
const report={checkedOn:'2026-10-14',scope:'Read-only audit; all behavior probes used isolated in-memory stores. No live records were mutated.',checks};
writeFileSync('docs/business-requirements-probes.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
