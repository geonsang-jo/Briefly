use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration as StdDuration, SystemTime};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishCommandResult {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoConversationResult {
    conversation: String,
    message_count: usize,
    sources: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathCheckStatus {
    label: String,
    resolved_path: String,
    exists: bool,
    has_jsonl: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectLogPathsResult {
    codex: PathCheckStatus,
    claude: PathCheckStatus,
    cursor: PathCheckStatus,
    gemini: PathCheckStatus,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsProfile {
    name: String,
    finish_command: String,
    auto_summarize_on_finish: bool,
    collect_from_local_logs: bool,
    codex_root_path: String,
    claude_root_path: String,
    cursor_root_path: String,
    gemini_root_path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsRecordMeta {
    id: String,
    created_at: String,
    provider: String,
    date_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsRollupMeta {
    id: String,
    created_at: String,
    period: String,
    period_key: String,
    start_date_key: String,
    end_date_key: String,
    source_date_keys: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SummaryEvidenceItem {
    time: String,
    source: String,
    text: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SummaryContextData {
    name: String,
    summary: String,
    done_todos: Vec<String>,
    work_logs: Vec<String>,
    issues: Vec<String>,
    evidence: Vec<SummaryEvidenceItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProviderSummaryData {
    version: String,
    provider: String,
    date_key: String,
    one_line_summary: String,
    done_todos: Vec<String>,
    work_logs: Vec<String>,
    issues: Vec<String>,
    evidence: Vec<SummaryEvidenceItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MergedSummaryData {
    version: String,
    date_key: String,
    connected_providers: Vec<String>,
    daily_summary: String,
    done_todos: Vec<String>,
    work_logs: Vec<String>,
    issues: Vec<String>,
    evidence: Vec<SummaryEvidenceItem>,
    #[serde(default)]
    contexts: Vec<SummaryContextData>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsRecordItem {
    id: String,
    created_at: String,
    provider: String,
    date_key: String,
    summary: String,
    provider_results: Option<Vec<ProviderSummaryData>>,
    merged: Option<MergedSummaryData>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsRollupItem {
    id: String,
    created_at: String,
    period: String,
    period_key: String,
    start_date_key: String,
    end_date_key: String,
    source_date_keys: Vec<String>,
    summary: String,
    merged: Option<MergedSummaryData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRecordInput {
    id: String,
    created_at: String,
    provider: String,
    date_key: Option<String>,
    summary: String,
    provider_results: Option<Vec<ProviderSummaryData>>,
    merged: Option<MergedSummaryData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRollupInput {
    id: String,
    created_at: String,
    period: String,
    period_key: String,
    start_date_key: String,
    end_date_key: String,
    source_date_keys: Vec<String>,
    summary: String,
    merged: Option<MergedSummaryData>,
}

struct CollectedMessage {
    timestamp: String,
    source: &'static str,
    role: &'static str,
    text: String,
}

fn truncate_chars(input: &str, max_len: usize) -> String {
    let mut iter = input.chars();
    let mut out = String::new();

    for _ in 0..max_len {
        if let Some(ch) = iter.next() {
            out.push(ch);
        } else {
            return out;
        }
    }

    if iter.next().is_some() {
        out.push_str("\n...(truncated)");
    }

    out
}

fn parse_rfc3339_to_local_date(timestamp: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.with_timezone(&Local).date_naive())
}

fn format_local_timestamp(timestamp: &str) -> String {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| timestamp.to_string())
}

fn compact_text(input: &str, max_len: usize) -> String {
    let normalized = input.replace('\r', "");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    truncate_chars(trimmed, max_len)
}

fn is_wrap_up_generated_text(text: &str) -> bool {
    let normalized = text.to_lowercase();
    normalized.contains("[briefly_wrap_up]")
        || normalized.contains("you are summarizing")
        || normalized.contains("required format:")
        || normalized.contains("use only the conversation context below")
        || normalized.contains("# daily wrap-up")
        || normalized.contains("connected ai:")
}

fn extract_text_chunks(value: &Value, chunks: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if !text.is_empty() {
                chunks.push(text.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_text_chunks(item, chunks);
            }
        }
        Value::Object(map) => {
            let message_type = map
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            if matches!(
                message_type.as_str(),
                "text" | "input_text" | "output_text" | "inputText" | "outputText"
            ) {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    let text = text.trim();
                    if !text.is_empty() {
                        chunks.push(text.to_string());
                    }
                }
            }

            if message_type.is_empty() {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    let text = text.trim();
                    if !text.is_empty() {
                        chunks.push(text.to_string());
                    }
                }
            }

            if let Some(content) = map.get("content") {
                extract_text_chunks(content, chunks);
            }
        }
        _ => {}
    }
}

fn extract_text(value: &Value, max_len: usize) -> String {
    let mut chunks = Vec::new();
    extract_text_chunks(value, &mut chunks);
    compact_text(&chunks.join("\n"), max_len)
}

fn collect_codex_session_files(codex_root: &Path) -> Vec<PathBuf> {
    let sessions_root = codex_root.join("sessions");
    if !sessions_root.exists() || !sessions_root.is_dir() {
        return Vec::new();
    }

    // Codex app can keep appending today's messages to a session file that was
    // originally created days ago. We therefore select recent files by mtime
    // instead of only scanning today's directory.
    let modified_after = SystemTime::now()
        .checked_sub(StdDuration::from_secs(60 * 60 * 72))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    collect_recent_jsonl_files(&sessions_root, modified_after, 260)
}

fn resolve_codex_root(home_dir: &Path, custom_root: Option<String>) -> PathBuf {
    if let Some(path) = custom_root {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Ok(path) = std::env::var("CODEX_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    home_dir.join(".codex")
}

fn resolve_claude_root(home_dir: &Path, custom_root: Option<String>) -> PathBuf {
    if let Some(path) = custom_root {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    for env_key in ["CLAUDE_HOME", "CLAUDE_CONFIG_DIR"] {
        if let Ok(path) = std::env::var(env_key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }

    home_dir.join(".claude")
}

fn resolve_claude_projects_dir(claude_root: &Path) -> PathBuf {
    if claude_root
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("projects"))
        .unwrap_or(false)
    {
        return claude_root.to_path_buf();
    }

    claude_root.join("projects")
}

fn resolve_cursor_root(home_dir: &Path, custom_root: Option<String>) -> PathBuf {
    if let Some(path) = custom_root {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    for env_key in ["CURSOR_HOME", "CURSOR_CONFIG_DIR"] {
        if let Ok(path) = std::env::var(env_key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }

    home_dir.join(".cursor")
}

fn resolve_cursor_search_dir(cursor_root: &Path) -> PathBuf {
    if cursor_root
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("agent-transcripts"))
        .unwrap_or(false)
    {
        return cursor_root.to_path_buf();
    }

    cursor_root.join("projects")
}

fn resolve_gemini_root(home_dir: &Path, custom_root: Option<String>) -> PathBuf {
    if let Some(path) = custom_root {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    for env_key in ["GEMINI_HOME", "GEMINI_CONFIG_DIR"] {
        if let Ok(path) = std::env::var(env_key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }

    home_dir.join(".gemini")
}

fn system_time_to_local_date(value: SystemTime) -> NaiveDate {
    DateTime::<Local>::from(value).date_naive()
}

fn system_time_to_rfc3339(value: SystemTime) -> String {
    DateTime::<Local>::from(value).to_rfc3339()
}

fn path_to_display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn briefly_base_dir() -> Result<PathBuf, String> {
    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Ok(Path::new(trimmed).join(".briefly"));
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Ok(Path::new(trimmed).join(".briefly"));
        }
    }

    Err("Unable to resolve user home directory.".to_string())
}

fn briefly_records_dir(base: &Path) -> PathBuf {
    base.join("records")
}

fn briefly_rollups_dir(base: &Path) -> PathBuf {
    base.join("rollups")
}

fn briefly_rollup_period_dir(base: &Path, period: &str) -> PathBuf {
    briefly_rollups_dir(base).join(period)
}

fn ensure_briefly_dirs(base: &Path) -> Result<(), String> {
    fs::create_dir_all(base)
        .map_err(|err| format!("Failed to create briefly base dir {}: {err}", base.display()))?;
    let records_dir = briefly_records_dir(base);
    fs::create_dir_all(&records_dir).map_err(|err| {
        format!(
            "Failed to create briefly records dir {}: {err}",
            records_dir.display()
        )
    })?;
    let week_rollups_dir = briefly_rollup_period_dir(base, "week");
    fs::create_dir_all(&week_rollups_dir).map_err(|err| {
        format!(
            "Failed to create briefly week rollups dir {}: {err}",
            week_rollups_dir.display()
        )
    })?;
    let month_rollups_dir = briefly_rollup_period_dir(base, "month");
    fs::create_dir_all(&month_rollups_dir).map_err(|err| {
        format!(
            "Failed to create briefly month rollups dir {}: {err}",
            month_rollups_dir.display()
        )
    })?;
    Ok(())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Cannot write file because parent directory is missing: {}",
            path.display()
        )
    })?;

    fs::create_dir_all(parent).map_err(|err| {
        format!(
            "Failed to create parent directory {}: {err}",
            parent.display()
        )
    })?;

    let temp_path = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("briefly")
    ));

    fs::write(&temp_path, content)
        .map_err(|err| format!("Failed to write temp file {}: {err}", temp_path.display()))?;
    fs::rename(&temp_path, path).map_err(|err| {
        format!(
            "Failed to move temp file {} to {}: {err}",
            temp_path.display(),
            path.display()
        )
    })?;

    Ok(())
}

fn parse_date_key(value: &str) -> Option<String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

fn parse_month_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let mut chunks = trimmed.split('-');
    let year = chunks.next()?.parse::<i32>().ok()?;
    let month = chunks.next()?.parse::<u32>().ok()?;
    if chunks.next().is_some() {
        return None;
    }
    if month == 0 || month > 12 {
        return None;
    }
    Some(format!("{year:04}-{month:02}"))
}

fn normalize_rollup_period(value: &str) -> Option<String> {
    match value.trim() {
        "week" => Some("week".to_string()),
        "month" => Some("month".to_string()),
        _ => None,
    }
}

fn normalize_rollup_period_key(period: &str, value: &str) -> Option<String> {
    if period == "week" {
        return parse_date_key(value);
    }

    if period == "month" {
        return parse_month_key(value);
    }

    None
}

fn date_key_from_created_at(created_at: &str) -> String {
    DateTime::parse_from_rfc3339(created_at)
        .map(|dt| dt.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| Local::now().format("%Y-%m-%d").to_string())
}

fn normalize_provider(value: &str) -> String {
    match value.trim() {
        "terminal" => "terminal".to_string(),
        _ => "local".to_string(),
    }
}

fn strip_markdown_front_matter(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return trimmed.to_string();
    }

    let mut lines = trimmed.lines();
    let first = lines.next();
    if first != Some("---") {
        return trimmed.to_string();
    }

    let mut front_matter_closed = false;
    let mut remainder = Vec::new();

    for line in lines {
        if !front_matter_closed && line.trim() == "---" {
            front_matter_closed = true;
            continue;
        }

        if front_matter_closed {
            remainder.push(line);
        }
    }

    if !front_matter_closed {
        return trimmed.to_string();
    }

    remainder.join("\n").trim().to_string()
}

fn summary_markdown(date_key: &str, provider: &str, created_at: &str, summary: &str) -> String {
    format!(
        "---\ndate: {date_key}\nprovider: {provider}\ncreatedAt: {created_at}\n---\n\n{}\n",
        summary.trim()
    )
}

fn rollup_markdown(
    period: &str,
    period_key: &str,
    start_date_key: &str,
    end_date_key: &str,
    created_at: &str,
    summary: &str,
) -> String {
    format!(
        "---\nperiod: {period}\nperiodKey: {period_key}\nstartDateKey: {start_date_key}\nendDateKey: {end_date_key}\ncreatedAt: {created_at}\n---\n\n{}\n",
        summary.trim()
    )
}

fn provider_file_stem(provider: &str) -> String {
    let normalized = provider
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

fn contains_jsonl_file(root: &Path, max_dirs: usize, max_entries_per_dir: usize) -> bool {
    if !root.exists() || !root.is_dir() {
        return false;
    }

    let mut dirs_checked = 0usize;
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        dirs_checked += 1;
        if dirs_checked > max_dirs {
            break;
        }

        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten().take(max_entries_per_dir) {
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                stack.push(path);
                continue;
            }

            let is_jsonl = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false);
            if is_jsonl {
                return true;
            }
        }
    }

    false
}

fn collect_recent_jsonl_files(
    root: &Path,
    modified_after: SystemTime,
    max_files: usize,
) -> Vec<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    let mut candidates: Vec<(SystemTime, PathBuf)> = Vec::new();

    while let Some(current_dir) = stack.pop() {
        let entries = match fs::read_dir(current_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                stack.push(path);
                continue;
            }

            let is_jsonl = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
                .unwrap_or(false);
            if !is_jsonl {
                continue;
            }

            let modified_at = match metadata.modified() {
                Ok(modified_at) => modified_at,
                Err(_) => continue,
            };
            if modified_at < modified_after {
                continue;
            }

            candidates.push((modified_at, path));
        }
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().take(max_files).map(|(_, path)| path).collect()
}

fn collect_codex_messages(
    file_path: &Path,
    today: NaiveDate,
    messages: &mut Vec<CollectedMessage>,
) -> Result<(), String> {
    let file = File::open(file_path)
        .map_err(|err| format!("Failed to open codex session file {}: {err}", file_path.display()))?;
    let reader = BufReader::new(file);
    let mut skip_wrap_up_assistant = false;
    let mut seen = HashSet::new();

    for line in reader.lines().flatten() {
        let record: Value = match serde_json::from_str(&line) {
            Ok(record) => record,
            Err(_) => continue,
        };

        let timestamp = match record.get("timestamp").and_then(Value::as_str) {
            Some(timestamp) if parse_rfc3339_to_local_date(timestamp) == Some(today) => timestamp,
            _ => continue,
        };

        let payload = match record.get("payload") {
            Some(payload) => payload,
            None => continue,
        };
        let record_type = record.get("type").and_then(Value::as_str).unwrap_or_default();

        let (role, text) = if record_type == "event_msg" {
            let payload_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();

            if payload_type == "task_complete" && skip_wrap_up_assistant {
                skip_wrap_up_assistant = false;
                continue;
            }

            match payload_type {
                "user_message" => (
                    "user",
                    compact_text(payload.get("message").and_then(Value::as_str).unwrap_or_default(), 1500),
                ),
                "agent_message" => (
                    "assistant",
                    compact_text(payload.get("message").and_then(Value::as_str).unwrap_or_default(), 1500),
                ),
                _ => continue,
            }
        } else if record_type == "response_item" {
            let item_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();
            if item_type != "message" {
                continue;
            }

            let role = match payload.get("role").and_then(Value::as_str) {
                Some("user") => "user",
                Some("assistant") => "assistant",
                _ => continue,
            };

            let text = extract_text(payload.get("content").unwrap_or(&Value::Null), 1500);
            (role, text)
        } else {
            continue;
        };

        if text.is_empty() {
            continue;
        }

        if role == "user" {
            if is_wrap_up_generated_text(&text) {
                skip_wrap_up_assistant = true;
                continue;
            }
            skip_wrap_up_assistant = false;
        } else if skip_wrap_up_assistant || is_wrap_up_generated_text(&text) {
            continue;
        }

        let dedupe_key = format!("{timestamp}|{role}|{text}");
        if !seen.insert(dedupe_key) {
            continue;
        }

        messages.push(CollectedMessage {
            timestamp: timestamp.to_string(),
            source: "codex",
            role,
            text,
        });
    }

    Ok(())
}

fn collect_claude_messages(
    file_path: &Path,
    today: NaiveDate,
    messages: &mut Vec<CollectedMessage>,
) -> Result<(), String> {
    let file = File::open(file_path)
        .map_err(|err| format!("Failed to open claude session file {}: {err}", file_path.display()))?;
    let reader = BufReader::new(file);
    let mut skip_wrap_up_assistant = false;

    for line in reader.lines().flatten() {
        let record: Value = match serde_json::from_str(&line) {
            Ok(record) => record,
            Err(_) => continue,
        };

        let timestamp = match record.get("timestamp").and_then(Value::as_str) {
            Some(timestamp) if parse_rfc3339_to_local_date(timestamp) == Some(today) => timestamp,
            _ => continue,
        };

        let item_type = record.get("type").and_then(Value::as_str).unwrap_or_default();
        let role = match item_type {
            "user" => "user",
            "assistant" => "assistant",
            _ => continue,
        };

        let text = extract_text(
            record
                .get("message")
                .and_then(|value| value.get("content"))
                .unwrap_or(&Value::Null),
            1500,
        );
        if text.is_empty() {
            continue;
        }

        if role == "user" {
            if is_wrap_up_generated_text(&text) {
                skip_wrap_up_assistant = true;
                continue;
            }
            skip_wrap_up_assistant = false;
        } else if skip_wrap_up_assistant || is_wrap_up_generated_text(&text) {
            continue;
        }

        messages.push(CollectedMessage {
            timestamp: timestamp.to_string(),
            source: "claude",
            role,
            text,
        });
    }

    Ok(())
}

fn normalize_role(value: &str) -> Option<&'static str> {
    let normalized = value.to_lowercase();
    if normalized.contains("user") || normalized.contains("human") {
        return Some("user");
    }
    if normalized.contains("assistant") || normalized.contains("model") || normalized.contains("ai") {
        return Some("assistant");
    }
    None
}

fn collect_generic_jsonl_messages(
    file_path: &Path,
    source: &'static str,
    today: NaiveDate,
    messages: &mut Vec<CollectedMessage>,
) -> Result<(), String> {
    let metadata = fs::metadata(file_path)
        .map_err(|err| format!("Failed to read metadata for {}: {err}", file_path.display()))?;
    let modified_at = metadata
        .modified()
        .map_err(|err| format!("Failed to read modified time for {}: {err}", file_path.display()))?;

    if system_time_to_local_date(modified_at) != today {
        return Ok(());
    }
    let fallback_timestamp = system_time_to_rfc3339(modified_at);

    let file = File::open(file_path)
        .map_err(|err| format!("Failed to open session file {}: {err}", file_path.display()))?;
    let reader = BufReader::new(file);

    for line in reader.lines().flatten() {
        let record: Value = match serde_json::from_str(&line) {
            Ok(record) => record,
            Err(_) => continue,
        };

        let role = match record.get("role").and_then(Value::as_str).and_then(normalize_role) {
            Some(role) => role,
            None => continue,
        };

        let text = if let Some(message) = record.get("message") {
            extract_text(message, 1500)
        } else {
            extract_text(&record, 1500)
        };

        if text.is_empty() {
            continue;
        }

        if is_wrap_up_generated_text(&text) {
            continue;
        }

        messages.push(CollectedMessage {
            timestamp: fallback_timestamp.clone(),
            source,
            role,
            text,
        });
    }

    Ok(())
}

fn build_conversation(messages: &mut [CollectedMessage], max_chars: usize) -> AutoConversationResult {
    messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    let mut output = String::from("오늘 로컬 터미널 대화 자동 수집 결과\n");
    let mut sources = HashSet::new();
    let mut used_count = 0usize;

    for message in messages {
        let time_label = format_local_timestamp(&message.timestamp);
        let chunk = format!(
            "\n[{}] [{}] {}\n{}\n",
            time_label, message.source, message.role, message.text
        );

        if output.len() + chunk.len() > max_chars {
            break;
        }

        output.push_str(&chunk);
        sources.insert(message.source.to_string());
        used_count += 1;
    }

    let mut source_list: Vec<String> = sources.into_iter().collect();
    source_list.sort();

    AutoConversationResult {
        conversation: output.trim().to_string(),
        message_count: used_count,
        sources: source_list,
    }
}

#[tauri::command]
async fn collect_today_terminal_conversation(
    max_chars: Option<usize>,
    codex_root_path: Option<String>,
    claude_root_path: Option<String>,
    cursor_root_path: Option<String>,
    gemini_root_path: Option<String>,
) -> Result<AutoConversationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map_err(|err| format!("HOME not available: {err}"))?;
        let home_dir = Path::new(&home);
        let today = Local::now().date_naive();
        let max_chars = max_chars.unwrap_or(50_000).clamp(4_000, 120_000);

        let mut messages = Vec::new();

        let codex_root = resolve_codex_root(home_dir, codex_root_path);
        let codex_files = collect_codex_session_files(&codex_root);
        for file_path in codex_files {
            let _ = collect_codex_messages(&file_path, today, &mut messages);
        }

        let claude_root = resolve_claude_root(home_dir, claude_root_path);
        let claude_projects_dir = resolve_claude_projects_dir(&claude_root);
        if claude_projects_dir.exists() {
            let modified_after = SystemTime::now()
                .checked_sub(StdDuration::from_secs(60 * 60 * 36))
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let claude_files = collect_recent_jsonl_files(&claude_projects_dir, modified_after, 180);
            for file_path in claude_files {
                let _ = collect_claude_messages(&file_path, today, &mut messages);
            }
        }

        let cursor_root = resolve_cursor_root(home_dir, cursor_root_path);
        let cursor_search_dir = resolve_cursor_search_dir(&cursor_root);
        if cursor_search_dir.exists() {
            let modified_after = SystemTime::now()
                .checked_sub(StdDuration::from_secs(60 * 60 * 36))
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let cursor_files = collect_recent_jsonl_files(&cursor_search_dir, modified_after, 120);
            for file_path in cursor_files {
                let _ = collect_generic_jsonl_messages(&file_path, "cursor", today, &mut messages);
            }
        }

        let gemini_root = resolve_gemini_root(home_dir, gemini_root_path);
        if gemini_root.exists() {
            let modified_after = SystemTime::now()
                .checked_sub(StdDuration::from_secs(60 * 60 * 36))
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let gemini_files = collect_recent_jsonl_files(&gemini_root, modified_after, 120);
            for file_path in gemini_files {
                let _ = collect_generic_jsonl_messages(&file_path, "gemini", today, &mut messages);
            }
        }

        Ok(build_conversation(&mut messages, max_chars))
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn detect_log_paths(
    codex_root_path: Option<String>,
    claude_root_path: Option<String>,
    cursor_root_path: Option<String>,
    gemini_root_path: Option<String>,
) -> Result<DetectLogPathsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map_err(|err| format!("HOME not available: {err}"))?;
        let home_dir = Path::new(&home);

        let codex_root = resolve_codex_root(home_dir, codex_root_path);
        let codex_sessions = codex_root.join("sessions");
        let codex_exists = codex_sessions.exists() && codex_sessions.is_dir();
        let codex_has_jsonl = contains_jsonl_file(&codex_sessions, 120, 400);

        let claude_root = resolve_claude_root(home_dir, claude_root_path);
        let claude_projects = resolve_claude_projects_dir(&claude_root);
        let claude_exists = claude_projects.exists() && claude_projects.is_dir();
        let claude_has_jsonl = contains_jsonl_file(&claude_projects, 120, 500);

        let cursor_root = resolve_cursor_root(home_dir, cursor_root_path);
        let cursor_search_dir = resolve_cursor_search_dir(&cursor_root);
        let cursor_exists = cursor_search_dir.exists() && cursor_search_dir.is_dir();
        let cursor_has_jsonl = contains_jsonl_file(&cursor_search_dir, 120, 500);

        let gemini_root = resolve_gemini_root(home_dir, gemini_root_path);
        let gemini_exists = gemini_root.exists() && gemini_root.is_dir();
        let gemini_has_jsonl = contains_jsonl_file(&gemini_root, 120, 400);

        Ok(DetectLogPathsResult {
            codex: PathCheckStatus {
                label: "Codex".to_string(),
                resolved_path: path_to_display(&codex_root),
                exists: codex_exists,
                has_jsonl: codex_has_jsonl,
            },
            claude: PathCheckStatus {
                label: "Claude".to_string(),
                resolved_path: path_to_display(&claude_root),
                exists: claude_exists,
                has_jsonl: claude_has_jsonl,
            },
            cursor: PathCheckStatus {
                label: "Cursor".to_string(),
                resolved_path: path_to_display(&cursor_root),
                exists: cursor_exists,
                has_jsonl: cursor_has_jsonl,
            },
            gemini: PathCheckStatus {
                label: "Gemini".to_string(),
                resolved_path: path_to_display(&gemini_root),
                exists: gemini_exists,
                has_jsonl: gemini_has_jsonl,
            },
        })
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn load_profile_from_fs() -> Result<Option<FsProfile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base_dir = briefly_base_dir()?;
        let profile_path = base_dir.join("profile.json");
        if !profile_path.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(&profile_path)
            .map_err(|err| format!("Failed to read profile file {}: {err}", profile_path.display()))?;
        let profile: FsProfile = serde_json::from_str(&raw)
            .map_err(|err| format!("Failed to parse profile file {}: {err}", profile_path.display()))?;

        if profile.name.trim().is_empty() {
            return Ok(None);
        }

        Ok(Some(profile))
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn save_profile_to_fs(profile: FsProfile) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base_dir = briefly_base_dir()?;
        ensure_briefly_dirs(&base_dir)?;

        let profile_path = base_dir.join("profile.json");
        let content = serde_json::to_vec_pretty(&profile)
            .map_err(|err| format!("Failed to serialize profile: {err}"))?;
        atomic_write(&profile_path, &content)?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn list_records_from_fs() -> Result<Vec<FsRecordItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base_dir = briefly_base_dir()?;
        let records_dir = briefly_records_dir(&base_dir);
        if !records_dir.exists() || !records_dir.is_dir() {
            return Ok(Vec::new());
        }

        let mut items = Vec::new();

        let entries = fs::read_dir(&records_dir)
            .map_err(|err| format!("Failed to read records dir {}: {err}", records_dir.display()))?;

        for entry in entries.flatten() {
            let date_dir = entry.path();
            if !date_dir.is_dir() {
                continue;
            }

            let fallback_date_key = entry
                .file_name()
                .to_str()
                .map(|value| value.to_string())
                .unwrap_or_default();

            let meta_path = date_dir.join("meta.json");
            let summary_path = date_dir.join("summary.md");

            let meta_raw = match fs::read_to_string(&meta_path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            let meta: FsRecordMeta = match serde_json::from_str(&meta_raw) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let summary = match fs::read_to_string(&summary_path) {
                Ok(content) => strip_markdown_front_matter(&content),
                Err(_) => String::new(),
            };
            if meta.id.trim().is_empty() || meta.created_at.trim().is_empty() {
                continue;
            }

            let date_key = parse_date_key(&meta.date_key)
                .or_else(|| parse_date_key(&fallback_date_key))
                .unwrap_or_else(|| date_key_from_created_at(&meta.created_at));

            let merged_path = date_dir.join("merged.json");
            let merged = fs::read_to_string(&merged_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<MergedSummaryData>(&raw).ok());

            let providers_dir = date_dir.join("providers");
            let mut provider_results: Vec<ProviderSummaryData> = Vec::new();
            if providers_dir.exists() && providers_dir.is_dir() {
                if let Ok(provider_entries) = fs::read_dir(&providers_dir) {
                    for provider_entry in provider_entries.flatten() {
                        let provider_path = provider_entry.path();
                        let is_json = provider_path
                            .extension()
                            .and_then(|value| value.to_str())
                            .map(|ext| ext.eq_ignore_ascii_case("json"))
                            .unwrap_or(false);
                        if !is_json {
                            continue;
                        }

                        let provider_raw = match fs::read_to_string(&provider_path) {
                            Ok(content) => content,
                            Err(_) => continue,
                        };
                        let parsed = match serde_json::from_str::<ProviderSummaryData>(&provider_raw) {
                            Ok(data) => data,
                            Err(_) => continue,
                        };
                        provider_results.push(parsed);
                    }
                }
            }
            provider_results.sort_by(|a, b| a.provider.cmp(&b.provider));

            let effective_summary = if summary.is_empty() {
                merged
                    .as_ref()
                    .map(|value| value.daily_summary.trim().to_string())
                    .unwrap_or_default()
            } else {
                summary
            };

            if effective_summary.trim().is_empty() {
                continue;
            }

            items.push(FsRecordItem {
                id: meta.id,
                created_at: meta.created_at,
                provider: normalize_provider(&meta.provider),
                date_key,
                summary: effective_summary,
                provider_results: if provider_results.is_empty() {
                    None
                } else {
                    Some(provider_results)
                },
                merged,
            });
        }

        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn save_record_to_fs(record: SaveRecordInput) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = record.id.trim().to_string();
        if id.is_empty() {
            return Err("Record id is empty.".to_string());
        }

        let created_at = if record.created_at.trim().is_empty() {
            Local::now().to_rfc3339()
        } else {
            record.created_at.trim().to_string()
        };

        let provider = normalize_provider(&record.provider);
        let date_key = record
            .date_key
            .as_deref()
            .and_then(parse_date_key)
            .unwrap_or_else(|| date_key_from_created_at(&created_at));

        let base_dir = briefly_base_dir()?;
        ensure_briefly_dirs(&base_dir)?;

        let record_dir = briefly_records_dir(&base_dir).join(&date_key);
        fs::create_dir_all(&record_dir)
            .map_err(|err| format!("Failed to create record dir {}: {err}", record_dir.display()))?;

        let meta = FsRecordMeta {
            id,
            created_at: created_at.clone(),
            provider: provider.clone(),
            date_key: date_key.clone(),
        };

        let meta_content = serde_json::to_vec_pretty(&meta)
            .map_err(|err| format!("Failed to serialize record meta: {err}"))?;
        atomic_write(&record_dir.join("meta.json"), &meta_content)?;

        let summary_md = summary_markdown(&date_key, &provider, &created_at, &record.summary);
        atomic_write(&record_dir.join("summary.md"), summary_md.as_bytes())?;

        let providers_dir = record_dir.join("providers");
        if providers_dir.exists() {
            fs::remove_dir_all(&providers_dir).map_err(|err| {
                format!(
                    "Failed to clear providers dir {}: {err}",
                    providers_dir.display()
                )
            })?;
        }

        if let Some(provider_results) = record.provider_results {
            if !provider_results.is_empty() {
                fs::create_dir_all(&providers_dir).map_err(|err| {
                    format!(
                        "Failed to create providers dir {}: {err}",
                        providers_dir.display()
                    )
                })?;

                for item in provider_results {
                    let file_name = format!("{}.json", provider_file_stem(&item.provider));
                    let file_path = providers_dir.join(file_name);
                    let content = serde_json::to_vec_pretty(&item)
                        .map_err(|err| format!("Failed to serialize provider result: {err}"))?;
                    atomic_write(&file_path, &content)?;
                }
            }
        }

        let merged_path = record_dir.join("merged.json");
        if let Some(merged) = record.merged {
            let merged_content = serde_json::to_vec_pretty(&merged)
                .map_err(|err| format!("Failed to serialize merged summary: {err}"))?;
            atomic_write(&merged_path, &merged_content)?;
        } else if merged_path.exists() {
            fs::remove_file(&merged_path)
                .map_err(|err| format!("Failed to remove merged file {}: {err}", merged_path.display()))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn list_rollups_from_fs() -> Result<Vec<FsRollupItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base_dir = briefly_base_dir()?;
        let rollups_dir = briefly_rollups_dir(&base_dir);
        if !rollups_dir.exists() || !rollups_dir.is_dir() {
            return Ok(Vec::new());
        }

        let mut items = Vec::new();

        for period in ["week", "month"] {
            let period_dir = briefly_rollup_period_dir(&base_dir, period);
            if !period_dir.exists() || !period_dir.is_dir() {
                continue;
            }

            let entries = match fs::read_dir(&period_dir) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let rollup_dir = entry.path();
                if !rollup_dir.is_dir() {
                    continue;
                }

                let fallback_period_key = entry
                    .file_name()
                    .to_str()
                    .map(|value| value.to_string())
                    .unwrap_or_default();

                let meta_path = rollup_dir.join("meta.json");
                let summary_path = rollup_dir.join("summary.md");
                let merged_path = rollup_dir.join("merged.json");

                let meta_raw = match fs::read_to_string(&meta_path) {
                    Ok(content) => content,
                    Err(_) => continue,
                };
                let meta: FsRollupMeta = match serde_json::from_str(&meta_raw) {
                    Ok(meta) => meta,
                    Err(_) => continue,
                };

                let normalized_period = match normalize_rollup_period(&meta.period) {
                    Some(value) => value,
                    None => continue,
                };
                let normalized_period_key = normalize_rollup_period_key(
                    &normalized_period,
                    if meta.period_key.trim().is_empty() {
                        &fallback_period_key
                    } else {
                        &meta.period_key
                    },
                )
                .or_else(|| normalize_rollup_period_key(&normalized_period, &fallback_period_key))
                .unwrap_or_default();

                if normalized_period_key.is_empty()
                    || meta.id.trim().is_empty()
                    || meta.created_at.trim().is_empty()
                {
                    continue;
                }

                let summary = match fs::read_to_string(&summary_path) {
                    Ok(content) => strip_markdown_front_matter(&content),
                    Err(_) => String::new(),
                };
                let merged = fs::read_to_string(&merged_path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<MergedSummaryData>(&raw).ok());

                let effective_summary = if summary.trim().is_empty() {
                    merged
                        .as_ref()
                        .map(|value| value.daily_summary.trim().to_string())
                        .unwrap_or_default()
                } else {
                    summary
                };

                if effective_summary.trim().is_empty() {
                    continue;
                }

                items.push(FsRollupItem {
                    id: meta.id,
                    created_at: meta.created_at,
                    period: normalized_period,
                    period_key: normalized_period_key,
                    start_date_key: parse_date_key(&meta.start_date_key).unwrap_or_default(),
                    end_date_key: parse_date_key(&meta.end_date_key).unwrap_or_default(),
                    source_date_keys: meta
                        .source_date_keys
                        .iter()
                        .filter_map(|value| parse_date_key(value))
                        .collect::<Vec<String>>(),
                    summary: effective_summary,
                    merged,
                });
            }
        }

        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn save_rollup_to_fs(rollup: SaveRollupInput) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = rollup.id.trim().to_string();
        if id.is_empty() {
            return Err("Rollup id is empty.".to_string());
        }

        let period = normalize_rollup_period(&rollup.period)
            .ok_or_else(|| "Rollup period is invalid.".to_string())?;
        let period_key = normalize_rollup_period_key(&period, &rollup.period_key)
            .ok_or_else(|| "Rollup period key is invalid.".to_string())?;
        let start_date_key = parse_date_key(&rollup.start_date_key)
            .ok_or_else(|| "Rollup start date key is invalid.".to_string())?;
        let end_date_key = parse_date_key(&rollup.end_date_key)
            .ok_or_else(|| "Rollup end date key is invalid.".to_string())?;
        let created_at = if rollup.created_at.trim().is_empty() {
            Local::now().to_rfc3339()
        } else {
            rollup.created_at.trim().to_string()
        };

        let source_date_keys = rollup
            .source_date_keys
            .iter()
            .filter_map(|value| parse_date_key(value))
            .collect::<Vec<String>>();

        let base_dir = briefly_base_dir()?;
        ensure_briefly_dirs(&base_dir)?;

        let rollup_dir = briefly_rollup_period_dir(&base_dir, &period).join(&period_key);
        fs::create_dir_all(&rollup_dir).map_err(|err| {
            format!(
                "Failed to create rollup dir {}: {err}",
                rollup_dir.display()
            )
        })?;

        let meta = FsRollupMeta {
            id,
            created_at: created_at.clone(),
            period: period.clone(),
            period_key: period_key.clone(),
            start_date_key: start_date_key.clone(),
            end_date_key: end_date_key.clone(),
            source_date_keys,
        };

        let meta_content = serde_json::to_vec_pretty(&meta)
            .map_err(|err| format!("Failed to serialize rollup meta: {err}"))?;
        atomic_write(&rollup_dir.join("meta.json"), &meta_content)?;

        let summary_md = rollup_markdown(
            &period,
            &period_key,
            &start_date_key,
            &end_date_key,
            &created_at,
            &rollup.summary,
        );
        atomic_write(&rollup_dir.join("summary.md"), summary_md.as_bytes())?;

        let merged_path = rollup_dir.join("merged.json");
        if let Some(merged) = rollup.merged {
            let merged_content = serde_json::to_vec_pretty(&merged)
                .map_err(|err| format!("Failed to serialize merged rollup: {err}"))?;
            atomic_write(&merged_path, &merged_content)?;
        } else if merged_path.exists() {
            fs::remove_file(&merged_path)
                .map_err(|err| format!("Failed to remove merged file {}: {err}", merged_path.display()))?;
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[tauri::command]
async fn clear_briefly_storage() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base_dir = briefly_base_dir()?;
        if base_dir.exists() {
            fs::remove_dir_all(&base_dir)
                .map_err(|err| format!("Failed to remove briefly storage {}: {err}", base_dir.display()))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn run_finish_command(command_template: String, conversation: String) -> Result<FinishCommandResult, String> {
    let command = command_template.trim().to_string();
    if command.is_empty() {
        return Err("Finish command is empty.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut process = if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(&command);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg("-lc").arg(&command);
            let mut path_entries = vec![
                "/opt/homebrew/bin".to_string(),
                "/usr/local/bin".to_string(),
                "/usr/bin".to_string(),
                "/bin".to_string(),
                "/Applications/Codex.app/Contents/Resources".to_string(),
            ];

            if let Ok(home) = std::env::var("HOME") {
                let trimmed = home.trim();
                if !trimmed.is_empty() {
                    path_entries.push(format!("{trimmed}/.volta/bin"));
                    path_entries.push(format!("{trimmed}/.local/bin"));
                }
            }

            if let Ok(existing_path) = std::env::var("PATH") {
                let trimmed = existing_path.trim();
                if !trimmed.is_empty() {
                    path_entries.push(trimmed.to_string());
                }
            }

            cmd.env("PATH", path_entries.join(":"));
            cmd
        };

        process.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = process
            .spawn()
            .map_err(|err| format!("Failed to start command: {err}"))?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(conversation.as_bytes())
                .map_err(|err| format!("Failed to pass conversation to stdin: {err}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|err| format!("Failed while waiting for command completion: {err}"))?;

        let stdout = truncate_chars(&String::from_utf8_lossy(&output.stdout), 16_000);
        let stderr = truncate_chars(&String::from_utf8_lossy(&output.stderr), 6_000);

        Ok(FinishCommandResult {
            success: output.status.success(),
            stdout: stdout.trim().to_string(),
            stderr: stderr.trim().to_string(),
            exit_code: output.status.code(),
        })
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            run_finish_command,
            collect_today_terminal_conversation,
            detect_log_paths,
            load_profile_from_fs,
            save_profile_to_fs,
            list_records_from_fs,
            save_record_to_fs,
            list_rollups_from_fs,
            save_rollup_to_fs,
            clear_briefly_storage
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
