//! AI user report generation: data gathering, prompt building, streaming orchestration.

pub mod data_gatherer;
pub mod prompt_builder;
pub mod report_service;

pub use data_gatherer::{gather_report_data, ReportData};
pub use prompt_builder::build_report_prompt;
pub use report_service::{
    generate_bulk_reports, generate_single_report, insert_pending_report,
    load_report_platform_config, run_report_generation, ReportPlatformConfig,
};
