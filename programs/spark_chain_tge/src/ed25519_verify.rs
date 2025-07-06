use anchor_lang::solana_program::pubkey::Pubkey;

/// Verify an Ed25519 signature using the ed25519-dalek crate
pub fn verify_signature(
    pubkey: &Pubkey,
    signature: &[u8; 64],
    message: &[u8],
) -> anyhow::Result<bool> {
    use ed25519_dalek::{PublicKey, Signature, Verifier};
    
    // Convert Pubkey to PublicKey
    let public_key = PublicKey::from_bytes(&pubkey.to_bytes())
        .map_err(|e| anyhow::anyhow!("Invalid public key: {}", e))?;
    
    // Convert signature bytes to Signature
    let sig = Signature::from_bytes(signature)
        .map_err(|e| anyhow::anyhow!("Invalid signature: {}", e))?;
    
    // Verify the signature
    match public_key.verify(message, &sig) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Keypair, Signer};
    use rand::rngs::OsRng;

    #[test]
    fn test_verify() -> anyhow::Result<()> {
        let mut csprng = OsRng;
        let keypair = Keypair::generate(&mut csprng);
        
        let bytes_to_sign = b"Hello World! More bytes and stuff...";
        let signature = keypair.sign(bytes_to_sign);
        
        let pubkey = Pubkey::from(keypair.public.to_bytes());
        let verify = verify_signature(&pubkey, &signature.to_bytes(), bytes_to_sign)?;
        assert!(verify);
        Ok(())
    }

    #[test]
    fn test_verify_false() -> anyhow::Result<()> {
        let mut csprng = OsRng;
        let keypair = Keypair::generate(&mut csprng);
        
        let bytes_to_sign = b"Hello World! More bytes and stuff...";
        let signature = keypair.sign(bytes_to_sign);
        
        let wrong_bytes = b"Hello World! These are not the bytes you are looking for...";
        let pubkey = Pubkey::from(keypair.public.to_bytes());
        let verify = verify_signature(&pubkey, &signature.to_bytes(), wrong_bytes)?;
        assert!(!verify);
        Ok(())
    }

    #[test]
    fn test_invalid_pubkey() {
        // Create an invalid pubkey (not on the curve)
        let mut invalid_bytes = [0xFFu8; 32];
        invalid_bytes[31] = 0x7F; // Clear high bit to ensure it's < 2^255
        let invalid_pubkey = Pubkey::new_from_array(invalid_bytes);
        let signature = [0u8; 64];
        let message = b"test message";

        let result = verify_signature(&invalid_pubkey, &signature, message);
        // Should return an error for invalid pubkey
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_signature() -> anyhow::Result<()> {
        let mut csprng = OsRng;
        let keypair = Keypair::generate(&mut csprng);
        
        let bytes_to_sign = b"Hello World!";
        let signature = keypair.sign(bytes_to_sign);

        // Tamper with the signature's S component
        let mut tampered_sig = signature.to_bytes();
        tampered_sig[32] ^= 0x01; // Flip one bit in S component

        let pubkey = Pubkey::from(keypair.public.to_bytes());
        let result = verify_signature(&pubkey, &tampered_sig, bytes_to_sign)?;
        assert!(!result);
        Ok(())
    }

    #[test]
    fn test_empty_message() -> anyhow::Result<()> {
        let mut csprng = OsRng;
        let keypair = Keypair::generate(&mut csprng);
        
        let empty_message = b"";
        let signature = keypair.sign(empty_message);
        
        let pubkey = Pubkey::from(keypair.public.to_bytes());
        let verify = verify_signature(&pubkey, &signature.to_bytes(), empty_message)?;
        assert!(verify);
        Ok(())
    }

    #[test]
    fn test_large_message() -> anyhow::Result<()> {
        let mut csprng = OsRng;
        let keypair = Keypair::generate(&mut csprng);
        
        let large_message = vec![0xAB; 10000]; // 10KB message
        let signature = keypair.sign(&large_message);
        
        let pubkey = Pubkey::from(keypair.public.to_bytes());
        let verify = verify_signature(&pubkey, &signature.to_bytes(), &large_message)?;
        assert!(verify);
        Ok(())
    }
}