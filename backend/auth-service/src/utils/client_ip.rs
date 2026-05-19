//! Resolve the client IP from proxy headers or the TCP peer address.

use axum::http::HeaderMap;
use std::net::SocketAddr;

const IP_HEADER_NAMES: &[&str] = &[
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
    "true-client-ip",
];

/// Best-effort client IP: trusted proxy headers first, then the connection peer.
pub fn extract_client_ip(headers: &HeaderMap, peer_addr: Option<SocketAddr>) -> Option<String> {
    ip_from_headers(headers).or_else(|| peer_addr.map(|a| normalize_ip(&a.ip().to_string())))
}

fn ip_from_headers(headers: &HeaderMap) -> Option<String> {
    for name in IP_HEADER_NAMES {
        let Some(value) = headers.get(*name).and_then(|h| h.to_str().ok()) else {
            continue;
        };
        let first = value.split(',').next().unwrap_or(value).trim();
        if !first.is_empty() {
            return Some(normalize_ip(first));
        }
    }
    None
}

fn normalize_ip(ip: &str) -> String {
    let ip = ip.trim();
    ip.strip_prefix("::ffff:")
        .map(str::to_string)
        .unwrap_or_else(|| ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn forwarded_for_chain_uses_first_hop() {
        let mut h = HeaderMap::new();
        h.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.5, 10.0.0.1"),
        );
        assert_eq!(
            extract_client_ip(&h, None).as_deref(),
            Some("203.0.113.5")
        );
    }

    #[test]
    fn real_ip_fallback() {
        let mut h = HeaderMap::new();
        h.insert("x-real-ip", HeaderValue::from_static("198.51.100.2"));
        assert_eq!(
            extract_client_ip(&h, None).as_deref(),
            Some("198.51.100.2")
        );
    }

    #[test]
    fn peer_addr_when_no_headers() {
        let peer: SocketAddr = "203.0.113.9:12345".parse().unwrap();
        assert_eq!(
            extract_client_ip(&HeaderMap::new(), Some(peer)).as_deref(),
            Some("203.0.113.9")
        );
    }

    #[test]
    fn strips_ipv4_mapped_prefix() {
        let peer: SocketAddr = "[::ffff:127.0.0.1]:8080".parse().unwrap();
        assert_eq!(
            extract_client_ip(&HeaderMap::new(), Some(peer)).as_deref(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn empty_forwarded_for_uses_peer() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", HeaderValue::from_static("  ,  "));
        let peer: SocketAddr = "10.1.2.3:9".parse().unwrap();
        assert_eq!(
            extract_client_ip(&h, Some(peer)).as_deref(),
            Some("10.1.2.3")
        );
    }
}
