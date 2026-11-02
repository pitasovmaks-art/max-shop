// Run by an external scheduler, not by an HTTP endpoint. Never prints credentials.
try { process.loadEnvFile(); } catch {}
const fs=require('fs/promises'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const {S3Client,PutObjectCommand,ListObjectsV2Command,CopyObjectCommand}=require('@aws-sdk/client-s3');
const {keyFromEnv,encryptFile}=require('../utils/backupCrypto');
async function run() {
    const key=keyFromEnv(process.env.BACKUP_ENCRYPTION_KEY);
    const bucket=process.env.BACKUP_BUCKET;
    if(!bucket || bucket===process.env.S3_BUCKET) throw new Error('Use a separate private BACKUP_BUCKET');
    for(const n of ['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD','S3_BUCKET','S3_ACCESS_KEY','S3_SECRET_KEY'])if(!process.env[n])throw new Error('Missing '+n);
    if(!process.env.DB_SSL_CA_FILE && process.env.DB_SSL_VERIFY!=='true')throw new Error('Configure verified database TLS for pg_dump first (DB_SSL_CA_FILE or DB_SSL_VERIFY=true)');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tm-backup-'));await fs.chmod(dir,0o700);
    try {
        const dump=path.join(dir,'db.dump'),encrypted=dump+'.enc';
        const env={...process.env,PGHOST:process.env.DB_HOST,PGPORT:process.env.DB_PORT||'5432',PGDATABASE:process.env.DB_NAME,PGUSER:process.env.DB_USER,PGPASSWORD:process.env.DB_PASSWORD,PGSSLMODE:'verify-full',...(process.env.DB_SSL_CA_FILE?{PGSSLROOTCERT:process.env.DB_SSL_CA_FILE}:{})};
        await new Promise((resolve,reject)=>{const p=spawn('pg_dump',['--format=custom','--no-owner','--no-acl','--file',dump],{env,stdio:'ignore'});p.on('error',()=>reject(new Error('pg_dump unavailable')));p.on('exit',c=>c===0?resolve():reject(new Error('pg_dump failed')))});
        await encryptFile(dump,encrypted,key);await fs.rm(dump);
        const s3=new S3Client({region:'ru-1',endpoint:'https://s3.twcstorage.ru',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
        const prefix='snapshots/'+new Date().toISOString().replace(/[:.]/g,'-')+'/',objects=[];
        await s3.send(new PutObjectCommand({Bucket:bucket,Key:prefix+'database.dump.enc',Body:require('fs').createReadStream(encrypted),ContentType:'application/octet-stream',ACL:'private'}));
        for(const sourcePrefix of ['products/','banners/']) {
            let token;
            do {const page=await s3.send(new ListObjectsV2Command({Bucket:process.env.S3_BUCKET,Prefix:sourcePrefix,ContinuationToken:token}));
                for(const obj of page.Contents||[]) {await s3.send(new CopyObjectCommand({Bucket:bucket,Key:prefix+'assets/'+obj.Key,CopySource:[process.env.S3_BUCKET,...obj.Key.split('/')].map(encodeURIComponent).join('/'),ACL:'private'}));objects.push({key:obj.Key,size:obj.Size,etag:obj.ETag});}
                token=page.IsTruncated?page.NextContinuationToken:undefined;
            }while(token);
        }
        await s3.send(new PutObjectCommand({Bucket:bucket,Key:prefix+'manifest.json',Body:JSON.stringify({createdAt:new Date().toISOString(),format:'pg_dump-custom+aes-256-gcm',database:'database.dump.enc',assets:objects}),ContentType:'application/json',ACL:'private'}));
        console.log('[backup] complete; assets='+objects.length+'; key='+prefix);
    } finally {await fs.rm(dir,{recursive:true,force:true});}
}
if(require.main===module)run().catch(()=>{console.error('[backup] failed; check private configuration, PostgreSQL client and storage permissions');process.exitCode=1});
module.exports={run};
