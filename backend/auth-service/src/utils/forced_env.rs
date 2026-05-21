//! Force critical JWT vars from a `.env` file so they override IDE/shell-inherited values.
//! `dotenv::from_path` skips keys that already exist — that mismatch breaks ws-gateway auth.

use std::path::Path;

pub fn force_jwt_from_env_file(path: &Path) {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some((key_raw, val_raw)) = line.split_once('=') else {
            continue;
        };
        let key = key_raw.trim();
        if key != "JWT_SECRET" && key != "JWT_ISSUER" {
            continue;
        }
        let mut val = val_raw.trim();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
            val = &val[1..val.len() - 1];
        }
        if let Some(i) = val.find(" #") {
            val = val[..i].trim_end();
        }
        std::env::set_var(key, val);
    }
}
