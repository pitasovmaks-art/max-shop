const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const HEADER = Buffer.from('TMBACKUP1');
function keyFromEnv(value) {
    const key = Buffer.from(value || '', 'base64');
    if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    return key;
}
async function encryptFile(input, output, key) {
    const nonce=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
    const out=fs.createWriteStream(output,{mode:0o600});
    out.write(Buffer.concat([HEADER,nonce]));
    await pipeline(fs.createReadStream(input),cipher,new Transform({transform(c,e,cb){cb(null,c)},flush(cb){this.push(cipher.getAuthTag());cb()}}),out);
}
async function decryptFile(input, output, key) {
    const stat=await fs.promises.stat(input);
    if (stat.size < HEADER.length+28) throw new Error('Invalid backup');
    const handle=await fs.promises.open(input,'r');
    const prefix=Buffer.alloc(HEADER.length+12),tag=Buffer.alloc(16);
    try { await handle.read(prefix,0,prefix.length,0); await handle.read(tag,0,16,stat.size-16); }
    finally { await handle.close(); }
    if (!prefix.subarray(0,HEADER.length).equals(HEADER)) throw new Error('Invalid backup');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,prefix.subarray(HEADER.length));decipher.setAuthTag(tag);
    try { await pipeline(fs.createReadStream(input,{start:prefix.length,end:stat.size-17}),decipher,fs.createWriteStream(output,{mode:0o600,flags:'wx'})); }
    catch(e) { await fs.promises.rm(output,{force:true}); throw new Error('Backup authentication failed'); }
}
module.exports={keyFromEnv,encryptFile,decryptFile};
