import * as crypto from 'crypto';
import fs from 'fs';

// Generate Ed25519 keypair
const keypair = crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'der'
  },
  publicKeyEncoding: {
    type: 'spki',
    format: 'der'
  }
});

// Extract raw keys (32 bytes each)
const privateKeyDer = keypair.privateKey;
const publicKeyDer = keypair.publicKey;

// For Ed25519, the raw private key is at offset 16 (skip ASN.1 header)
// and raw public key is at offset 12
const privateKeyRaw = privateKeyDer.subarray(16, 48);
const publicKeyRaw = publicKeyDer.subarray(12, 44);

const backendKeypair = {
  publicKey: publicKeyRaw.toString('hex'),
  privateKey: privateKeyRaw.toString('hex'),
  timestamp: new Date().toISOString()
};

// Save to file
fs.writeFileSync('backend-keypair.json', JSON.stringify(backendKeypair, null, 2));

console.log('🔐 Backend Ed25519 Keypair Generated!\n');
console.log('Public Key (use this in program):', backendKeypair.publicKey);
console.log('\nKeypair saved to: backend-keypair.json');
console.log('\n⚠️  IMPORTANT: Keep the private key secure! The backend server needs it to sign proofs.');