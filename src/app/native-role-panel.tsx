"use client";
import {useEffect,useState,type FormEvent} from 'react';
import type {NativeRole} from '@/lib/rbac/native-roles';
async function request(path='',method='GET',body?:unknown){
 const response=await fetch(`/api/rbac/native-roles${path}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Blocks request failed.');return result;
}
export default function NativeRolePanel(){
 const [roles,setRoles]=useState<NativeRole[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[editing,setEditing]=useState<NativeRole|null|undefined>(),[assignable,setAssignable]=useState<unknown>();
 async function load(){setBusy(true);setError('');try{const r=await request();setRoles(r.roles);setAssignable(r.assignable);setLoaded(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{let active=true;request().then(r=>{if(active){setRoles(r.roles);setAssignable(r.assignable);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setError('');setNotice('');try{
 await request(editing?`/${encodeURIComponent(editing.id)}`:'',editing?'PATCH':'POST',{name:form.get('name'),slug:form.get('slug'),parentRoleSlug:form.get('parent')||null,canCreateOwn:form.get('sameRole')==='on',revision:editing?.revision});
 setEditing(undefined);await load();setNotice('Blocks role hierarchy saved and read back.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="rbac-panel">
  <h2>Blocks role management</h2>
  <p>Tenant-wide IAM parent roles and same-role assignment. These settings govern native IAM role delegation. Organization and unit workspace permissions are listed separately below.</p>
  {error&&<p role="alert" className="rbac-alert error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="rbac-actions"><button className="button secondary" disabled={busy} onClick={()=>void load()}>Reload Blocks roles</button>{loaded&&<button className="button primary" disabled={busy} onClick={()=>setEditing(null)}>Create Blocks role</button>}</div>
  {loaded&&<div className="table-wrap"><table aria-label="Blocks role hierarchy"><thead><tr><th>Role</th><th>Parent role</th><th>Child roles</th><th>Can create own role</th><th>Actions</th></tr></thead><tbody>
   {roles.map(role=><tr key={role.id}><td>{role.name}<small>{role.slug}</small></td><td>{role.parentRoleSlug||'No parent'}</td><td>{roles.filter(child=>child.parentRoleSlug===role.slug).map(child=>child.name).join(', ')||'None'}</td><td>{role.canCreateOwn?'Yes':'No'}</td><td>{role.protected?'Protected system role':<button disabled={busy} onClick={()=>setEditing(role)}>Edit hierarchy</button>}</td></tr>)}
  </tbody></table></div>}
  {loaded&&<details><summary>Roles Blocks allows your signed-in account to assign</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(assignable,null,2)}</pre><p>The response comes from your own IAM token. A platform app grant does not automatically grant native IAM delegation authority.</p></details>}
  {editing!==undefined&&<form onSubmit={save} className="rbac-panel" key={editing?.id||'new'} aria-label="Blocks role editor">
    <h3>{editing?'Edit role hierarchy':'Create Blocks role'}</h3>
    <label>Name<input name="name" required maxLength={120} defaultValue={editing?.name}/></label>
    {!editing&&<label>Role slug<input name="slug" required pattern="atlas-[a-z][a-z0-9-]{0,63}" placeholder="atlas-reviewer"/></label>}
    <label>Parent role<select name="parent" defaultValue={editing?.parentRoleSlug||''}><option value="">No parent</option>{roles.filter(r=>r.id!==editing?.id).map(r=><option value={r.slug} key={r.id}>{r.name} ({r.slug})</option>)}</select></label>
    <label className="rbac-checkbox"><input name="sameRole" type="checkbox" defaultChecked={editing?.canCreateOwn||false}/>Can create own role (Blocks canCreateOwn)</label>
    <p>New roles start without permissions or user assignments. Changes apply to the default IAM organization; propagation to other organizations is disabled.</p>
    <div className="rbac-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setEditing(undefined)}>Cancel</button><button className="button primary" disabled={busy}>Save Blocks role</button></div>
  </form>}
 </section>;
}
