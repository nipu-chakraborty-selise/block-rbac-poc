import {Crown, ShieldCheck, Users, UserRound, ArrowRight, LockKeyhole} from 'lucide-react';
const roles=[
  {name:'Organization Owner',scope:'Company-wide',icon:Crown,detail:'Owns the company, appoints admins and defines their authority.'},
  {name:'Organization Admin',scope:'Authorized units',icon:ShieldCheck,detail:'Manages authorized units and configures permissions for lower roles.'},
  {name:'Unit Admin',scope:'Assigned units',icon:Users,detail:'Manages regular members and actions enabled for their units.'},
  {name:'Unit Member',scope:'Assigned units',icon:UserRound,detail:'Uses assigned workspaces with the access their role permits.'},
];
export default function RoleOverview({currentRole}:{currentRole:string}) {
  return <section className="role-overview" aria-labelledby="role-hierarchy-heading">
    <header><div><span className="role-eyebrow">ROLE HIERARCHY</span><h2 id="role-hierarchy-heading">Clear roles. The right level of access.</h2></div><span className="role-current"><LockKeyhole size={14} aria-hidden="true"/>Your access: <strong>{currentRole}</strong></span></header>
    <div className="role-hierarchy-grid">{roles.map((role,index)=><article key={role.name} className={`role-hierarchy-card${currentRole===role.name?' is-current':''}`}>
      <div className="role-hierarchy-top"><span className="role-level">0{index+1}</span><role.icon size={19} aria-hidden="true"/></div>
      <h2>{role.name}</h2><span className="role-scope-tag">{role.scope}</span><p>{role.detail}</p>
      {index<roles.length-1&&<ArrowRight className="role-hierarchy-arrow" size={15} aria-hidden="true"/>}
    </article>)}</div>
  </section>;
}
