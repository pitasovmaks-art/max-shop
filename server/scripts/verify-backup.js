// Decrypt locally and inspect archive structure only. Never restores into a DB.
const fs=require('fs/promises'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const {keyFromEnv,decryptFile}=require('../utils/backupCrypto');
async function run(){
    const file=process.argv[2];if(!file)throw Error('Pass local database.dump.enc path');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tm-verify-'));await fs.chmod(dir,0o700);
    try {const dump=path.join(dir,'db.dump');await decryptFile(file,dump,keyFromEnv(process.env.BACKUP_ENCRYPTION_KEY));
        await new Promise((resolve,reject)=>{const p=spawn('pg_restore',['--list',dump],{stdio:'ignore'});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('Invalid PostgreSQL archive')))});
        console.log('[backup] authenticated archive structure OK; actual restore still requires an isolated database test');
    }finally{await fs.rm(dir,{recursive:true,force:true});}
}
if(require.main===module)run().catch(()=>{console.error('[backup] verification failed');process.exitCode=1});
