import { writeFileSync, mkdirSync } from 'node:fs';
import { MemoryStore } from '../src/lib/store';
import { seed } from '../src/lib/seed';
const store=new MemoryStore();seed(store);
const tables=['countries','users','departments','groups','roles','memberships','invitations','resources','audit','admins'] as const;
mkdirSync('blocks/fixtures',{recursive:true});
writeFileSync('blocks/fixtures/demo.json',JSON.stringify(Object.fromEntries(tables.map(t=>[t,store.all(t)])),null,2)+'\n');
console.log('Exported mock fixtures to blocks/fixtures/demo.json. No local or cloud database written. Live seeding requires verified IAM users/countries and reviewed Data Gateway mappings.');
