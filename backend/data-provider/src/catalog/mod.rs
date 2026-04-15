//! Load enabled instruments from the shared `symbols` table so upstream MMDPS subscriptions
//! stay aligned with the admin catalog (no manual `MMDPS_SYMBOLS` env for large sets).

pub mod symbol_catalog;
