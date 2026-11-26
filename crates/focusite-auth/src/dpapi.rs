//! Windows Data Protection API (DPAPI) file-level encryption for accounts and sensitive local state.
//!
//! Provides transparent encryption and decryption tied to the current operating system user.
//! On Windows, leverages CryptProtectData and CryptUnprotectData in crypt32.dll.

use crate::AuthError;

pub const MAGIC_HEADER: &[u8] = b"FOCUSITE_DPAPI_V1\0";

#[cfg(windows)]
mod win_dpapi {
    use super::*;
    use std::ptr;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    #[link(name = "kernel32")]
    extern "system" {
        fn CryptProtectData(
            pDataIn: *const DataBlob,
            szDataDescr: *const u16,
            pOptionalEntropy: *const DataBlob,
            pvReserved: *mut std::ffi::c_void,
            pPromptStruct: *mut std::ffi::c_void,
            dwFlags: u32,
            pDataOut: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            pDataIn: *const DataBlob,
            ppszDataDescr: *mut *mut u16,
            pOptionalEntropy: *const DataBlob,
            pvReserved: *mut std::ffi::c_void,
            pPromptStruct: *mut std::ffi::c_void,
            dwFlags: u32,
            pDataOut: *mut DataBlob,
        ) -> i32;

        fn LocalFree(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        let in_blob = DataBlob {
            cb_data: data.len() as u32,
            pb_data: data.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let success = unsafe {
            CryptProtectData(
                &in_blob,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 || out_blob.pb_data.is_null() {
            return Err(AuthError::KeyringError("DPAPI CryptProtectData failed".into()));
        }

        let slice = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize)
        };
        let result = slice.to_vec();

        unsafe {
            LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
        }

        Ok(result)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        let in_blob = DataBlob {
            cb_data: data.len() as u32,
            pb_data: data.as_ptr() as *mut u8,
        };
        let mut out_blob = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let success = unsafe {
            CryptUnprotectData(
                &in_blob,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
        };

        if success == 0 || out_blob.pb_data.is_null() {
            return Err(AuthError::KeyringError("DPAPI CryptUnprotectData failed".into()));
        }

        let slice = unsafe {
            std::slice::from_raw_parts(out_blob.pb_data, out_blob.cb_data as usize)
        };
        let result = slice.to_vec();

        unsafe {
            LocalFree(out_blob.pb_data as *mut std::ffi::c_void);
        }

        Ok(result)
    }
}

#[cfg(any(not(windows), test))]
pub(crate) mod non_win_dpapi {
    use super::*;
    use aes_gcm::aead::rand_core::RngCore;
    use aes_gcm::aead::{Aead, KeyInit, OsRng};
    use aes_gcm::{Aes256Gcm, Nonce};
    use base64::prelude::*;
    use keyring::Entry;

    const MASTER_KEY_ACCOUNT: &str = "__focusite_master_key__";
    pub const FORMAT_VERSION_AES_GCM: u8 = 0x01;

    fn get_or_create_master_key() -> Result<[u8; 32], AuthError> {
        let entry = Entry::new(crate::keyring_store::SERVICE_NAME, MASTER_KEY_ACCOUNT)
            .map_err(|e| AuthError::KeyringError(format!("Failed to create keyring entry: {}", e)))?;
        match entry.get_password() {
            Ok(b64) => {
                if let Ok(bytes) = BASE64_STANDARD.decode(&b64) {
                    if bytes.len() == 32 {
                        let mut key = [0u8; 32];
                        key.copy_from_slice(&bytes);
                        return Ok(key);
                    }
                }
                Err(AuthError::KeyringError("Corrupted master key in keyring".into()))
            }
            Err(keyring::Error::NoEntry) => {
                let key = Aes256Gcm::generate_key(OsRng);
                let b64 = BASE64_STANDARD.encode(key);
                entry.set_password(&b64).map_err(|e| {
                    AuthError::KeyringError(format!("Failed to save master key to keyring: {}", e))
                })?;
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&key);
                Ok(arr)
            }
            Err(e) => Err(AuthError::KeyringError(format!(
                "Failed to read master key from keyring: {}",
                e
            ))),
        }
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        let key = get_or_create_master_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| AuthError::AuthFailed(format!("Invalid key: {}", e)))?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let encrypted = cipher
            .encrypt(nonce, data)
            .map_err(|e| AuthError::AuthFailed(format!("AES-GCM encryption failed: {}", e)))?;
        let mut out = Vec::with_capacity(1 + 12 + encrypted.len());
        out.push(FORMAT_VERSION_AES_GCM);
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&encrypted);
        Ok(out)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        if let Some(&first_byte) = data.first() {
            if first_byte == FORMAT_VERSION_AES_GCM && data.len() > 12 {
                let key = get_or_create_master_key()?;
                let cipher = Aes256Gcm::new_from_slice(&key)
                    .map_err(|e| AuthError::AuthFailed(format!("Invalid key: {}", e)))?;
                let (nonce_bytes, ciphertext) = data[1..].split_at(12);
                let nonce = Nonce::from_slice(nonce_bytes);
                return cipher
                    .decrypt(nonce, ciphertext)
                    .map_err(|e| AuthError::AuthFailed(format!("AES-GCM decryption failed: {}", e)));
            }
        }

        // Fallback migration: support legacy 0xA5 XOR format
        let xored: Vec<u8> = data.iter().map(|b| b ^ 0xA5).collect();
        if let Ok(text) = std::str::from_utf8(&xored) {
            if text.trim().starts_with('{') {
                return Ok(xored);
            }
        }

        Err(AuthError::AuthFailed("Unknown encryption format or decryption failed".into()))
    }
}

/// Encrypts account store JSON string using DPAPI.
pub fn encrypt_account_data(plain_json: &str) -> Result<Vec<u8>, AuthError> {
    #[cfg(windows)]
    let cipher = win_dpapi::protect(plain_json.as_bytes())?;
    #[cfg(not(windows))]
    let cipher = non_win_dpapi::protect(plain_json.as_bytes())?;

    let mut out = Vec::with_capacity(MAGIC_HEADER.len() + cipher.len());
    out.extend_from_slice(MAGIC_HEADER);
    out.extend_from_slice(&cipher);
    Ok(out)
}

/// Decrypts account store bytes using DPAPI, supporting automatic migration from legacy plaintext JSON.
pub fn decrypt_account_data(raw_bytes: &[u8]) -> Result<String, AuthError> {
    // 檢查是否為舊版明文 JSON (支援 UTF-8 BOM 與一般空白)
    let trimmed = raw_bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(raw_bytes);
    if let Ok(text) = std::str::from_utf8(trimmed) {
        if text.trim().starts_with('{') {
            return Ok(text.to_string());
        }
    }

    if !raw_bytes.starts_with(MAGIC_HEADER) {
        return Err(AuthError::KeyringError(
            "E_CREDENTIAL_FILE_INVALID".into(),
        ));
    }

    let cipher = &raw_bytes[MAGIC_HEADER.len()..];
    #[cfg(windows)]
    let decrypted = win_dpapi::unprotect(cipher)?;
    #[cfg(not(windows))]
    let decrypted = non_win_dpapi::unprotect(cipher)?;

    String::from_utf8(decrypted).map_err(|e| {
        AuthError::KeyringError(format!("E_CREDENTIAL_DECRYPT_FAILED: {}", e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpapi_encryption_roundtrip() {
        let plain = r#"{"test":"focusite_dpapi_secret","number":42}"#;
        let encrypted = encrypt_account_data(plain).unwrap();

        // 確保非明文
        assert!(encrypted.starts_with(MAGIC_HEADER));
        assert_ne!(&encrypted[MAGIC_HEADER.len()..], plain.as_bytes());

        // 解密還原
        let decrypted = decrypt_account_data(&encrypted).unwrap();
        assert_eq!(decrypted, plain);
    }

    #[test]
    fn test_dpapi_legacy_plaintext_migration() {
        let plain = r#"{"accounts":[],"active_account_id":null}"#;
        // 未加密之舊檔案應無縫解讀
        let decrypted = decrypt_account_data(plain.as_bytes()).unwrap();
        assert_eq!(decrypted, plain);
    }

    #[test]
    fn test_dpapi_legacy_xored_fallback() {
        let plain = r#"{"accounts":[],"active_account_id":"acc-1"}"#;
        let xored: Vec<u8> = plain.as_bytes().iter().map(|b| b ^ 0xA5).collect();
        let unprot = non_win_dpapi::unprotect(&xored).expect("legacy XOR must be decrypted");
        assert_eq!(String::from_utf8(unprot).unwrap(), plain);
    }

    #[test]
    fn test_non_win_dpapi_aes_gcm_roundtrip() {
        let plain = b"{\"secret\":\"linux_macos_aes_gcm_test\"}";
        let protected = non_win_dpapi::protect(plain).expect("non_win protect should succeed");
        assert_eq!(protected[0], non_win_dpapi::FORMAT_VERSION_AES_GCM);
        let unprotected = non_win_dpapi::unprotect(&protected).expect("non_win unprotect should succeed");
        assert_eq!(&unprotected, plain);

        // Corrupt ciphertext should fail gracefully
        let mut corrupted = protected.clone();
        corrupted[14] ^= 0xFF;
        assert!(non_win_dpapi::unprotect(&corrupted).is_err());
    }
}
