// SQL utilities ported from the legacy backend. Two concerns:
//   1. split_sql_statements — quote/backtick-aware statement splitter.
//   2. Query timeout constants + normalization (clamped to a sane range).

use std::time::Duration;

/// Split a SQL string into individual statements, respecting single-quotes,
/// double-quotes, backticks, and backslash escapes. Empty statements are
/// skipped. Ported verbatim from the legacy db.rs.
pub fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut stmts = Vec::new();
    let mut current = String::new();
    let mut in_str_single = false;
    let mut in_str_double = false;
    let mut in_backtick = false;
    let mut chars = sql.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\\' {
            current.push(c);
            if let Some(next) = chars.next() {
                current.push(next);
            }
            continue;
        }

        match c {
            '\'' if !in_str_double && !in_backtick => in_str_single = !in_str_single,
            '"' if !in_str_single && !in_backtick => in_str_double = !in_str_double,
            '`' if !in_str_single && !in_str_double => in_backtick = !in_backtick,
            ';' if !in_str_single && !in_str_double && !in_backtick => {
                let stmt = current.trim().to_string();
                if !stmt.is_empty() {
                    stmts.push(stmt);
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(c);
    }

    let stmt = current.trim().to_string();
    if !stmt.is_empty() {
        stmts.push(stmt);
    }

    stmts
}

//  ------ Query timeout

pub const DEFAULT_QUERY_TIMEOUT_MS: u64 = 30_000;
pub const MIN_QUERY_TIMEOUT_MS: u64 = 5_000;
pub const MAX_QUERY_TIMEOUT_MS: u64 = 300_000;

/// Clamp a requested timeout to the allowed range, defaulting if None.
pub fn normalized_query_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_QUERY_TIMEOUT_MS)
        .clamp(MIN_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS)
}

/// Human-readable timeout label for error messages.
pub fn format_timeout_label(timeout_ms: u64) -> String {
    if timeout_ms % 1000 == 0 {
        format!("{}s", timeout_ms / 1000)
    } else {
        format!("{:.1}s", timeout_ms as f64 / 1000.0)
    }
}

/// Wrap a future in a tokio timeout, returning an AppError on expiry.
/// `label` is included in the timeout error message for diagnostics.
pub async fn run_with_timeout<T, F>(
    timeout_ms: Option<u64>,
    label: &str,
    future: F,
) -> Result<T, crate::AppError>
where
    F: std::future::Future<Output = Result<T, crate::AppError>>,
{
    let effective = normalized_query_timeout_ms(timeout_ms);
    match tokio::time::timeout(Duration::from_millis(effective), future).await {
        Ok(result) => result,
        Err(_) => Err(crate::AppError::database(format!(
            "Query timed out after {} [{}]",
            format_timeout_label(effective),
            label,
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_simple_statements() {
        let stmts = split_sql_statements("SELECT 1; SELECT 2;");
        assert_eq!(stmts, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn respects_single_quotes() {
        let stmts = split_sql_statements("SELECT 'a;b'; SELECT 2");
        assert_eq!(stmts, vec!["SELECT 'a;b'", "SELECT 2"]);
    }

    #[test]
    fn respects_backticks() {
        let stmts = split_sql_statements("SELECT `a;b`; SELECT 2");
        assert_eq!(stmts, vec!["SELECT `a;b`", "SELECT 2"]);
    }

    #[test]
    fn handles_escapes() {
        let stmts = split_sql_statements("SELECT 'a\\';b'; SELECT 2");
        assert_eq!(stmts, vec!["SELECT 'a\\';b'", "SELECT 2"]);
    }

    #[test]
    fn skips_empty_statements() {
        let stmts = split_sql_statements(";;; SELECT 1 ;;;");
        assert_eq!(stmts, vec!["SELECT 1"]);
    }

    #[test]
    fn clamps_timeout() {
        assert_eq!(normalized_query_timeout_ms(None), 30_000);
        assert_eq!(normalized_query_timeout_ms(Some(1)), 5_000);
        assert_eq!(normalized_query_timeout_ms(Some(999_999)), 300_000);
    }
}
