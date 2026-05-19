//! Fast User-Agent parsing for audit device classification (no external deps).

use serde_json::{json, Value as JsonValue};

pub const DEVICE_UNKNOWN: &str = "unknown";
pub const DEVICE_MOBILE: &str = "mobile";
pub const DEVICE_TABLET: &str = "tablet";
pub const DEVICE_DESKTOP: &str = "desktop";
pub const DEVICE_BOT: &str = "bot";

const MAX_LABEL_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    pub class: &'static str,
    pub os: Option<String>,
    pub browser: Option<String>,
}

/// Parse coarse device info from a User-Agent string. Cheap enough to run on every event insert.
pub fn device_from_user_agent(ua: &str) -> DeviceInfo {
    let ua = ua.trim();
    if ua.is_empty() {
        return DeviceInfo {
            class: DEVICE_UNKNOWN,
            os: None,
            browser: None,
        };
    }

    let lower = ua.to_ascii_lowercase();

    if is_bot(&lower) {
        return DeviceInfo {
            class: DEVICE_BOT,
            os: detect_os(&lower),
            browser: detect_browser(&lower),
        };
    }

    let class = detect_class(&lower);
    DeviceInfo {
        class,
        os: detect_os(&lower),
        browser: detect_browser(&lower),
    }
}

fn truncate_label(s: String) -> String {
    if s.len() <= MAX_LABEL_LEN {
        s
    } else {
        s.chars().take(MAX_LABEL_LEN).collect()
    }
}

fn is_bot(lower: &str) -> bool {
    const BOT_MARKERS: &[&str] = &[
        "bot", "spider", "crawl", "slurp", "headless", "phantomjs", "selenium",
        "wget", "curl/", "python-requests", "go-http-client", "libwww",
        "scrapy", "facebookexternalhit", "bingpreview", "googlebot", "yandexbot",
        "baiduspider", "duckduckbot", "applebot", "petalbot",
    ];
    BOT_MARKERS.iter().any(|m| lower.contains(m))
}

fn detect_class(lower: &str) -> &'static str {
    if lower.contains("ipad")
        || lower.contains("tablet")
        || lower.contains("kindle")
        || lower.contains("silk/")
        || (lower.contains("android") && !lower.contains("mobile"))
    {
        return DEVICE_TABLET;
    }

    if lower.contains("iphone")
        || lower.contains("ipod")
        || lower.contains("android") && lower.contains("mobile")
        || lower.contains("windows phone")
        || lower.contains("blackberry")
        || lower.contains("mobile")
    {
        return DEVICE_MOBILE;
    }

    if lower.contains("windows nt")
        || lower.contains("macintosh")
        || lower.contains("mac os x")
        || lower.contains("x11")
        || lower.contains("cros")
        || lower.contains("linux")
    {
        return DEVICE_DESKTOP;
    }

    DEVICE_UNKNOWN
}

fn detect_os(lower: &str) -> Option<String> {
    let os = if lower.contains("iphone") || lower.contains("ipad") || lower.contains("ipod") {
        "iOS"
    } else if lower.contains("android") {
        "Android"
    } else if lower.contains("windows phone") {
        "Windows Phone"
    } else if lower.contains("windows nt") || lower.contains("win64") || lower.contains("win32") {
        "Windows"
    } else if lower.contains("mac os x") || lower.contains("macintosh") {
        "macOS"
    } else if lower.contains("cros") {
        "Chrome OS"
    } else if lower.contains("linux") || lower.contains("x11") {
        "Linux"
    } else {
        return None;
    };
    Some(truncate_label(os.to_string()))
}

fn detect_browser(lower: &str) -> Option<String> {
    // Order matters: Chromium derivatives before Safari/Chrome
    let browser = if lower.contains("edg/") || lower.contains("edge/") {
        "Edge"
    } else if lower.contains("opr/") || lower.contains("opera") {
        "Opera"
    } else if lower.contains("firefox/") || lower.contains("fxios") {
        "Firefox"
    } else if lower.contains("crios") {
        "Chrome"
    } else if lower.contains("chrome/") && !lower.contains("chromium") {
        "Chrome"
    } else if lower.contains("safari/") && !lower.contains("chrome/") && !lower.contains("chromium") {
        "Safari"
    } else if lower.contains("msie") || lower.contains("trident/") {
        "Internet Explorer"
    } else {
        return None;
    };
    Some(truncate_label(browser.to_string()))
}

/// Merge `device` into event meta (does not overwrite existing `meta.device`).
pub fn merge_device_into_meta(mut meta: JsonValue, device: &DeviceInfo) -> JsonValue {
    let obj = meta.as_object_mut();
    if let Some(map) = obj {
        if !map.contains_key("device") {
            map.insert(
                "device".to_string(),
                json!({
                    "class": device.class,
                    "os": device.os,
                    "browser": device.browser,
                    "source": "user-agent",
                }),
            );
        }
    } else {
        meta = json!({
            "device": {
                "class": device.class,
                "os": device.os,
                "browser": device.browser,
                "source": "user-agent",
            }
        });
    }
    meta
}

pub fn device_from_user_agent_or_unknown(ua: Option<&str>) -> DeviceInfo {
    match ua {
        Some(s) if !s.trim().is_empty() => device_from_user_agent(s),
        _ => DeviceInfo {
            class: DEVICE_UNKNOWN,
            os: None,
            browser: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iphone_is_mobile_ios_safari() {
        let d = device_from_user_agent(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        );
        assert_eq!(d.class, DEVICE_MOBILE);
        assert_eq!(d.os.as_deref(), Some("iOS"));
        assert_eq!(d.browser.as_deref(), Some("Safari"));
    }

    #[test]
    fn ipad_is_tablet() {
        let d = device_from_user_agent(
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        );
        assert_eq!(d.class, DEVICE_TABLET);
    }

    #[test]
    fn mac_firefox_is_desktop() {
        let d = device_from_user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0",
        );
        assert_eq!(d.class, DEVICE_DESKTOP);
        assert_eq!(d.os.as_deref(), Some("macOS"));
        assert_eq!(d.browser.as_deref(), Some("Firefox"));
    }

    #[test]
    fn android_mobile() {
        let d = device_from_user_agent(
            "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        );
        assert_eq!(d.class, DEVICE_MOBILE);
        assert_eq!(d.os.as_deref(), Some("Android"));
        assert_eq!(d.browser.as_deref(), Some("Chrome"));
    }

    #[test]
    fn googlebot_is_bot() {
        let d = device_from_user_agent(
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        );
        assert_eq!(d.class, DEVICE_BOT);
    }

    #[test]
    fn empty_is_unknown() {
        let d = device_from_user_agent("");
        assert_eq!(d.class, DEVICE_UNKNOWN);
    }
}
