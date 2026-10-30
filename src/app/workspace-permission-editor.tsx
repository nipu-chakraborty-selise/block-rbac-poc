"use client";
import {useState, type FormEvent} from 'react';
import {Check, CheckCheck, LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal} from 'lucide-react';
import {workspacePermissions, permissionKeys, allowedPermissions, rolePermissions, type EditableRole, type WorkspacePermissionPolicy, type PermissionGrants, type WorkspacePermission} from '@/lib/rbac/permissions';

type Props = {
  base: string; revision: string; policy: WorkspacePermissionPolicy;
  organizationManager: boolean;
  units: {id:string;name:string;canConfigure:boolean;permissions:PermissionGrants}[];
  onSaved: () => Promise<void>;
};
const groups:{name:string;description:string;keys:WorkspacePermission[]}[]=[
  {name:'Units & structure',description:'Control how the workspace is organized.',keys:['createUnit','renameUnit','changeUnitStatus']},
  {name:'Invitations & membership',description:'Choose who this role can invite and manage.',keys:['inviteMembers','inviteAdmins','manageMembers','manageAdmins']},
  {name:'Connected content',description:'Capabilities shared with your connected applications.',keys:['manageContent']},
];
const descriptions:Record<WorkspacePermission,string>={
  createUnit:'Create new units and receive management access to them.',
  renameUnit:'Update the names of units within this role’s scope.',
  changeUnitStatus:'Pause unit access by archiving, or restore existing access.',
  inviteMembers:'Send email invitations with a Unit Member role.',
  inviteAdmins:'Send email invitations with a Unit Admin role.',
  manageMembers:'Assign or remove regular members in permitted units.',
  manageAdmins:'Assign, change or remove Unit Admin assignments.',
  manageContent:'Expose content-management authority to connected apps.',
};
const roleLabels:Record<EditableRole,string>={'organization-admin':'Organization Admin','unit-admin':'Unit Admin','unit-user':'Unit Member'};
export default function WorkspacePermissionEditor(props: Props) {
  const [role,setRole]=useState<EditableRole>(props.organizationManager?'organization-admin':'unit-admin');
  const [unitId,setUnitId]=useState(props.organizationManager?'':props.units.find(u=>u.canConfigure)?.id||'');
  const [draft,setDraft]=useState<PermissionGrants>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const saved=rolePermissions(props.policy,role,unitId||undefined);
  const values=draft||saved;
  const unit=props.units.find(u=>u.id===unitId);
  const allowed=allowedPermissions(role);
  const changes=permissionKeys.filter(key=>values[key]!==saved[key]).length;
  const enabled=permissionKeys.filter(key=>values[key]).length;
  async function save(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      const r=await fetch(`/api/${props.base}/permissions`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:props.revision,role,unitId:unitId||undefined,permissions:values})});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'Permissions could not be saved.');
      await props.onSaved();setDraft(undefined);setNotice('Workspace permissions saved. Changes apply to existing members and pending invitations.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="rbac-panel rbac-permission-editor">
    <header className="role-section-heading">
      <div className="role-section-icon"><SlidersHorizontal size={20} aria-hidden="true"/></div>
      <div><span className="role-eyebrow">CONFIGURATION</span><h2>Edit workspace permissions</h2><p>Choose a role, set its scope, and fine-tune the actions it can perform.</p></div>
      <span className="role-status-pill"><ShieldCheck size={14} aria-hidden="true"/>Scope protected</span>
    </header>
    {error&&<p role="alert" className="rbac-alert error">{error}</p>}
    {notice&&<p role="status" className="rbac-alert success"><CheckCheck size={18} aria-hidden="true"/>{notice}</p>}
    <form aria-label="Workspace permission editor" onSubmit={save}>
      <div className="permission-workbench">
        <aside className="permission-context">
          <span className="role-eyebrow">01 / SELECT CONTEXT</span>
          <label>Permission role<select value={role} disabled={busy} onChange={e=>{const next=e.target.value as EditableRole;setRole(next);if(next==='organization-admin')setUnitId('');setDraft(undefined);setNotice('');setError('');}}>
            {props.organizationManager&&<option value="organization-admin">Organization Admin</option>}
            <option value="unit-admin">Unit Admin</option><option value="unit-user">Unit Member</option>
          </select></label>
          <label>Permission scope<select value={unitId} disabled={busy||role==='organization-admin'} onChange={e=>{setUnitId(e.target.value);setDraft(undefined);setNotice('');setError('');}}>
            {props.organizationManager&&<option value="">Company defaults</option>}
            {role!=='organization-admin'&&props.units.filter(u=>u.canConfigure).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
          <p className="permission-scope-help">{unitId?'This unit’s settings override company defaults for the selected role.':'Company defaults apply wherever a unit has no override.'}</p>
          <div className="permission-boundary"><LockKeyhole size={17} aria-hidden="true"/><div><strong>Within your authority</strong><p>{props.organizationManager?'You can configure lower roles across your company. Ownership and platform access stay protected.':'You can configure lower roles in authorized units and grant only permissions you currently hold.'}</p></div></div>
          <div className="permission-count"><strong>{enabled}<span> / {permissionKeys.length}</span></strong><span>permissions enabled</span></div>
        </aside>
        <div className="permission-options">
          <div className="permission-options-heading"><div><span className="role-eyebrow">02 / CONFIGURE ACCESS</span><h3>{roleLabels[role]}</h3></div><span className="role-scope-tag">{unit?.name||'Company defaults'}</span></div>
          {groups.map(group=><fieldset disabled={busy} key={group.name} className="permission-group">
            <legend>{group.name}</legend><p>{group.description}</p>
            {group.keys.map(key=>{
              const restricted=!allowed.includes(key);
              const unavailable=!props.organizationManager&&!values[key]&&!unit?.permissions[key];
              const disabled=restricted||unavailable;
              const helpId=`permission-help-${key}`;
              return <label key={key} className={`permission-option${disabled?' is-restricted':''}`}>
                <span className="permission-option-copy"><strong>{workspacePermissions[key]}</strong><span id={helpId}>{restricted?'This action belongs to a higher role.':unavailable?'You do not currently hold this permission.':descriptions[key]}</span></span>
                {disabled&&<LockKeyhole size={14} aria-hidden="true" className="permission-lock"/>}
                <span className="permission-toggle"><input aria-label={workspacePermissions[key]} aria-describedby={helpId} type="checkbox" checked={values[key]} disabled={disabled} onChange={e=>{setDraft({...values,[key]:e.target.checked});setNotice('');}}/><span aria-hidden="true" className="permission-toggle-track"><span><Check size={10}/></span></span></span>
              </label>;
            })}
          </fieldset>)}
        </div>
      </div>
      <footer className="permission-savebar">
        <div><span className={`permission-save-dot${changes?' is-dirty':''}`} aria-hidden="true"/><span aria-live="polite">{changes?`${changes} unsaved ${changes===1?'change':'changes'}`:'All changes saved'}</span><small>Updates apply to everyone with this role in scope.</small></div>
        <div><button className="button secondary" type="button" disabled={busy||!changes} onClick={()=>{setDraft(undefined);setError('');}}><RotateCcw size={15} aria-hidden="true"/>Reset</button><button className="button primary" disabled={busy||!changes||(!props.organizationManager&&!unit?.canConfigure)}>{busy?'Saving…':'Save workspace permissions'}</button></div>
      </footer>
    </form>
  </section>;
}
