import {backendClient} from '../blocks-runtime';
import {mode} from '../adapters';

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function invitationRoleLabel(role:string){
  return role==='organization-admin'?'Organization Admin'
    :role==='member'?'Organization member'
    :role==='unit-admin'?'Unit Admin'
    :'Unit Member';
}

export function invitationLink(origin:string,organizationId:string,id:string,token:string){
  const link=new URL('/activate',origin);
  link.searchParams.set('organization',organizationId);
  link.searchParams.set('invite',id);
  // Keep the token in the query string: many mail clients strip URL fragments (#...).
  link.searchParams.set('token',token);
  return link.href;
}

type MailClient={mail:{sendToAny:(request:Record<string,unknown>)=>Promise<Record<string,unknown>>}};

/** Sends the Atlas invitation email. Uses SendToAny so invitees who are not project users yet still receive mail. */
export async function sendInvitationMail(
  input:{email:string;organization:string;unit:string;role:string;organizationId:string;id:string;token:string;scope?:'organization'|'unit'},
  dependencies?:{mode?:()=>string;origin?:()=>string|undefined;client?:()=>MailClient},
) {
  const currentMode=(dependencies?.mode||mode)();
  if(currentMode==='mock')return 'mock' as const;
  try {
    const origin=(dependencies?.origin||(()=>process.env["APP_ORIGIN"]))();
    if(!origin)throw new Error('APP_ORIGIN is required to email invitation links.');
    const href=invitationLink(origin,input.organizationId,input.id,input.token);
    const unitLabel=input.scope==='organization'||input.unit==='Organization workspace'
      ?'Organization'
      :input.unit;
    const client=dependencies?.client?.()||backendClient();
    const response=await client.mail.sendToAny({
      to:[input.email],
      purpose:'AtlasUnitInvitation',
      language:'en-US',
      subjectDataContext:{Organization:input.organization},
      bodyDataContext:{
        Organization:escapeHtml(input.organization),
        Unit:escapeHtml(unitLabel),
        Role:invitationRoleLabel(input.role),
        // Keep the accept URL raw so query/hash survive mail template injection.
        InvitationUrl:href,
      },
    });
    if(response.isSuccess===false||response.error||(Array.isArray(response.errors)&&response.errors.length))
      throw new Error('Blocks Mail rejected the invitation email.');
    return 'queued' as const;
  }catch(error){
    console.error(
      'Invitation email was not queued.',
      error instanceof Error?error.message:'unknown mail error',
    );
    return 'failed' as const;
  }
}
