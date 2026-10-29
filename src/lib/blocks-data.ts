import { createBlocksClient, type BlocksClientConfig } from '@seliseblocks/client';
import { AppError, type Table, type Tables } from './model';

// Users/country organizations themselves belong to IAM, never a custom Data collection.
export type DataTable=Exclude<Table,'users'|'countries'>;
export interface GatewayOperation { query:string; operationName:string; resultField:string }
/** Documents and fields must be copied from the target project's verified runtime schema. */
export interface GatewayCollectionContract {
  schemaName:string;
  fields:string[];
  list:GatewayOperation;
  create:GatewayOperation;
  update:GatewayOperation;
  delete:GatewayOperation;
}
export type GatewayContracts=Partial<Record<DataTable,GatewayCollectionContract>>;
export interface StoredRecord<T> {itemId:string;record:T;revision?:string}
export interface AsyncHierarchyRepository {
  list<K extends DataTable>(table:K,options?:{page:number;pageSize:number;filter?:Record<string,unknown>}):Promise<{items:StoredRecord<Tables[K]>[];total:number}>;
  get<K extends DataTable>(table:K,itemId:string):Promise<StoredRecord<Tables[K]>|undefined>;
  create<K extends DataTable>(table:K,record:Tables[K]):Promise<string>;
  update<K extends DataTable>(table:K,itemId:string,record:Tables[K]):Promise<void>;
  remove(table:DataTable,itemId:string):Promise<void>;
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError(502,'Invalid Data Gateway response.');return value as Record<string,unknown>}
/** Real async Gateway transport. No local DB, mock fallback, or CLI credentials. */
export class BlocksDataRepository implements AsyncHierarchyRepository {
  private readonly client;
  constructor(config:BlocksClientConfig,private readonly contracts:GatewayContracts){
    if(!config.apiUrl||!config.xBlocksKey)throw new AppError(503,'Data Gateway needs a project key and API URL.');
    this.client=createBlocksClient(config);
  }
  private contract(table:DataTable){const spec=this.contracts[table];if(!spec)throw new AppError(503,`No verified Data Gateway operation contract for ${table}. Inspect the configured project schema with Blocks CLI.`);return spec;}
  private async execute(operation:GatewayOperation,variables:Record<string,unknown>){
    let response:unknown;
    try{response=await this.client.data.graphql({query:operation.query,operationName:operation.operationName,variables});}
    catch{throw new AppError(502,'Data Gateway request failed. No local fallback was used.');}
    const root=object(response);
    if(Array.isArray(root.errors)&&root.errors.length||root.isSuccess===false)throw new AppError(502,'Data Gateway rejected the operation.');
    const data=object(root.data);return object(data[operation.resultField]);
  }
  async list<K extends DataTable>(table:K,options={page:1,pageSize:100} as {page:number;pageSize:number;filter?:Record<string,unknown>}){
    const spec=this.contract(table);
    if(!Number.isInteger(options.page)||options.page<1||!Number.isInteger(options.pageSize)||options.pageSize<1||options.pageSize>100)throw new AppError(422,'Invalid Data Gateway pagination.');
    const result=await this.execute(spec.list,{input:{pageNo:options.page,pageSize:options.pageSize,filter:options.filter?JSON.stringify(options.filter):undefined}});
    if(!Array.isArray(result.items)||!Number.isInteger(result.totalCount)||Number(result.totalCount)<0)throw new AppError(502,'Data Gateway list result is missing items or totalCount.');
    const items=result.items.map(value=>{const raw=object(value);if(typeof raw.ItemId!=='string'||!raw.ItemId||typeof raw.id!=='string'||!raw.id)throw new AppError(502,'Data Gateway row needs its storage ItemId and application id.');const record=Object.fromEntries(spec.fields.map(field=>[field,raw[field]])) as unknown as Tables[K];return {itemId:raw.ItemId,record,revision:typeof raw.LastUpdatedDate==='string'?raw.LastUpdatedDate:undefined};});
    return {items,total:Number(result.totalCount)};
  }
  async get<K extends DataTable>(table:K,itemId:string){const result=await this.list(table,{page:1,pageSize:1,filter:{ItemId:itemId}});const item=result.items[0];if(item&&item.itemId!==itemId)throw new AppError(502,'Data Gateway returned the wrong storage identity.');return item;}
  private payload<K extends DataTable>(table:K,row:Tables[K]){const spec=this.contract(table);if(!row.id)throw new AppError(422,'Application record id is required.');return Object.fromEntries(spec.fields.map(field=>[field,(row as unknown as Record<string,unknown>)[field]]));}
  async create<K extends DataTable>(table:K,row:Tables[K]){const result=await this.execute(this.contract(table).create,{input:this.payload(table,row)});if(result.acknowledged!==true||typeof result.itemId!=='string'||!result.itemId)throw new AppError(502,'Data Gateway did not acknowledge record creation.');return result.itemId;}
  async update<K extends DataTable>(table:K,itemId:string,row:Tables[K]){const old=await this.get(table,itemId);if(!old)throw new AppError(404,'Data record not found.');if(old.record.id!==row.id)throw new AppError(422,'Application record identity cannot be changed.');const result=await this.execute(this.contract(table).update,{filter:JSON.stringify({ItemId:itemId}),input:this.payload(table,row)});this.acknowledged(result);}
  async compareAndSet<K extends DataTable>(table:K,itemId:string,row:Tables[K],revision:string){
    const spec=this.contract(table);const result=await this.execute(spec.update,{where:{ItemId:{eq:itemId},LastUpdatedDate:{eq:revision}},input:this.payload(table,row)});this.acknowledged(result);
  }
  async remove(table:DataTable,itemId:string){const result=await this.execute(this.contract(table).delete,{filter:JSON.stringify({ItemId:itemId}),input:{isHardDelete:true}});this.acknowledged(result);}
  private acknowledged(result:Record<string,unknown>){if(result.acknowledged!==true||result.totalImpactedData!==1)throw new AppError(409,'Data Gateway did not confirm exactly one affected record.');}
  async transaction():Promise<never>{throw new AppError(503,'Atomic multi-record Data Gateway transactions have not been verified. Scoped invitation activation is disabled until an atomic server operation is verified.');}
}
