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

#[cfg(not(windows))]
mod non_win_dpapi {
    use super::*;
    pub fn protect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        Ok(data.iter().map(|b| b ^ 0xA5).collect())
    }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, AuthError> {
        Ok(data.iter().map(|b| b ^ 0xA5).collect())
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
            "檔案格式錯誤：非有效之 DPAPI 加密資料庫".into(),
        ));
    }

    let cipher = &raw_bytes[MAGIC_HEADER.len()..];
    #[cfg(windows)]
    let decrypted = win_dpapi::unprotect(cipher)?;
    #[cfg(not(windows))]
    let decrypted = non_win_dpapi::unprotect(cipher)?;

    String::from_utf8(decrypted).map_err(|e| {
        AuthError::KeyringError(format!("DPAPI 解密後非有效 UTF-8 字串: {}", e))
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
}
