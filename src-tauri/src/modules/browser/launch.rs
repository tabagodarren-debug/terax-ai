//! URL validation and the external browser launch plan.
//!
//! URLs are data, never command text: each one is parsed structurally and then
//! passed as its own argument. Nothing flag-shaped, and no command string,
//! ever comes from the frontend.

use std::path::{Path, PathBuf};

/// One browser window per launch, so the list is bounded at something a person
/// would plausibly pin as workstation tools.
pub const MAX_URLS: usize = 16;
pub const MAX_URL_BYTES: usize = 2048;
pub const MAX_TOTAL_BYTES: usize = 16384;

/// Backend-only Chromium flags. These are constants: the frontend cannot add,
/// remove, or influence them.
const FIXED_FLAGS: &[&str] = &[
    // One dedicated window rather than tabs in whatever is already open.
    "--new-window",
    // A managed profile is new by definition; neither prompt is meaningful
    // here and both would block the tools the user asked for.
    "--no-first-run",
    "--no-default-browser-check",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Validates the requested URLs and returns them normalized, in order.
///
/// Absolute HTTP and HTTPS only. Credentials are refused outright: an Afflow
/// tool list is persisted, and a URL carrying a password does not belong in
/// one.
pub fn validate_urls(raw: &[String]) -> Result<Vec<String>, String> {
    if raw.is_empty() {
        return Err("no website was selected to open".into());
    }
    if raw.len() > MAX_URLS {
        return Err(format!("cannot open more than {MAX_URLS} websites at once"));
    }

    let total: usize = raw.iter().map(|u| u.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err("the selected websites are too large to open".into());
    }

    raw.iter().map(|url| validate_url(url)).collect()
}

fn validate_url(raw: &str) -> Result<String, String> {
    if raw.chars().any(char::is_control) {
        return Err("a website address contains control characters".into());
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("a website address is empty".into());
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err("a website address is too long".into());
    }
    // A leading dash would be read as a flag by any argv consumer. Reject it
    // by shape rather than relying on the URL parser to refuse it.
    if trimmed.starts_with('-') {
        return Err("not a valid website address".into());
    }

    let parsed =
        reqwest::Url::parse(trimmed).map_err(|_| "not a valid website address".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("only http and https website addresses can be opened".into()),
    }
    if parsed.cannot_be_a_base() {
        return Err("not an absolute website address".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("website addresses with sign-in credentials are not allowed".into());
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err("website address has no host".into());
    }

    Ok(parsed.to_string())
}

/// Builds the exact argument vector. Every URL is a separate argument, and the
/// user-data directory is the native-derived path, never anything the caller
/// supplied.
pub fn build_plan(executable: &Path, user_data: &Path, urls: &[String]) -> LaunchPlan {
    let mut args = Vec::with_capacity(1 + FIXED_FLAGS.len() + urls.len());
    args.push(format!("--user-data-dir={}", native_path_arg(user_data)));
    args.extend(FIXED_FLAGS.iter().map(|f| (*f).to_string()));
    args.extend(urls.iter().cloned());

    LaunchPlan {
        program: executable.to_path_buf(),
        args,
    }
}

/// Chromium parses this path with its own path code, which does not understand
/// the Windows verbatim `\\?\` prefix that `canonicalize` produces. Native
/// separators are kept: unlike a displayed path, this one is consumed by the
/// browser.
fn native_path_arg(path: &Path) -> String {
    strip_verbatim_native(&path.to_string_lossy())
}

/// Pure so it stays testable on any host.
pub fn strip_verbatim_native(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        build_plan, strip_verbatim_native, validate_urls, MAX_TOTAL_BYTES, MAX_URLS, MAX_URL_BYTES,
    };
    use std::path::{Path, PathBuf};

    fn urls(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn accepts_http_and_https_and_preserves_order() {
        let accepted = validate_urls(&urls(&[
            "https://app.example.com/dashboard",
            "http://localhost:3000/preview",
            "https://docs.example.com/a?b=c#d",
        ]))
        .expect("valid urls");

        assert_eq!(accepted.len(), 3);
        assert!(accepted[0].starts_with("https://app.example.com/"));
        assert!(accepted[1].starts_with("http://localhost:3000/"));
        assert!(accepted[2].contains("docs.example.com"));
    }

    #[test]
    fn rejects_an_empty_list() {
        let err = validate_urls(&[]).unwrap_err();
        assert!(err.contains("no website"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_more_than_the_maximum_number_of_urls() {
        let many: Vec<String> = (0..=MAX_URLS)
            .map(|i| format!("https://example.com/{i}"))
            .collect();
        let err = validate_urls(&many).unwrap_err();
        assert!(err.contains("more than"), "unexpected error: {err}");

        let exactly_max: Vec<String> = (0..MAX_URLS)
            .map(|i| format!("https://example.com/{i}"))
            .collect();
        assert!(validate_urls(&exactly_max).is_ok());
    }

    #[test]
    fn rejects_an_excessive_total_size_even_within_the_count_limit() {
        // Two URLs, each under the per-URL cap, together over the total cap.
        let big = format!("https://example.com/{}", "a".repeat(MAX_URL_BYTES - 30));
        assert!(big.len() < MAX_URL_BYTES);
        let list: Vec<String> = std::iter::repeat_n(big, MAX_URLS).collect();
        assert!(list.iter().map(String::len).sum::<usize>() > MAX_TOTAL_BYTES);

        let err = validate_urls(&list).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_an_overlength_single_url() {
        let long = format!("https://example.com/{}", "a".repeat(MAX_URL_BYTES));
        let err = validate_urls(&urls(&[&long])).unwrap_err();
        assert!(err.contains("too long"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_empty_and_malformed_addresses() {
        for bad in ["", "   ", "not a url", "://example.com", "https://"] {
            assert!(
                validate_urls(&urls(&[bad])).is_err(),
                "should have rejected {bad:?}"
            );
        }
    }

    #[test]
    fn rejects_unsupported_schemes() {
        for bad in [
            "file:///C:/Windows/System32/config",
            "ftp://example.com/x",
            "javascript:alert(1)",
            "data:text/html,<h1>x</h1>",
            "chrome://settings",
            "about:blank",
        ] {
            let err = validate_urls(&urls(&[bad])).unwrap_err();
            assert!(
                err.contains("only http and https") || err.contains("not a valid"),
                "unexpected error for {bad:?}: {err}"
            );
        }
    }

    #[test]
    fn rejects_addresses_carrying_credentials() {
        for bad in [
            "https://user:secret@example.com/",
            "https://user@example.com/",
        ] {
            let err = validate_urls(&urls(&[bad])).unwrap_err();
            assert!(err.contains("credentials"), "unexpected error: {err}");
            // The rejection must not echo the secret back to the frontend.
            assert!(!err.contains("secret"), "error leaked a credential: {err}");
        }
    }

    #[test]
    fn rejects_control_characters() {
        for bad in [
            "https://example.com/\n--headless",
            "https://example.com/\r\nx",
            "https://exa\u{0}mple.com/",
            "https://example.com/\u{7}path",
            "https://exam\tple.com/",
        ] {
            assert!(
                validate_urls(&urls(&[bad])).is_err(),
                "should have rejected {bad:?}"
            );
        }
    }

    #[test]
    fn surrounding_spaces_are_trimmed() {
        let accepted = validate_urls(&urls(&["  https://example.com/app  "])).expect("trimmed");
        assert_eq!(accepted, vec!["https://example.com/app".to_string()]);
    }

    #[test]
    fn rejects_control_characters_even_at_the_input_edges() {
        for bad in [
            "\thttps://example.com/",
            "https://example.com/\t",
            "https://example.com/\r",
            "https://example.com/\n",
        ] {
            let err = validate_urls(&urls(&[bad])).unwrap_err();
            assert!(err.contains("control"), "unexpected error: {err}");
        }
    }

    #[test]
    fn validation_errors_never_echo_url_secrets() {
        let secret = "AFFLOW_PRIVATE_TOKEN_3917";
        for bad in [
            format!("https://example.com:99999/?token={secret}"),
            format!("https://[invalid/?token={secret}"),
            format!("--url=https://example.com/?token={secret}"),
        ] {
            let err = validate_urls(&[bad]).unwrap_err();
            assert!(!err.contains(secret), "URL secret leaked: {err}");
            assert!(!err.contains("example.com"), "URL content leaked: {err}");
        }
    }

    #[test]
    fn rejects_flag_shaped_input() {
        for bad in [
            "--headless",
            "-remote-debugging-port=9222",
            "--user-data-dir=C:/elsewhere",
            "--load-extension=C:/evil",
        ] {
            let err = validate_urls(&urls(&[bad])).unwrap_err();
            assert!(
                err.contains("not a valid website address"),
                "unexpected error for {bad:?}: {err}"
            );
        }
    }

    #[test]
    fn one_bad_address_rejects_the_whole_launch() {
        let err = validate_urls(&urls(&[
            "https://good.example.com/",
            "javascript:alert(1)",
            "https://also-good.example.com/",
        ]))
        .unwrap_err();
        assert!(!err.is_empty());
    }

    fn plan_for(user_data: &str, list: &[&str]) -> super::LaunchPlan {
        let accepted = validate_urls(&urls(list)).expect("valid urls");
        build_plan(
            Path::new("/browsers/chrome.exe"),
            Path::new(user_data),
            &accepted,
        )
    }

    #[test]
    fn builds_the_exact_argument_vector() {
        let plan = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &["https://a.example.com/"],
        );

        assert_eq!(plan.program, PathBuf::from("/browsers/chrome.exe"));
        assert_eq!(plan.args.len(), 5);
        assert_eq!(
            plan.args[0],
            "--user-data-dir=/profiles/chrome/shared-v1/user-data"
        );
        assert_eq!(plan.args[1], "--new-window");
        assert_eq!(plan.args[2], "--no-first-run");
        assert_eq!(plan.args[3], "--no-default-browser-check");
        assert_eq!(plan.args[4], "https://a.example.com/");
    }

    #[test]
    fn every_url_is_its_own_argument_in_order() {
        let plan = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &[
                "https://one.example.com/",
                "https://two.example.com/",
                "https://three.example.com/",
            ],
        );

        let tail = &plan.args[plan.args.len() - 3..];
        assert_eq!(tail[0], "https://one.example.com/");
        assert_eq!(tail[1], "https://two.example.com/");
        assert_eq!(tail[2], "https://three.example.com/");
    }

    #[test]
    fn no_argument_is_a_shell_string_or_a_caller_supplied_flag() {
        let plan = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &["https://a.example.com/?q=1%20and%202"],
        );

        // Nothing is a shell invocation, and no argument packs several tokens.
        for arg in &plan.args {
            assert!(!arg.contains(" && "), "shell operator in {arg}");
            assert!(!arg.contains(" | "), "shell operator in {arg}");
            assert!(!arg.starts_with("/c"), "cmd invocation in {arg}");
        }
        assert!(!plan.program.to_string_lossy().contains("cmd"));
        assert!(!plan.program.to_string_lossy().contains("powershell"));

        // Exactly one --user-data-dir, and it is the first argument.
        let user_data_args = plan
            .args
            .iter()
            .filter(|a| a.starts_with("--user-data-dir="))
            .count();
        assert_eq!(user_data_args, 1);
        assert!(plan.args[0].starts_with("--user-data-dir="));

        // The only flags present are the fixed backend set.
        let flags: Vec<&str> = plan
            .args
            .iter()
            .filter(|a| a.starts_with('-'))
            .map(String::as_str)
            .collect();
        assert_eq!(flags.len(), 4);
    }

    #[test]
    fn the_same_profile_always_reuses_the_same_user_data_path() {
        let first = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &["https://a.example.com/"],
        );
        let second = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &["https://b.example.com/"],
        );
        assert_eq!(first.args[0], second.args[0]);
    }

    #[test]
    fn different_profiles_and_browser_families_stay_isolated() {
        let shared = plan_for(
            "/profiles/chrome/shared-v1/user-data",
            &["https://a.example.com/"],
        );
        let workstation = plan_for(
            "/profiles/chrome/ws-alpha/user-data",
            &["https://a.example.com/"],
        );
        let edge = plan_for(
            "/profiles/edge/shared-v1/user-data",
            &["https://a.example.com/"],
        );

        assert_ne!(shared.args[0], workstation.args[0]);
        assert_ne!(shared.args[0], edge.args[0]);
        assert_ne!(workstation.args[0], edge.args[0]);
    }

    #[test]
    fn the_verbatim_prefix_is_stripped_but_native_separators_are_kept() {
        assert_eq!(
            strip_verbatim_native(r"\\?\C:\Users\a\profiles\user-data"),
            r"C:\Users\a\profiles\user-data"
        );
        assert_eq!(
            strip_verbatim_native(r"\\?\UNC\server\share\profiles"),
            r"\\server\share\profiles"
        );
        assert_eq!(
            strip_verbatim_native(r"C:\already\plain"),
            r"C:\already\plain"
        );
        assert_eq!(strip_verbatim_native("/unix/style"), "/unix/style");
    }

    #[cfg(windows)]
    #[test]
    fn a_canonicalized_windows_user_data_path_reaches_chromium_without_the_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let user_data = tmp.path().join("user-data");
        std::fs::create_dir(&user_data).unwrap();
        let canonical = std::fs::canonicalize(&user_data).unwrap();
        assert!(canonical.to_string_lossy().starts_with(r"\\?\"));

        let plan = build_plan(
            Path::new(r"C:\browsers\chrome.exe"),
            &canonical,
            &["https://a.example.com/".to_string()],
        );
        assert!(
            !plan.args[0].contains(r"\\?\"),
            "prefix leaked: {}",
            plan.args[0]
        );
        assert!(
            plan.args[0].contains('\\'),
            "separators lost: {}",
            plan.args[0]
        );
    }
}
