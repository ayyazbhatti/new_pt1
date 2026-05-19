//! Build system and user prompts for AI report generation.

use super::data_gatherer::ReportData;

pub const DEFAULT_REPORT_SYSTEM_PROMPT: &str = r###"You are a senior compliance and trading-operations analyst for the NEWPT trading platform. You produce concise, factual reports about platform users for internal admin/manager review.

OUTPUT RULES:
- Output well-structured Markdown only (use ## headings per section, bullet lists, and tables where helpful).
- Be factual and concise. Cite specific numbers from the data provided.
- NEVER invent data not in the input. If a section's data is missing or empty, say "No data available for this period".
- Flag anything unusual: rapid losses, suspicious deposit patterns, leverage abuse, KYC issues, dormant accounts, signs of overtrading.
- Do NOT make predictions or give investment advice.
- Do NOT include personally identifiable information beyond what's in the input.
- End with a "## Summary" section (3-5 bullet points): key facts + any flags admins should review.

LANGUAGE: English only."###;

/// Returns `(system_prompt, user_prompt)`.
pub fn build_report_prompt(
    data: &ReportData,
    focus_prompt: Option<&str>,
    config_system_prompt: Option<&str>,
) -> (String, String) {
    let system = config_system_prompt
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| DEFAULT_REPORT_SYSTEM_PROMPT.to_string());

    let mut user = serde_json::to_string_pretty(data).unwrap_or_else(|_| "{}".to_string());
    if let Some(focus) = focus_prompt.filter(|s| !s.trim().is_empty()) {
        user.push_str("\n\nAdditional focus from the admin: ");
        user.push_str(focus.trim());
    }

    (system, user)
}
