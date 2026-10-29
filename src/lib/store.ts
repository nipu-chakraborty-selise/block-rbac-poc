import { AppError, type Table, type Tables } from './model';
/** Synchronous domain workspace. Live IO uses the separate async Data Gateway repository. */
export interface HierarchyStore {
  all<K extends Table>(table: K): Tables[K][];
  get<K extends Table>(table: K, id: string): Tables[K] | undefined;
  put<K extends Table>(table: K, row: Tables[K]): void;
  remove(table: Table, id: string): void;
  transaction<T>(fn: () => T): T;
}
export interface MockSession {userId:string;expiresAt:number}
/** Explicit development mock: no database, files, or persistence across server restarts. */
export class MemoryStore implements HierarchyStore {
  private rows = new Map<Table, Map<string, Tables[Table]>>();
  private sessions = new Map<string, MockSession>();
  private inTransaction=false;
  all<K extends Table>(table: K): Tables[K][] {
    return structuredClone([...(this.rows.get(table)?.values() || [])]) as Tables[K][];
  }
  get<K extends Table>(table: K, id: string): Tables[K] | undefined {
    return structuredClone(this.rows.get(table)?.get(id)) as Tables[K] | undefined;
  }
  put<K extends Table>(table: K, row: Tables[K]) {
    if(table==='memberships') {
      const m=row as Tables['memberships'];
      if(this.all('memberships').some(other=>other.id!==m.id&&other.userId===m.userId&&other.countryOrganizationId===m.countryOrganizationId&&other.scopeType===m.scopeType&&other.scopeId===m.scopeId))
        throw new AppError(409,'A scoped membership already exists.');
    }
    let collection=this.rows.get(table);
    if(!collection){collection=new Map();this.rows.set(table,collection)}
    collection.set(row.id,structuredClone(row));
  }
  remove(table: Table, id: string) {this.rows.get(table)?.delete(id)}
  transaction<T>(fn: () => T): T {
    if(this.inTransaction)throw new AppError(500,'Nested mock transactions are unsupported.');
    const before=structuredClone(this.rows);this.inTransaction=true;
    try {const result=fn();if(result instanceof Promise)throw new AppError(500,'Mock transaction callbacks must be synchronous.');return result;}
    catch(e){this.rows=before;throw e}finally{this.inTransaction=false}
  }
  session(tokenHash:string){const session=this.sessions.get(tokenHash);if(session&&session.expiresAt>Date.now())return {...session};this.sessions.delete(tokenHash);return undefined}
  saveSession(tokenHash:string,session:MockSession){this.sessions.set(tokenHash,{...session})}
  removeSession(tokenHash:string){this.sessions.delete(tokenHash)}
}
